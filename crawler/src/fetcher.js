// Tải trang qua kho proxy: tự đổi proxy và thử lại khi lỗi mạng hoặc bị chặn,
// tự theo chuyển hướng (kiểm tra SSRF từng bước), giới hạn dung lượng, giãn cách theo tên miền.
import { request } from 'undici';
import { detectBlock } from './detect.js';
import { assertPublicUrl, UrlError } from './netguard.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Semaphore {
  constructor(n) { this.n = n; this.q = []; }
  async acquire() { if (this.n > 0) { this.n--; return; } await new Promise((r) => this.q.push(r)); }
  release() { const next = this.q.shift(); if (next) next(); else this.n++; }
}

// Bộ header giống trình duyệt thật (Chrome trên Windows / macOS)
const PROFILES = [
  { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36', ch: '"Google Chrome";v="129", "Not=A?Brand";v="8", "Chromium";v="129"', platform: '"Windows"' },
  { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36', ch: '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"', platform: '"Windows"' },
  { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36', ch: '"Google Chrome";v="129", "Not=A?Brand";v="8", "Chromium";v="129"', platform: '"macOS"' },
];
const LANG = {
  com: 'en-US,en;q=0.9', 'co.uk': 'en-GB,en;q=0.9', de: 'de-DE,de;q=0.9,en;q=0.8', fr: 'fr-FR,fr;q=0.9,en;q=0.8',
  it: 'it-IT,it;q=0.9,en;q=0.8', es: 'es-ES,es;q=0.9,en;q=0.8', 'co.jp': 'ja-JP,ja;q=0.9,en;q=0.8', ca: 'en-CA,en;q=0.9',
  'com.au': 'en-AU,en;q=0.9', in: 'en-IN,en;q=0.9',
};

function browserHeaders(url, profileIdx, cookie) {
  const p = PROFILES[profileIdx % PROFILES.length];
  const tld = (url.hostname.match(/amazon\.(.+)$/) || [])[1];
  const h = {
    'user-agent': p.ua,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'accept-language': LANG[tld] || 'en-US,en;q=0.9',
    'accept-encoding': 'gzip, deflate, br',
    'cache-control': 'max-age=0',
    'upgrade-insecure-requests': '1',
    'sec-ch-ua': p.ch, 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': p.platform,
    'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'none', 'sec-fetch-user': '?1',
  };
  if (cookie) h.cookie = cookie;
  return h;
}

async function decompress(buf, enc) {
  const zlib = await import('node:zlib');
  if (!enc || enc === 'identity') return buf;
  if (enc.includes('br')) return zlib.brotliDecompressSync(buf);
  if (enc.includes('gzip')) return zlib.gunzipSync(buf);
  if (enc.includes('deflate')) { try { return zlib.inflateSync(buf); } catch { return zlib.inflateRawSync(buf); } }
  return buf;
}

function decodeText(buf, contentType) {
  const cs = ((contentType || '').match(/charset=([\w-]+)/i) || [])[1];
  try { return new TextDecoder(cs || 'utf-8').decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

export class Fetcher {
  constructor({ pool, config, renderer = null }) {
    this.pool = pool;
    this.cfg = config;
    this.global = new Semaphore(config.concurrency);
    this.domains = new Map();
    this.renderer = renderer;
    this.profileCounter = 0;
  }

  domainSem(domain) {
    let s = this.domains.get(domain);
    if (!s) { s = new Semaphore(this.cfg.perDomainConcurrency); this.domains.set(domain, s); }
    return s;
  }

  /** Một lần tải (không thử lại), tự theo tối đa 5 lần chuyển hướng. */
  async once(entry, startUrl, domain, profileIdx) {
    let url = startUrl;
    for (let hop = 0; hop <= 5; hop++) {
      const res = await request(url, {
        method: 'GET',
        dispatcher: entry.dispatcher,
        headers: browserHeaders(new URL(url), profileIdx, entry.cookieHeader(domain)),
        headersTimeout: this.cfg.timeoutMs, bodyTimeout: this.cfg.timeoutMs,
      });
      entry.storeCookies(domain, [].concat(res.headers['set-cookie'] || []));
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        await res.body.dump();
        url = (await assertPublicUrl(new URL(res.headers.location, url).toString(), { allowPrivate: this.cfg.allowPrivateNetworks })).toString();
        continue;
      }
      const chunks = []; let size = 0;
      for await (const c of res.body) {
        size += c.length;
        if (size > this.cfg.maxBodyBytes) { res.body.destroy(); throw new Error('Trang quá lớn'); }
        chunks.push(c);
      }
      const raw = await decompress(Buffer.concat(chunks), res.headers['content-encoding']);
      return { status: res.statusCode, finalUrl: url, contentType: res.headers['content-type'] || '', body: decodeText(raw, res.headers['content-type']) };
    }
    throw new Error('Chuyển hướng quá nhiều lần');
  }

  /**
   * Tải trang với thử lại. options: { site, javascript, maxRetries }
   * Trả về { ok, status, body, finalUrl, attempts, proxy, blocks, error }
   */
  async fetch(rawUrl, options = {}) {
    const u = await assertPublicUrl(rawUrl, { allowPrivate: this.cfg.allowPrivateNetworks });
    const domain = u.hostname;
    const maxAttempts = 1 + (options.maxRetries ?? this.cfg.maxRetries);
    const deadline = Date.now() + Math.max(this.cfg.timeoutMs * maxAttempts, 60_000);
    const tried = new Set();
    const blocks = [];
    let last = { status: 0, body: '', finalUrl: u.toString() };
    let lastError = null;

    await this.global.acquire();
    const dsem = this.domainSem(domain);
    await dsem.acquire();
    try {
      for (let attempt = 1; attempt <= maxAttempts && Date.now() < deadline; attempt++) {
        let picked = this.pool.pick(domain, tried);
        if (!picked.entry && tried.size) { tried.clear(); picked = this.pool.pick(domain, tried); }
        while (!picked.entry) {
          if (picked.waitMs == null || Date.now() + picked.waitMs > deadline) {
            return { ok: false, status: last.status, body: last.body, finalUrl: last.finalUrl, attempts: attempt - 1, blocks, error: 'Tất cả proxy đang bị chặn hoặc bận, thử lại sau' };
          }
          await sleep(Math.min(picked.waitMs + 20, 5000));
          picked = this.pool.pick(domain, tried);
        }
        const entry = picked.entry;
        tried.add(entry);
        try {
          const r = options.javascript && this.renderer
            ? await this.renderer.render(entry, u.toString(), options)
            : await this.once(entry, u.toString(), domain, this.profileCounter++);
          last = r;
          const reason = detectBlock({ status: r.status, body: r.body, url: r.finalUrl, site: options.site });
          if (reason) {
            blocks.push({ proxy: entry.label, reason });
            this.pool.release(entry, domain, 'blocked');
          } else if (r.status >= 500) {
            this.pool.release(entry, domain, 'fail');
            lastError = `HTTP ${r.status}`;
          } else {
            this.pool.release(entry, domain, 'ok');
            return { ok: true, status: r.status, body: r.body, finalUrl: r.finalUrl, contentType: r.contentType, attempts: attempt, proxy: entry.label, blocks };
          }
        } catch (e) {
          if (e instanceof UrlError) { this.pool.release(entry, domain, 'ok'); throw e; }
          this.pool.release(entry, domain, 'fail');
          lastError = e.code ? `${e.code}: ${e.message}` : e.message;
        }
        await sleep(Math.min(4000, 250 * 2 ** (attempt - 1)) * (0.6 + Math.random() * 0.8));
      }
      return { ok: false, status: last.status, body: last.body, finalUrl: last.finalUrl, attempts: maxAttempts, blocks, error: lastError || (blocks.length ? 'Bị chặn ở mọi lần thử' : 'Tải thất bại') };
    } finally {
      dsem.release();
      this.global.release();
    }
  }
}
