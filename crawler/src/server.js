// Máy chủ API DatCrawl
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { config as defaultConfig } from './config.js';
import { openDb, findToken, recordUsage, monthSuccess, createToken } from './db.js';
import { ProxyPool, loadProxyList } from './proxies.js';
import { Fetcher } from './fetcher.js';
import { CrawlService } from './crawl.js';
import { JobRunner } from './jobs.js';
import { SCRAPERS } from './scrapers/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Giới hạn tần suất theo token: cửa sổ trượt 60 giây */
class RateLimiter {
  constructor() { this.hits = new Map(); }
  allow(id, limit) {
    const now = Date.now();
    const arr = (this.hits.get(id) || []).filter((t) => t > now - 60_000);
    if (arr.length >= limit) { this.hits.set(id, arr); return false; }
    arr.push(now); this.hits.set(id, arr); return true;
  }
}

export async function buildApp(overrides = {}) {
  const cfg = { ...defaultConfig, ...overrides };
  const db = overrides.db || openDb(cfg.dbPath);
  const pool = overrides.pool || new ProxyPool(loadProxyList(cfg), { useDirect: cfg.useDirect, perProxyDelayMs: cfg.perProxyDelayMs, timeoutMs: cfg.timeoutMs });
  let renderer = null;
  if (cfg.enableJs) renderer = await (await import('./render.js')).createRenderer(cfg);
  const fetcher = new Fetcher({ pool, config: cfg, renderer });
  const crawl = new CrawlService({ db, fetcher, config: cfg });
  const app = Fastify({ logger: cfg.logLevel === 'silent' ? false : { level: cfg.logLevel }, trustProxy: true });
  const jobs = new JobRunner({ db, crawl, config: cfg, log: app.log });
  const limiter = new RateLimiter();

  app.decorate('ctx', { cfg, db, pool, fetcher, crawl, jobs });

  // ---------- xác thực
  const tokenOf = (req) => req.query.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;
  function auth(req, reply) {
    const t = findToken(db, tokenOf(req));
    if (!t) { reply.code(401).send({ pc_status: 401, error: 'Token không hợp lệ' }); return null; }
    if (!limiter.allow(t.id, t.rate_limit || cfg.defaultRateLimit)) {
      reply.code(429).send({ pc_status: 429, error: 'Vượt giới hạn request/phút của token' }); return null;
    }
    if (t.monthly_quota && monthSuccess(db, t.id) >= t.monthly_quota) {
      reply.code(429).send({ pc_status: 429, error: 'Đã dùng hết hạn mức tháng này' }); return null;
    }
    return t;
  }
  function admin(req, reply) {
    const t = Buffer.from((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
    const want = Buffer.from(cfg.adminToken || '');
    if (!want.length || t.length !== want.length || !crypto.timingSafeEqual(t, want)) { reply.code(401).send({ error: 'Cần ADMIN_TOKEN' }); return false; }
    return true;
  }

  // ---------- Crawling API (tương thích Crawlbase)
  async function crawlHandler(req, reply) {
    const token = auth(req, reply); if (!token) return reply;
    const q = req.query;
    if (!q.url) return reply.code(400).send({ pc_status: 400, error: 'Thiếu tham số url' });
    const scraper = q.scraper || q.autoparse === 'true' && 'auto' || null;
    const format = q.format || (scraper ? 'json' : 'html');
    const res = await crawl.crawl({
      url: q.url, scraper, javascript: q.javascript === 'true',
      cache: q.cache !== 'false', maxRetries: q.retries !== undefined ? Math.min(8, Math.max(0, Number(q.retries))) : undefined,
    });
    const ok = res.pc_status === 200;
    recordUsage(db, token.id, { ok, cached: !!res.cached, bytes: typeof res.body === 'string' ? res.body.length : 0 });
    reply.header('original_status', String(res.original_status)).header('pc_status', String(res.pc_status)).header('url', encodeURI(res.url || ''));
    if (res.attempts) reply.header('x-datcrawl-attempts', String(res.attempts));
    if (res.cached) reply.header('x-datcrawl-cache', 'hit');
    const httpStatus = ok ? 200 : res.pc_status === 400 ? 400 : 502;
    if (format === 'html' && ok && typeof res.body === 'string') return reply.code(200).type('text/html; charset=utf-8').send(res.body);
    return reply.code(httpStatus).send(res);
  }
  app.get('/', (req, reply) => (req.query.url || req.query.token ? crawlHandler(req, reply) : reply.redirect('/dashboard/')));
  app.get('/api/crawl', crawlHandler);

  // ---------- tài khoản & tiện ích
  app.get('/api/account', (req, reply) => {
    const t = auth(req, reply); if (!t) return reply;
    const days = db.prepare('SELECT day, success, failed, cached, bytes FROM usage WHERE token_id = ? ORDER BY day DESC LIMIT 30').all(t.id);
    return { name: t.name, prefix: t.prefix, rate_limit: t.rate_limit || cfg.defaultRateLimit, monthly_quota: t.monthly_quota, month_success: monthSuccess(db, t.id), webhook_secret: t.webhook_secret, usage: days };
  });
  app.get('/api/scrapers', () => Object.fromEntries(Object.entries(SCRAPERS).map(([k, v]) => [k, v.describe])));
  app.get('/health', () => ({ ok: true, proxies: pool.entries.length, jobsActive: jobs.active }));

  // ---------- job hàng loạt
  app.post('/api/jobs', async (req, reply) => {
    const t = auth(req, reply); if (!t) return reply;
    const b = req.body || {};
    try {
      if (b.scraper) crawl.resolveScraper(b.scraper, 'https://www.amazon.com/');
      return await jobs.create(t, { urls: b.urls, scraper: b.scraper || null, javascript: !!b.javascript, callbackUrl: b.callback_url || null });
    } catch (e) { return reply.code(400).send({ error: e.message }); }
  });
  app.get('/api/jobs', (req, reply) => {
    const t = auth(req, reply); if (!t) return reply;
    return db.prepare('SELECT id, created_at, scraper, total, done, failed, status, callback_url FROM jobs WHERE token_id = ? ORDER BY created_at DESC LIMIT 100').all(t.id);
  });
  app.get('/api/jobs/:id', (req, reply) => {
    const t = auth(req, reply); if (!t) return reply;
    const job = db.prepare('SELECT id, created_at, scraper, total, done, failed, status, callback_url FROM jobs WHERE id = ? AND token_id = ?').get(req.params.id, t.id);
    if (!job) return reply.code(404).send({ error: 'Không tìm thấy job' });
    const offset = Math.max(0, Number(req.query.offset) || 0), limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const items = db.prepare('SELECT idx, url, status, attempts, result FROM job_items WHERE job_id = ? ORDER BY idx LIMIT ? OFFSET ?').all(job.id, limit, offset)
      .map((r) => ({ ...r, result: r.result ? JSON.parse(r.result) : null }));
    return { ...job, offset, limit, items };
  });
  app.delete('/api/jobs/:id', (req, reply) => {
    const t = auth(req, reply); if (!t) return reply;
    const r = db.prepare("UPDATE jobs SET status = 'cancelled' WHERE id = ? AND token_id = ? AND status IN ('queued','running')").run(req.params.id, t.id);
    return { cancelled: r.changes > 0 };
  });

  // ---------- quản trị
  app.get('/admin/tokens', (req, reply) => {
    if (!admin(req, reply)) return reply;
    return db.prepare(`SELECT t.id, t.name, t.prefix, t.rate_limit, t.monthly_quota, t.disabled, t.created_at,
      COALESCE(SUM(u.success),0) success, COALESCE(SUM(u.failed),0) failed FROM tokens t LEFT JOIN usage u ON u.token_id = t.id
      GROUP BY t.id ORDER BY t.id`).all();
  });
  app.post('/admin/tokens', (req, reply) => {
    if (!admin(req, reply)) return reply;
    const b = req.body || {};
    if (!b.name) return reply.code(400).send({ error: 'Cần "name"' });
    return createToken(db, { name: String(b.name).slice(0, 100), rateLimit: b.rate_limit ?? null, monthlyQuota: b.monthly_quota ?? null });
  });
  app.post('/admin/tokens/:id/disable', (req, reply) => {
    if (!admin(req, reply)) return reply;
    return { disabled: db.prepare('UPDATE tokens SET disabled = 1 WHERE id = ?').run(Number(req.params.id)).changes > 0 };
  });
  app.get('/admin/proxies', (req, reply) => (admin(req, reply) ? pool.stats() : reply));
  app.get('/admin/stats', (req, reply) => {
    if (!admin(req, reply)) return reply;
    return {
      days: db.prepare('SELECT day, SUM(success) success, SUM(failed) failed, SUM(cached) cached FROM usage GROUP BY day ORDER BY day DESC LIMIT 30').all(),
      jobs: db.prepare("SELECT status, COUNT(*) n FROM jobs GROUP BY status").all(),
      cacheRows: db.prepare('SELECT COUNT(*) n FROM cache').get().n,
    };
  });

  // ---------- dashboard
  await app.register(fastifyStatic, { root: path.join(HERE, '..', 'public'), prefix: '/dashboard/' });

  app.addHook('onClose', async () => { jobs.stop(); if (renderer) await renderer.close(); });
  return app;
}

// Chạy trực tiếp: node src/server.js
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await buildApp();
  const { cfg, pool } = app.ctx;
  if (!cfg.adminToken) app.log.warn('Chưa đặt ADMIN_TOKEN: các API /admin sẽ bị khoá');
  app.log.info(`Kho proxy: ${pool.entries.map((e) => e.label).join(', ')}`);
  app.ctx.jobs.start();
  await app.listen({ port: cfg.port, host: cfg.host });
}

