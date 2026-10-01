// Tiện ích dùng chung cho các scraper Amazon
export const clean = (s) => (s == null ? '' : String(s).replace(/[‎‏ ]/g, ' ').replace(/\s+/g, ' ').trim());

const CURRENCY = [
  [/^US\$|^\$/, 'USD'], [/^CA\$|^C\$/, 'CAD'], [/^A\$|^AU\$/, 'AUD'], [/^£/, 'GBP'], [/€/, 'EUR'],
  [/^¥|^￥/, 'JPY'], [/^₹/, 'INR'], [/^R\$/, 'BRL'], [/^MX\$/, 'MXN'], [/^S\$/, 'SGD'], [/^AED/, 'AED'], [/^SAR/, 'SAR'],
];
const TLD_CURRENCY = { com: 'USD', ca: 'CAD', 'com.au': 'AUD', 'co.uk': 'GBP', de: 'EUR', fr: 'EUR', it: 'EUR', es: 'EUR', nl: 'EUR',
  'co.jp': 'JPY', in: 'INR', 'com.br': 'BRL', 'com.mx': 'MXN', sg: 'SGD', ae: 'AED', sa: 'SAR' };

export function marketplace(url) {
  try { return (new URL(url).hostname.match(/amazon\.([a-z.]+)$/i) || [])[1] || null; } catch { return null; }
}

/** "$1,299.99" | "1.299,99 €" | "￥3,980" -> { value, currency, raw } */
export function parsePrice(text, url) {
  const raw = clean(text);
  if (!raw) return null;
  const m = raw.match(/\d[\d.,\s]*/);
  if (!m) return null;
  let n = m[0].replace(/\s/g, '');
  const lastComma = n.lastIndexOf(','), lastDot = n.lastIndexOf('.');
  if (lastComma > lastDot) {                 // 1.299,99 -> kiểu châu Âu
    n = /,\d{1,2}$/.test(n) ? n.replace(/\./g, '').replace(',', '.') : n.replace(/,/g, '');
  } else if (lastComma === -1 && /^\d{1,3}(\.\d{3})+$/.test(n)) {
    n = n.replace(/\./g, '');               // 1.299 -> 1299 (dấu chấm phân cách hàng nghìn)
  } else {
    n = n.replace(/,/g, '');
  }
  const value = Number(n);
  if (!Number.isFinite(value)) return null;
  const tldCurrency = TLD_CURRENCY[marketplace(url)] || null;
  let currency = null;
  for (const [re, c] of CURRENCY) if (re.test(raw)) { currency = c; break; }
  // "$" dùng chung cho USD/CAD/AUD/MXN… -> theo chợ Amazon nếu chợ đó dùng đô la
  if (currency === 'USD' && /^\$/.test(raw) && ['CAD', 'AUD', 'MXN', 'SGD'].includes(tldCurrency)) currency = tldCurrency;
  return { value, currency: currency || tldCurrency, raw };
}

/** "4.5 out of 5 stars" | "4,5 von 5 Sternen" | "5つ星のうち4.3" -> 4.5 */
export function parseRating(text) {
  const t = clean(text);
  if (!t) return null;
  const jp = t.match(/うち\s*(\d+(?:[.,]\d+)?)/);
  const m = jp || t.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const v = Number(m[1].replace(',', '.'));
  return v >= 0 && v <= 5 ? v : null;
}

/** "12,345 ratings" | "12.345 Sternebewertungen" -> 12345 */
export function parseCount(text) {
  const m = clean(text).match(/\d[\d.,\s]*/);
  if (!m) return null;
  const v = Number(m[0].replace(/[.,\s]/g, ''));
  return Number.isFinite(v) ? v : null;
}

export function absolute(href, base) {
  if (!href) return null;
  try { return new URL(href, base).toString(); } catch { return null; }
}

export function asinFromUrl(url) {
  const m = String(url || '').match(/\/(?:dp|gp\/product|gp\/aw\/d|product-reviews)\/([A-Z0-9]{10})(?:[/?]|$)/i);
  return m ? m[1].toUpperCase() : null;
}

/** Ảnh lớn nhất trong thuộc tính data-a-dynamic-image='{"url": [w, h], ...}' */
export function largestDynamicImage(json) {
  try {
    const obj = JSON.parse(json);
    return Object.entries(obj).sort((a, b) => b[1][0] * b[1][1] - a[1][0] * a[1][1])[0]?.[0] || null;
  } catch { return null; }
}
