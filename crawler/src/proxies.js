// Kho proxy xoay vòng: chấm điểm sức khoẻ, tạm nghỉ proxy bị chặn theo từng tên miền,
// giãn cách request cùng proxy + cùng tên miền, giữ cookie phiên riêng cho từng proxy.
import fs from 'node:fs';
import { ProxyAgent, Agent } from 'undici';

/** Đọc proxy ở các dạng: http://user:pass@host:port | host:port | host:port:user:pass */
export function parseProxy(line) {
  const s = line.trim();
  if (!s || s.startsWith('#')) return null;
  if (/^https?:\/\//i.test(s)) return new URL(s).toString();
  const p = s.split(':');
  if (p.length === 2) return `http://${p[0]}:${p[1]}`;
  if (p.length === 4) return `http://${encodeURIComponent(p[2])}:${encodeURIComponent(p[3])}@${p[0]}:${p[1]}`;
  throw new Error(`Không đọc được proxy: ${s}`);
}

export function loadProxyList({ proxiesFile, proxies }) {
  const lines = [];
  if (proxies) lines.push(...proxies.split(','));
  if (proxiesFile && fs.existsSync(proxiesFile)) lines.push(...fs.readFileSync(proxiesFile, 'utf8').split('\n'));
  return [...new Set(lines.map(parseProxy).filter(Boolean))];
}

const mask = (u) => { try { const x = new URL(u); if (x.password) x.password = '***'; return x.toString().replace(/\/$/, ''); } catch { return u; } };

class ProxyEntry {
  constructor(url, timeoutMs) {
    this.url = url;               // null = gọi thẳng
    this.label = url ? mask(url) : 'direct';
    const opts = { connect: { timeout: timeoutMs }, headersTimeout: timeoutMs, bodyTimeout: timeoutMs };
    this.dispatcher = url ? new ProxyAgent({ uri: url, ...opts }) : new Agent(opts);
    this.score = 1;               // 0..1, càng cao càng được ưu tiên
    this.ok = 0; this.fail = 0; this.blocked = 0;
    this.inflight = 0;
    this.bannedUntil = new Map(); // domain -> timestamp
    this.lastUsed = new Map();    // domain -> timestamp
    this.cookies = new Map();     // domain -> Map(name -> value)
  }
  cookieHeader(domain) {
    const jar = this.cookies.get(domain);
    return jar && jar.size ? [...jar].map(([k, v]) => `${k}=${v}`).join('; ') : '';
  }
  storeCookies(domain, setCookies) {
    if (!setCookies || !setCookies.length) return;
    let jar = this.cookies.get(domain);
    if (!jar) { jar = new Map(); this.cookies.set(domain, jar); }
    for (const c of setCookies) {
      const m = String(c).match(/^\s*([^=;\s]+)=([^;]*)/);
      if (m) jar.set(m[1], m[2]);
    }
  }
  toJSON() {
    return { proxy: this.label, score: +this.score.toFixed(3), ok: this.ok, fail: this.fail, blocked: this.blocked, inflight: this.inflight,
      banned: [...this.bannedUntil].filter(([, t]) => t > Date.now()).map(([d, t]) => ({ domain: d, until: new Date(t).toISOString() })) };
  }
}

export class ProxyPool {
  constructor(urls, { useDirect = false, perProxyDelayMs = 1500, timeoutMs = 30000 } = {}) {
    this.entries = urls.map((u) => new ProxyEntry(u, timeoutMs));
    if (useDirect || !this.entries.length) this.entries.push(new ProxyEntry(null, timeoutMs));
    this.delay = perProxyDelayMs;
  }

  /** Chọn proxy cho một tên miền. Trả về {entry} hoặc {waitMs} nếu tất cả đang bận/bị chặn tạm. */
  pick(domain, exclude = new Set()) {
    const now = Date.now();
    let best = null, bestW = -1, soonest = Infinity;
    for (const e of this.entries) {
      if (exclude.has(e)) continue;
      const ban = e.bannedUntil.get(domain) || 0;
      const ready = Math.max(ban, (e.lastUsed.get(domain) || 0) + this.delay);
      if (ready > now) { soonest = Math.min(soonest, ready - now); continue; }
      const w = e.score * (0.75 + Math.random() * 0.5) / (1 + e.inflight);   // ưu tiên proxy khoẻ, có chút ngẫu nhiên
      if (w > bestW) { best = e; bestW = w; }
    }
    if (best) { best.lastUsed.set(domain, now); best.inflight++; return { entry: best }; }
    return { waitMs: Number.isFinite(soonest) ? soonest : null };
  }

  release(entry, domain, outcome) {
    entry.inflight = Math.max(0, entry.inflight - 1);
    if (outcome === 'ok') { entry.ok++; entry.score = Math.min(1, entry.score * 0.9 + 0.1); return; }
    if (outcome === 'blocked') {
      entry.blocked++;
      entry.score = Math.max(0.02, entry.score * 0.6);
      // bị chặn càng nhiều thì nghỉ càng lâu với tên miền đó (30 giây -> tối đa 30 phút)
      const mins = Math.min(30, 0.5 * 2 ** Math.min(6, entry.blocked));
      entry.bannedUntil.set(domain, Date.now() + mins * 60_000);
      entry.cookies.delete(domain);
      return;
    }
    entry.fail++;
    entry.score = Math.max(0.05, entry.score * 0.8);
  }

  stats() { return this.entries.map((e) => e.toJSON()); }
}
