// Kiểm thử đầu-cuối: Amazon giả lập + 2 proxy giả (1 proxy "bị Amazon chặn" luôn ra CAPTCHA, 1 proxy bình thường)
// + máy chủ nhận webhook. Không cần Internet.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { buildApp } from '../src/server.js';
import { openDb, createToken } from '../src/db.js';
import { ProxyPool } from '../src/proxies.js';

const fx = (n) => fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- "Amazon" giả lập
let upstreamHits = 0;
const upstream = http.createServer((req, res) => {
  upstreamHits++;
  const u = new URL(req.url, 'http://x');
  const send = (body, status = 200, headers = {}) => { res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers }); res.end(body); };
  if (u.pathname === '/dp/B0BKW3LB2B') return send(fx('amazon-product-us.html'), 200, { 'set-cookie': 'session-id=123-456; Path=/' });
  if (u.pathname === '/s') return send(fx('amazon-search.html'));
  if (u.pathname.startsWith('/gp/bestsellers')) return send(fx('amazon-bestsellers.html'));
  if (u.pathname === '/old-link') return send('', 301, { location: '/dp/B0BKW3LB2B' });
  if (u.pathname === '/flaky') return send('oops', 500);
  if (u.pathname === '/huge') return send('x'.repeat(300_000));
  return send('<html><body>not found</body></html>', 404);
});
// "Amazon" nhìn thấy IP bị chặn: luôn trả CAPTCHA
const blockedUpstream = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(fx('amazon-captcha.html')); });

/** Proxy giả hỗ trợ CONNECT; forceTo = cổng đích cố định (mô phỏng IP bị chặn) */
function fakeProxy(forceTo = null) {
  const srv = http.createServer((req, res) => {          // dạng absolute-URI (nếu client không dùng CONNECT)
    const target = new URL(req.url);
    const fwd = http.request({ host: '127.0.0.1', port: forceTo || target.port, path: target.pathname + target.search, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    req.pipe(fwd);
  });
  srv.used = 0;
  srv.on('connect', (req, socket, head) => {
    srv.used++;
    const [, port] = req.url.split(':');
    const s = net.connect(Number(forceTo || port), '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      s.write(head); s.pipe(socket); socket.pipe(s);
    });
    s.on('error', () => socket.destroy()); socket.on('error', () => s.destroy());
  });
  return srv;
}

// ---- webhook
const hooks = [];
const hookSrv = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { hooks.push({ body: b, sig: req.headers['x-datcrawl-signature'] }); res.end('ok'); });
});

let app, base, token, secret, P_BLOCKED, P_GOOD, proxyBlocked, proxyGood, hookPort, UP;
const cfg = (extra = {}) => ({ logLevel: 'silent', allowPrivateNetworks: true, perProxyDelayMs: 0, maxRetries: 3, timeoutMs: 5000, cacheTtlSec: 60, adminToken: 'admin-secret', jobWorkers: 2, ...extra });

