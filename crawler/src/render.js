// &javascript=true – mở trang bằng trình duyệt thật (Playwright/Chromium) qua proxy.
// Không bắt buộc: chỉ bật khi ENABLE_JS=true và đã cài `npm i playwright && npx playwright install chromium`.
export async function createRenderer({ timeoutMs }) {
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch {
    throw new Error('ENABLE_JS=true nhưng chưa cài playwright: npm i playwright && npx playwright install chromium');
  }
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  return {
    async render(entry, url, opts = {}) {
      const proxy = entry.url ? (() => { const u = new URL(entry.url); return { server: `${u.protocol}//${u.host}`, username: decodeURIComponent(u.username) || undefined, password: decodeURIComponent(u.password) || undefined }; })() : undefined;
      const ctx = await browser.newContext({ proxy, locale: 'en-US', viewport: { width: 1366, height: 900 } });
      try {
        const page = await ctx.newPage();
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        await page.waitForTimeout(Math.min(Number(opts.pageWait) || 1500, 10000));
        return { status: resp ? resp.status() : 0, body: await page.content(), finalUrl: page.url(), contentType: 'text/html' };
      } finally { await ctx.close(); }
    },
    close: () => browser.close(),
  };
}
