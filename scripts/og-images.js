#!/usr/bin/env node
/*
 * Tạo ảnh chia sẻ mạng xã hội (1200×630) cho từng bài viết trong _posts/.
 * Ảnh được lưu tại assets/img/og/<slug>.png và website tự dùng ảnh này
 * khi chia sẻ link lên Facebook, Zalo, Telegram, X…
 *
 * Cách chạy (cần Node.js 18+):
 *   npm install --no-save playwright && npx playwright install chromium
 *   node scripts/og-images.js          # chỉ tạo ảnh cho bài chưa có
 *   node scripts/og-images.js --all    # tạo lại tất cả
 *
 * Tuỳ chọn trong phần đầu bài viết:
 *   og_title: "..."     tiêu đề ngắn hơn cho ảnh (mặc định dùng title)
 *   og_icon: /assets/…  biểu tượng hiện bên phải ảnh
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'assets/img/og');
const all = process.argv.includes('--all');

function frontMatter(file) {
  const src = fs.readFileSync(file, 'utf8');
  const m = src.match(/^---\n([\s\S]*?)\n---/);
  const data = {};
  if (!m) return data;
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (kv) data[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return data;
}

function categories() {
  const map = {};
  let key = null;
  for (const line of fs.readFileSync(path.join(ROOT, '_data/categories.yml'), 'utf8').split('\n')) {
    const k = line.match(/^([a-z0-9-]+):\s*$/);
    if (k) { key = k[1]; map[key] = {}; continue; }
    const n = line.match(/^\s+name:\s*(.+)$/);
    if (n && key) map[key].name = n[1].trim();
  }
  return map;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fileUrl = (p) => 'file://' + path.join(ROOT, p);

function html({ title, label, icon }) {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<link rel="stylesheet" href="${fileUrl('assets/css/fonts.css')}">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; width: 1200px; height: 630px; background: #fff; color: #111; font-family: "Be Vietnam Pro", sans-serif; }
  .wrap { position: absolute; inset: 0; padding: 64px 72px 56px; display: flex; flex-direction: column; }
  .top { display: flex; align-items: center; justify-content: space-between; }
  .brand { display: flex; align-items: center; gap: 16px; font-weight: 700; font-size: 32px; letter-spacing: -.5px; }
  .brand span { color: #8A8A8A; font-weight: 500; }
  .pill { font-size: 24px; font-weight: 500; color: #333; border: 2px solid #E6E6E6; border-radius: 999px; padding: 8px 22px; }
  .main { flex: 1; display: flex; align-items: center; gap: 56px; }
  h1 { flex: 1; margin: 0; font-weight: 700; letter-spacing: -2px; line-height: 1.14; font-size: 68px; }
  .icon { width: 230px; height: 230px; flex: none; }
  .foot { display: flex; justify-content: space-between; border-top: 2px solid #EEE; padding-top: 22px; font-size: 24px; color: #6B6B6B; }
  .foot b { color: #111; font-weight: 600; }
</style></head><body><div class="wrap">
  <div class="top">
    <div class="brand"><img src="${fileUrl('assets/img/logo-mark.svg')}" width="56" height="56"><div>buivandat<span>.com</span></div></div>
    ${label ? `<div class="pill">${esc(label)}</div>` : ''}
  </div>
  <div class="main"><h1 id="t">${esc(title)}</h1>${icon ? `<img class="icon" src="${fileUrl(icon)}">` : ''}</div>
  <div class="foot"><span>Viết bởi <b>Bùi Văn Đạt</b></span><span>buivandat.com</span></div>
</div>
<script>
  // Thu nhỏ chữ nếu tiêu đề quá dài (tối đa 3 dòng)
  const t = document.getElementById('t');
  let size = 68;
  const lines = () => Math.round(t.getBoundingClientRect().height / (size * 1.14));
  while (lines() > 3 && size > 40) { size -= 2; t.style.fontSize = size + 'px'; }
</script></body></html>`;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const cats = categories();
  const jobs = [];

  // Ảnh mặc định của website
  jobs.push({ out: path.join(ROOT, 'assets/img/og-image.png'), title: 'Tin tức, phần mềm và kinh nghiệm MMO thực chiến', label: 'Blog của Bùi Văn Đạt', force: all });

  for (const f of fs.readdirSync(path.join(ROOT, '_posts')).filter((f) => /\.(md|markdown|html)$/.test(f))) {
    const slug = f.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.[^.]+$/, '');
    const fm = frontMatter(path.join(ROOT, '_posts', f));
    const out = path.join(OUT, `${slug}.png`);
    if (!all && fs.existsSync(out)) continue;
    jobs.push({ out, title: fm.og_title || fm.title || slug, label: (cats[fm.category] || {}).name, icon: fm.og_icon, force: true });
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  for (const j of jobs) {
    if (!j.force && fs.existsSync(j.out)) continue;
    const tmp = path.join(OUT, '.tmp.html');
    fs.writeFileSync(tmp, html(j));
    await page.goto('file://' + tmp, { waitUntil: 'networkidle' });
    await page.screenshot({ path: j.out });
    fs.unlinkSync(tmp);
    console.log('✓', path.relative(ROOT, j.out));
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
