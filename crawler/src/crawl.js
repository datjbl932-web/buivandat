// Lõi crawl dùng chung cho API trực tiếp và job hàng loạt: cache -> tải -> phân tích.
import crypto from 'node:crypto';
import { SCRAPERS, detectScraper } from './scrapers/index.js';
import { UrlError } from './netguard.js';

// pc_status (giống Crawlbase): 200 thành công | 400 URL sai | 520 tải thất bại / bị chặn | 525 phân tích thất bại
export class CrawlService {
  constructor({ db, fetcher, config }) {
    this.db = db; this.fetcher = fetcher; this.cfg = config;
    this.getCache = db.prepare('SELECT * FROM cache WHERE key = ? AND expires_at > ?');
    this.putCache = db.prepare('INSERT OR REPLACE INTO cache (key, created_at, expires_at, status, final_url, body) VALUES (?, ?, ?, ?, ?, ?)');
    this.purge = db.prepare('DELETE FROM cache WHERE expires_at < ?');
    setInterval(() => this.purge.run(Date.now()), 600_000).unref();
  }

  resolveScraper(name, url) {
    if (!name) return null;
    const n = name === 'auto' ? detectScraper(url) : name;
    if (!SCRAPERS[n]) throw new UrlError(`Không có scraper "${name}". Có: auto, ${Object.keys(SCRAPERS).join(', ')}`);
    return n;
  }

  /**
   * opts: { url, scraper, javascript, cache (bool), maxRetries }
   * -> { original_status, pc_status, url, body, scraper, cached, attempts, proxy, blocks, error }
   */
  async crawl(opts) {
    let scraper;
    try { scraper = this.resolveScraper(opts.scraper, opts.url); } catch (e) {
      return { original_status: 0, pc_status: 400, url: opts.url, body: null, error: e.message };
    }
    const site = scraper ? SCRAPERS[scraper].site : (/(^|\.)amazon\./i.test(safeHost(opts.url)) ? 'amazon' : null);
    const key = crypto.createHash('sha256').update(`${opts.url}|${opts.javascript ? 1 : 0}`).digest('hex');
    const useCache = opts.cache !== false && this.cfg.cacheTtlSec > 0;

    let page = null, cached = false, meta = {};
    if (useCache) {
      const row = this.getCache.get(key, Date.now());
      if (row) { page = { status: row.status, body: row.body.toString('utf8'), finalUrl: row.final_url }; cached = true; }
    }
    if (!page) {
      let r;
      try {
        r = await this.fetcher.fetch(opts.url, { site, javascript: !!opts.javascript, maxRetries: opts.maxRetries });
      } catch (e) {
        if (e instanceof UrlError) return { original_status: 0, pc_status: 400, url: opts.url, body: null, error: e.message };
        throw e;
      }
      meta = { attempts: r.attempts, proxy: r.proxy, blocks: r.blocks };
      if (!r.ok) {
        return { original_status: r.status, pc_status: 520, url: r.finalUrl, body: null, cached: false, ...meta, error: r.error };
      }
      page = { status: r.status, body: r.body, finalUrl: r.finalUrl };
      if (useCache && r.status === 200) {
        this.putCache.run(key, Date.now(), Date.now() + this.cfg.cacheTtlSec * 1000, r.status, r.finalUrl, Buffer.from(r.body, 'utf8'));
      }
    }

    if (!scraper) return { original_status: page.status, pc_status: 200, url: page.finalUrl, body: page.body, cached, ...meta };
    try {
      const parsed = SCRAPERS[scraper].parse(page.body, page.finalUrl);
      return { original_status: page.status, pc_status: 200, url: page.finalUrl, body: parsed, scraper, cached, ...meta };
    } catch (e) {
      return { original_status: page.status, pc_status: 525, url: page.finalUrl, body: null, scraper, cached, ...meta, error: `Phân tích thất bại: ${e.message}` };
    }
  }
}

function safeHost(u) { try { return new URL(u).hostname; } catch { return ''; } }
