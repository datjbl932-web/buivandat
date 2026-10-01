#!/usr/bin/env node
// Công cụ dòng lệnh DatCrawl
//   datcrawl create-token <tên> [--rate 60] [--quota 100000]
//   datcrawl list-tokens
//   datcrawl disable-token <id>
//   datcrawl selftest [url ...]   – crawl thử Amazon thật qua proxy đã cấu hình, báo trường nào lấy được
import { config } from '../src/config.js';
import { openDb, createToken } from '../src/db.js';

const [cmd, ...args] = process.argv.slice(2);
const flag = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };

async function selftest(urls) {
  const { ProxyPool, loadProxyList } = await import('../src/proxies.js');
  const { Fetcher } = await import('../src/fetcher.js');
  const { SCRAPERS, detectScraper } = await import('../src/scrapers/index.js');
  const pool = new ProxyPool(loadProxyList(config), { useDirect: config.useDirect, perProxyDelayMs: config.perProxyDelayMs, timeoutMs: config.timeoutMs });
  const fetcher = new Fetcher({ pool, config });
  console.log(`Proxy: ${pool.entries.map((e) => e.label).join(', ')}\n`);
  const list = urls.length ? urls : [
    'https://www.amazon.com/dp/B0BKW3LB2B',
    'https://www.amazon.com/s?k=mechanical+keyboard',
    'https://www.amazon.com/gp/bestsellers/electronics',
  ];
  let bad = 0;
  for (const url of list) {
    const name = detectScraper(url);
    const t0 = Date.now();
    const r = await fetcher.fetch(url, { site: SCRAPERS[name].site });
    console.log(`▶ ${url}\n  scraper=${name}  ${r.ok ? 'OK' : 'THẤT BẠI'}  HTTP ${r.status}  ${r.attempts} lần thử  ${Date.now() - t0} ms  ${r.proxy || ''}`);
    if (r.blocks.length) console.log(`  bị chặn: ${r.blocks.map((b) => `${b.proxy} (${b.reason})`).join(', ')}`);
    if (!r.ok) { bad++; console.log(`  lỗi: ${r.error}\n`); continue; }
    const data = SCRAPERS[name].parse(r.body, r.finalUrl);
    const sample = Array.isArray(data.products) ? { ...data, products: data.products.slice(0, 1) } : data;
    const row = Array.isArray(data.products) ? data.products[0] || {} : data;
    const missing = Object.entries(row).filter(([, v]) => v == null || (Array.isArray(v) && !v.length)).map(([k]) => k);
    if (Array.isArray(data.products)) console.log(`  ${data.products.length} sản phẩm`);
    console.log(`  trường trống: ${missing.length ? missing.join(', ') : '(không có)'}`);
    console.log('  ' + JSON.stringify(sample, null, 2).split('\n').slice(0, 40).join('\n  ') + '\n');
    if (missing.includes('name') || missing.includes('price') || (Array.isArray(data.products) && !data.products.length)) bad++;
  }
  console.log(bad ? `⚠ ${bad} URL có vấn đề – xem chi tiết ở trên.` : '✓ Tất cả đều ổn.');
  process.exit(bad ? 1 : 0);
}

const db = cmd && cmd !== 'selftest' ? openDb(config.dbPath) : null;
switch (cmd) {
  case 'create-token': {
    if (!args[0]) { console.error('Cần tên: datcrawl create-token <tên>'); process.exit(1); }
    const t = createToken(db, { name: args[0], rateLimit: flag('rate') ? Number(flag('rate')) : null, monthlyQuota: flag('quota') ? Number(flag('quota')) : null });
    console.log(`Token:          ${t.token}\nWebhook secret: ${t.webhookSecret}\n(Token chỉ hiện một lần – hãy lưu lại.)`);
    break;
  }
  case 'list-tokens':
    console.table(db.prepare(`SELECT id, name, prefix, rate_limit, monthly_quota, disabled, datetime(created_at/1000, 'unixepoch') created FROM tokens`).all());
    break;
  case 'disable-token':
    console.log(db.prepare('UPDATE tokens SET disabled = 1 WHERE id = ?').run(Number(args[0])).changes ? 'Đã khoá.' : 'Không tìm thấy token.');
    break;
  case 'selftest':
    await selftest(args.filter((a) => /^https?:/.test(a)));
    break;
  default:
    console.log('Lệnh: create-token <tên> [--rate N] [--quota N] | list-tokens | disable-token <id> | selftest [url ...]');
}