before(async () => {
  UP = await listen(upstream);
  const BLOCKED_UP = await listen(blockedUpstream);
  proxyBlocked = fakeProxy(BLOCKED_UP); P_BLOCKED = await listen(proxyBlocked);
  proxyGood = fakeProxy(); P_GOOD = await listen(proxyGood);
  hookPort = await listen(hookSrv);
  const db = openDb(':memory:');
  ({ token, webhookSecret: secret } = createToken(db, { name: 'test' }));
  const pool = new ProxyPool([`http://127.0.0.1:${P_BLOCKED}`, `http://127.0.0.1:${P_GOOD}`], { perProxyDelayMs: 0, timeoutMs: 5000 });
  pool.entries[1].score = 0.01;  // proxy bị chặn được chọn trước -> buộc phải đổi proxy
  app = await buildApp(cfg({ db, pool }));
  app.ctx.jobs.start();
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${app.server.address().port}`;
});

after(async () => { await app.close(); for (const s of [upstream, blockedUpstream, proxyBlocked, proxyGood, hookSrv]) s.close(); });

const get = async (path) => { const r = await fetch(base + path); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* html */ } return { r, t, j }; };
const q = (o) => new URLSearchParams(o).toString();

test('thiếu/sai token -> 401', async () => {
  const { r, j } = await get(`/api/crawl?${q({ url: 'http://example.com' })}`);
  assert.equal(r.status, 401); assert.equal(j.pc_status, 401);
  assert.equal((await get(`/api/crawl?${q({ token: 'dc_sai', url: 'http://example.com' })}`)).r.status, 401);
});

test('bị chặn (CAPTCHA) ở proxy 1 -> tự đổi proxy -> trả JSON sản phẩm', async () => {
  const { r, j } = await get(`/?${q({ token, url: `http://127.0.0.1:${UP}/dp/B0BKW3LB2B`, scraper: 'amazon-product-details', cache: 'false' })}`);
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.equal(j.pc_status, 200); assert.equal(j.original_status, 200);
  assert.equal(j.body.asin, 'B0BKW3LB2B'); assert.equal(j.body.price, 99.99);
  assert.equal(j.attempts, 2);
  assert.deepEqual(j.blocks.map((b) => b.reason), ['captcha']);
  assert.ok(proxyBlocked.used >= 1 && proxyGood.used >= 1);
  const stats = app.ctx.pool.stats();
  assert.equal(stats[0].blocked, 1); assert.equal(stats[0].banned.length, 1);   // proxy bị chặn đang "nghỉ"
});

test('format=html trả HTML gốc + header original_status/pc_status, lần 2 lấy từ cache', async () => {
  const url = `http://127.0.0.1:${UP}/s?k=keyboard`;
  const a = await get(`/api/crawl?${q({ token, url })}`);
  assert.equal(a.r.status, 200); assert.match(a.t, /data-component-type="s-search-result"/);
  assert.equal(a.r.headers.get('pc_status'), '200'); assert.equal(a.r.headers.get('original_status'), '200');
  const hits = upstreamHits;
  const b = await get(`/api/crawl?${q({ token, url, scraper: 'amazon-serp' })}`);
  assert.equal(b.r.headers.get('x-datcrawl-cache'), 'hit'); assert.equal(upstreamHits, hits);
  assert.equal(b.j.body.products.length, 2);
});

