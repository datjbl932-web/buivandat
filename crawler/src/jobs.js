// Job hàng loạt (giống "Crawler" bất đồng bộ của Crawlbase): gửi danh sách URL, hệ thống xử lý nền,
// gửi kết quả từng URL về webhook (có chữ ký HMAC) và lưu lại để tra cứu.
import crypto from 'node:crypto';
import { request } from 'undici';
import { assertPublicUrl } from './netguard.js';
import { recordUsage } from './db.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class JobRunner {
  constructor({ db, crawl, config, log = console }) {
    this.db = db; this.crawl = crawl; this.cfg = config; this.log = log;
    this.stopped = false;
    this.active = 0;
    // khởi động lại sau sự cố: việc đang chạy dở quay về hàng đợi
    db.prepare("UPDATE job_items SET status = 'queued' WHERE status = 'running'").run();
    this.take = db.prepare(`UPDATE job_items SET status = 'running', attempts = attempts + 1, updated_at = ?
      WHERE rowid = (SELECT ji.rowid FROM job_items ji JOIN jobs j ON j.id = ji.job_id
                     WHERE ji.status = 'queued' AND j.status IN ('queued', 'running') ORDER BY j.created_at, ji.idx LIMIT 1)
      RETURNING job_id, idx, url`);
  }

  async create(token, { urls, scraper = null, javascript = false, callbackUrl = null }) {
    if (!Array.isArray(urls) || !urls.length) throw new Error('Cần danh sách "urls"');
    if (urls.length > 10000) throw new Error('Tối đa 10.000 URL mỗi job');
    if (callbackUrl) await assertPublicUrl(callbackUrl, { allowPrivate: this.cfg.allowPrivateNetworks });
    const id = 'job_' + crypto.randomBytes(9).toString('base64url');
    const insItem = this.db.prepare('INSERT INTO job_items (job_id, idx, url) VALUES (?, ?, ?)');
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO jobs (id, token_id, created_at, scraper, options, callback_url, total) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, token.id, Date.now(), scraper, JSON.stringify({ javascript }), callbackUrl, urls.length);
      urls.forEach((u, i) => insItem.run(id, i, String(u)));
    })();
    return { id, total: urls.length };
  }

  start() {
    for (let i = 0; i < this.cfg.jobWorkers; i++) this.loop();
  }

  async loop() {
    while (!this.stopped) {
      const item = this.take.get(Date.now());
      if (!item) { await sleep(500); continue; }
      this.active++;
      try { await this.process(item); } catch (e) { this.log.error?.(e); } finally { this.active--; }
    }
  }

  async process(item) {
    const job = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(item.job_id);
    const token = this.db.prepare('SELECT * FROM tokens WHERE id = ?').get(job.token_id);
    if (job.status === 'queued') this.db.prepare("UPDATE jobs SET status = 'running' WHERE id = ?").run(job.id);
    const opts = JSON.parse(job.options);
    const res = await this.crawl.crawl({ url: item.url, scraper: job.scraper, javascript: opts.javascript });
    const ok = res.pc_status === 200;
    recordUsage(this.db, job.token_id, { ok, cached: !!res.cached, bytes: typeof res.body === 'string' ? res.body.length : 0 });
    const payload = { job_id: job.id, index: item.idx, ...res };
    this.db.prepare('UPDATE job_items SET status = ?, result = ?, updated_at = ? WHERE job_id = ? AND idx = ?')
      .run(ok ? 'done' : 'failed', JSON.stringify(payload), Date.now(), job.id, item.idx);
    const counts = this.db.prepare(`UPDATE jobs SET done = done + ?, failed = failed + ? WHERE id = ? RETURNING done, failed, total`)
      .get(ok ? 1 : 0, ok ? 0 : 1, job.id);
    if (counts.done + counts.failed >= counts.total) this.db.prepare("UPDATE jobs SET status = 'done' WHERE id = ?").run(job.id);
    if (job.callback_url) await this.callback(job.callback_url, token.webhook_secret, payload);
  }

  /** Gửi kết quả về webhook, thử lại tối đa 3 lần. Chữ ký: X-DatCrawl-Signature: sha256=<hmac hex của body> */
  async callback(url, secret, payload) {
    const body = JSON.stringify(payload);
    const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
    for (let i = 0; i < 3; i++) {
      try {
        await assertPublicUrl(url, { allowPrivate: this.cfg.allowPrivateNetworks });
        const r = await request(url, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-datcrawl-signature': sig }, headersTimeout: 15000, bodyTimeout: 15000 });
        await r.body.dump();
        if (r.statusCode < 300) return true;
      } catch { /* thử lại */ }
      await sleep(1000 * 2 ** i);
    }
    this.log.warn?.(`Webhook thất bại: ${url}`);
    return false;
  }

  stop() { this.stopped = true; }
}
