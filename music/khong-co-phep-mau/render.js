#!/usr/bin/env node
/*
 * Xuất video: node render.js video [--fps 30] [--from s] [--to s] [--out file.mp4]
 *            node render.js stills 1.5 12 40 ...   (ảnh PNG từng thời điểm)
 * Cần: playwright (Chromium), ffmpeg và một web server ở thư mục gốc repo:
 *   python3 -m http.server 8770   (chạy ở thư mục gốc)
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const mode = args[0] || 'video';
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const HERE = __dirname;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  const root = opt('root', 'http://localhost:8770');
  await page.goto(root + '/music/khong-co-phep-mau/render.html');
  const duration = await page.evaluate(() => window.ready);

  if (mode === 'stills') {
    fs.mkdirSync(path.join(HERE, 'build/stills'), { recursive: true });
    for (const t of args.slice(1).map(Number)) {
      const url = await page.evaluate((t) => window.frame(t, 0.9), t);
      fs.writeFileSync(path.join(HERE, `build/stills/t${t.toFixed(1).padStart(6, '0')}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
    }
    console.log('stills ok');
  } else {
    const fps = +opt('fps', 30), from = +opt('from', 0), to = +opt('to', duration);
    const out = opt('out', path.join(HERE, 'build/video.mp4'));
    const wav = path.join(HERE, 'build/song.wav');
    const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', '-',
      '-ss', String(from), '-t', String(to - from), '-i', wav,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      '-c:a', 'aac', '-b:a', '192k', '-shortest', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    const n = Math.round((to - from) * fps), t0 = Date.now();
    for (let i = 0; i < n; i++) {
      const url = await page.evaluate((t) => window.frame(t, 0.95), from + i / fps);
      if (!ff.stdin.write(Buffer.from(url.split(',')[1], 'base64'))) await new Promise((r) => ff.stdin.once('drain', r));
      if (i % 300 === 0) console.log(`frame ${i}/${n}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    ff.stdin.end();
    await new Promise((r) => ff.on('close', r));
    console.log('video →', out);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