test('theo chuyển hướng 301, best sellers, 404 vẫn là pc_status 200', async () => {
  const a = await get(`/api/crawl?${q({ token, url: `http://127.0.0.1:${UP}/old-link`, scraper: 'amazon-product-details', cache: 'false' })}`);
  assert.equal(a.j.body.asin, 'B0BKW3LB2B'); assert.match(a.j.url, /\/dp\/B0BKW3LB2B$/);
  const b = await get(`/api/crawl?${q({ token, url: `http://127.0.0.1:${UP}/gp/bestsellers/pc`, scraper: 'amazon-best-sellers' })}`);
  assert.equal(b.j.body.products[0].rank, 1);
  const c = await get(`/api/crawl?${q({ token, url: `http://127.0.0.1:${UP}/khong-co`, format: 'json', cache: 'false' })}`);
  assert.equal(c.j.pc_status, 200); assert.equal(c.j.original_status, 404);
});

test('lỗi 5xx ở mọi lần thử -> pc_status 520; scraper sai -> 400', async () => {
  const a = await get(`/api/crawl?${q({ token, url: `http://127.0.0.1:${UP}/flaky`, cache: 'false', retries: '1' })}`);
  assert.equal(a.r.status, 502); assert.equal(a.j.pc_status, 520); assert.equal(a.j.original_status, 500);
  const b = await get(`/api/crawl?${q({ token, url: `http://127.0.0.1:${UP}/s`, scraper: 'khong-co' })}`);
  assert.equal(b.r.status, 400); assert.equal(b.j.pc_status, 400);
});

test('job hàng loạt + webhook có chữ ký HMAC', async () => {
  hooks.length = 0;
  const urls = [`http://127.0.0.1:${UP}/dp/B0BKW3LB2B`, `http://127.0.0.1:${UP}/s?k=a`, `http://127.0.0.1:${UP}/flaky`];
  const r = await fetch(`${base}/api/jobs`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ urls, scraper: 'amazon-product-details', callback_url: `http://127.0.0.1:${hookPort}/hook` }) });
  const job = await r.json();
  assert.equal(r.status, 200, JSON.stringify(job)); assert.equal(job.total, 3);
  let st;
  for (let i = 0; i < 100; i++) { st = (await get(`/api/jobs/${job.id}?token=${token}`)).j; if (st.status === 'done' && hooks.length === 3) break; await sleep(200); }
  assert.equal(st.status, 'done'); assert.equal(st.done, 2); assert.equal(st.failed, 1);
  assert.equal(st.items[0].result.body.asin, 'B0BKW3LB2B');
  assert.equal(hooks.length, 3);
  for (const h of hooks) assert.equal(h.sig, 'sha256=' + crypto.createHmac('sha256', secret).update(h.body).digest('hex'));
});

test('quản trị: cần ADMIN_TOKEN, tạo token mới, giới hạn tần suất', async () => {
  assert.equal((await fetch(`${base}/admin/tokens`)).status, 401);
  const r = await fetch(`${base}/admin/tokens`, { method: 'POST', headers: { authorization: 'Bearer admin-secret', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'khach', rate_limit: 2 }) });
  const t = await r.json(); assert.match(t.token, /^dc_/);
  const url = `http://127.0.0.1:${UP}/s?k=keyboard`;
  const codes = [];
  for (let i = 0; i < 3; i++) codes.push((await get(`/api/crawl?${q({ token: t.token, url })}`)).r.status);
  assert.deepEqual(codes, [200, 200, 429]);
  const proxies = await (await fetch(`${base}/admin/proxies`, { headers: { authorization: 'Bearer admin-secret' } })).json();
  assert.equal(proxies.length, 2); assert.ok(!JSON.stringify(proxies).includes('admin-secret'));
  const acc = (await get(`/api/account?token=${token}`)).j;
  assert.ok(acc.usage[0].success >= 5);
});

test('chặn SSRF khi không bật ALLOW_PRIVATE_NETWORKS', async () => {
  const db = openDb(':memory:'); const { token: t } = createToken(db, { name: 'x' });
  const safe = await buildApp(cfg({ db, allowPrivateNetworks: false, pool: new ProxyPool([], { useDirect: true }) }));
  for (const url of [`http://127.0.0.1:${UP}/s`, 'http://169.254.169.254/latest/meta-data/', 'http://localhost:8080/', 'file:///etc/passwd']) {
    const r = await safe.inject({ url: `/api/crawl?${q({ token: t, url })}` });
    assert.equal(r.statusCode, 400, url); assert.equal(r.json().pc_status, 400);
  }
  const j = await safe.inject({ method: 'POST', url: '/api/jobs', headers: { authorization: `Bearer ${t}` }, payload: { urls: ['https://example.com'], callback_url: 'http://10.0.0.5/hook' } });
  assert.equal(j.statusCode, 400);
  await safe.close();
});

test('tất cả proxy đều bị chặn -> pc_status 520 kèm danh sách lần bị chặn', async () => {
  const db = openDb(':memory:'); const { token: t } = createToken(db, { name: 'x' });
  const pool = new ProxyPool([`http://127.0.0.1:${P_BLOCKED}`], { perProxyDelayMs: 0, timeoutMs: 5000 });
  const a2 = await buildApp(cfg({ db, pool, maxRetries: 2 }));
  const r = await a2.inject({ url: `/api/crawl?${q({ token: t, url: `http://127.0.0.1:${UP}/dp/B0BKW3LB2B`, scraper: 'amazon-product-details' })}` });
  const j = r.json();
  assert.equal(j.pc_status, 520); assert.equal(j.blocks[0].reason, 'captcha'); assert.ok(j.error);
  await a2.close();
});
