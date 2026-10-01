// Nhận biết trang "bị chặn" (CAPTCHA, trang chống bot) để đổi proxy và thử lại.
const AMAZON_BLOCK = [
  /api-services-support@amazon\.com/i,
  /\/errors\/validateCaptcha/i,
  /Enter the characters you see below/i,
  /Sorry, we just need to make sure you're not a robot/i,
  /Type the characters you see in this image/i,
  /<title[^>]*>\s*Robot Check\s*<\/title>/i,
  /Geben Sie die unten angezeigten Zeichen ein/i,     // amazon.de
  /Saisissez les caractères que vous voyez/i,           // amazon.fr
];
const GENERIC_BLOCK = [
  /<title[^>]*>\s*(Attention Required!?\s*\|\s*Cloudflare|Just a moment\.\.\.)/i,
  /cf-chl-bypass|challenge-platform\/h\/[bg]\/orchestrate/i,
  /px-captcha|captcha-delivery\.com|geo\.captcha-delivery/i,
  /<title[^>]*>\s*Access Denied\s*<\/title>/i,
];

/** Trả về lý do bị chặn (chuỗi) hoặc null nếu trang có vẻ bình thường. */
export function detectBlock({ status, body, url, site }) {
  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  const isAmazon = site === 'amazon' || /(^|\.)amazon\./i.test(host);
  if (status === 429) return 'rate_limited';
  if (status === 403 || status === 503) {
    if (isAmazon || GENERIC_BLOCK.some((r) => r.test(body))) return `http_${status}`;
  }
  const sample = body.length > 400_000 ? body.slice(0, 200_000) + body.slice(-50_000) : body;
  if (isAmazon && AMAZON_BLOCK.some((r) => r.test(sample))) return 'captcha';
  if (GENERIC_BLOCK.some((r) => r.test(sample))) return 'anti_bot';
  if (isAmazon && status === 200 && body.length < 2000) return 'empty_page';
  return null;
}
