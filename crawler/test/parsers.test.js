import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseProduct } from '../src/scrapers/amazon/product.js';
import { parseSearch } from '../src/scrapers/amazon/search.js';
import { parseBestSellers } from '../src/scrapers/amazon/bestsellers.js';
import { parseGeneric } from '../src/scrapers/generic.js';
import { parsePrice, parseRating, parseCount, asinFromUrl } from '../src/scrapers/amazon/common.js';
import { detectBlock } from '../src/detect.js';
import { detectScraper } from '../src/scrapers/index.js';
import { isPrivateIp } from '../src/netguard.js';
import { parseProxy } from '../src/proxies.js';

const fx = (n) => fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');

test('amazon-product-details (.com)', () => {
  const p = parseProduct(fx('amazon-product-us.html'), 'https://www.amazon.com/Logitech-MX-Keys/dp/B0BKW3LB2B/ref=sr_1_1');
  assert.equal(p.asin, 'B0BKW3LB2B');
  assert.match(p.name, /^Logitech MX Keys S Wireless Keyboard/);
  assert.equal(p.brand, 'Logitech');
  assert.equal(p.price, 99.99);
  assert.equal(p.listPrice, 109.99);
  assert.equal(p.currency, 'USD');
  assert.equal(p.rating, 4.6);
  assert.equal(p.reviewsCount, 12483);
  assert.equal(p.inStock, true);
  assert.equal(p.isPrime, true);
  assert.equal(p.seller, 'Amazon.com');
  assert.equal(p.mainImage, 'https://m.media-amazon.com/images/I/71big._AC_SL1500_.jpg');
  assert.ok(p.images.includes('https://m.media-amazon.com/images/I/61second._AC_SL1500_.jpg'));
  assert.equal(p.features.length, 3);
  assert.deepEqual(p.breadcrumbs, ['Electronics', 'Computers & Accessories', 'Keyboards']);
  assert.deepEqual(p.bestSellersRank, [{ rank: 245, category: 'Electronics' }, { rank: 3, category: 'Computer Keyboards' }]);
  assert.ok(p.productInformation.some((x) => x.name === 'Item Weight' && x.value === '1.78 pounds'));
  assert.match(p.description, /advanced wireless illuminated keyboard/);
});

test('amazon-product-details (.de): giá kiểu châu Âu, hết hàng, detail bullets', () => {
  const p = parseProduct(fx('amazon-product-de.html'), 'https://www.amazon.de/dp/B0BXYZ1234');
  assert.equal(p.name, 'Anker USB C Ladegerät 65W, 3-Port');
  assert.equal(p.brand, 'Anker');
  assert.equal(p.price, 1299.99);
  assert.equal(p.currency, 'EUR');
  assert.equal(p.rating, 4.7);
  assert.equal(p.reviewsCount, 8912);
  assert.equal(p.inStock, false);
  assert.equal(p.mainImage, 'https://m.media-amazon.com/images/I/b.jpg');
  assert.deepEqual(p.productInformation, [{ name: 'Hersteller', value: 'Anker' }, { name: 'ASIN', value: 'B0BXYZ1234' }]);
});

test('amazon-serp', () => {
  const r = parseSearch(fx('amazon-search.html'), 'https://www.amazon.com/s?k=mechanical+keyboard');
  assert.equal(r.query, 'mechanical keyboard');
  assert.equal(r.totalResults, 10000);
  assert.equal(r.products.length, 2);
  const [a, b] = r.products;
  assert.equal(a.asin, 'B07ZGDPT4M'); assert.equal(a.sponsored, true); assert.equal(a.price, 29.99); assert.equal(a.listPrice, 39.99);
  assert.equal(a.rating, 4.5); assert.equal(a.reviewsCount, 58231); assert.equal(a.isPrime, true);
  assert.equal(a.url, 'https://www.amazon.com/Redragon-K552/dp/B07ZGDPT4M');   // link quảng cáo -> link sản phẩm
  assert.equal(a.name, 'Redragon K552 Mechanical Gaming Keyboard');
  assert.equal(b.asin, 'B0C9ZJHQHM'); assert.equal(b.sponsored, false); assert.equal(b.reviewsCount, 2014); assert.equal(b.position, 2);
  assert.equal(b.url, 'https://www.amazon.com/Keychron-K2/dp/B0C9ZJHQHM/ref=sr_1_3');
  assert.equal(r.nextPage, 'https://www.amazon.com/s?k=mechanical+keyboard&page=2');
});

test('amazon-best-sellers', () => {
  const r = parseBestSellers(fx('amazon-bestsellers.html'), 'https://www.amazon.com/gp/bestsellers/pc/12879431');
  assert.equal(r.category, 'Best Sellers in Computer Keyboards');
  assert.equal(r.products.length, 2);
  assert.deepEqual([r.products[0].rank, r.products[0].asin, r.products[0].price, r.products[0].rating, r.products[0].reviewsCount], [1, 'B07W6JN8V8', 24.99, 4.5, 87654]);
  assert.equal(r.products[0].name, 'Logitech K270 Wireless Keyboard for Windows');
  assert.equal(r.products[1].name, 'Logitech MX Keys S');
  assert.match(r.nextPage, /pg=2/);
});

test('generic', () => {
  const r = parseGeneric('<html><head><title>Xin chào</title><meta name="description" content="Mô tả"><meta property="og:title" content="OG"><script type="application/ld+json">{"@type":"Product","name":"X"}</script></head><body><h1>Tiêu đề</h1><a href="/a">a</a><a href="https://x.com/b">b</a></body></html>', 'https://vd.com/p');
  assert.equal(r.title, 'Xin chào'); assert.equal(r.description, 'Mô tả'); assert.equal(r.openGraph.title, 'OG');
  assert.equal(r.jsonLd[0].name, 'X'); assert.deepEqual(r.headings.h1, ['Tiêu đề']); assert.deepEqual(r.links, ['https://vd.com/a', 'https://x.com/b']);
});

test('parsePrice / parseRating / parseCount / ASIN', () => {
  assert.deepEqual(parsePrice('$1,299.99', 'https://www.amazon.com/x'), { value: 1299.99, currency: 'USD', raw: '$1,299.99' });
  assert.equal(parsePrice('1.299 €', 'https://www.amazon.de/x').value, 1299);
  assert.equal(parsePrice('12,99 €', 'https://www.amazon.fr/x').value, 12.99);
  assert.equal(parsePrice('$24.99', 'https://www.amazon.ca/x').currency, 'CAD');
  assert.deepEqual(parsePrice('￥3,980', 'https://www.amazon.co.jp/x'), { value: 3980, currency: 'JPY', raw: '￥3,980' });
  assert.equal(parsePrice('₹1,49,999', 'https://www.amazon.in/x').value, 149999);
  assert.equal(parsePrice('', 'https://www.amazon.com/x'), null);
  assert.equal(parseRating('4,5 von 5 Sternen'), 4.5);
  assert.equal(parseRating('5つ星のうち4.3'), 4.3);
  assert.equal(parseCount('12.345 Sternebewertungen'), 12345);
  assert.equal(asinFromUrl('https://www.amazon.com/gp/product/b0bkw3lb2b?th=1'), 'B0BKW3LB2B');
});

test('detectBlock', () => {
  assert.equal(detectBlock({ status: 200, body: fx('amazon-captcha.html'), url: 'https://www.amazon.com/dp/X' }), 'captcha');
  assert.equal(detectBlock({ status: 503, body: 'x', url: 'https://www.amazon.com/dp/X' }), 'http_503');
  assert.equal(detectBlock({ status: 200, body: fx('amazon-product-us.html'), url: 'https://www.amazon.com/dp/X' }), null);
  assert.equal(detectBlock({ status: 200, body: '<title>Just a moment...</title>', url: 'https://example.com' }), 'anti_bot');   // trang thử thách Cloudflare
  assert.equal(detectBlock({ status: 200, body: '<title>Shop</title><p>just a moment please</p>', url: 'https://example.com' }), null);
  assert.equal(detectBlock({ status: 403, body: '<title>Attention Required! | Cloudflare</title>', url: 'https://example.com' }), 'http_403');
  assert.equal(detectBlock({ status: 404, body: 'Not found', url: 'https://example.com' }), null);
});

test('detectScraper', () => {
  assert.equal(detectScraper('https://www.amazon.co.uk/dp/B0BKW3LB2B'), 'amazon-product-details');
  assert.equal(detectScraper('https://www.amazon.com/s?k=ssd&page=2'), 'amazon-serp');
  assert.equal(detectScraper('https://www.amazon.com/Best-Sellers-Electronics/zgbs/electronics'), 'amazon-best-sellers');
  assert.equal(detectScraper('https://example.com'), 'generic');
});

test('chặn mạng nội bộ (SSRF)', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:127.0.0.1', '0.0.0.0'])
    assert.equal(isPrivateIp(ip), true, ip);
  for (const ip of ['8.8.8.8', '54.239.28.85', '2606:4700::1111']) assert.equal(isPrivateIp(ip), false, ip);
});

test('đọc proxy nhiều định dạng', () => {
  assert.equal(parseProxy('1.2.3.4:8080'), 'http://1.2.3.4:8080');
  assert.equal(parseProxy('1.2.3.4:8080:user:p@ss'), 'http://user:p%40ss@1.2.3.4:8080');
  assert.equal(parseProxy('http://u:p@proxy.vn:3128'), 'http://u:p@proxy.vn:3128/');
  assert.equal(parseProxy('# ghi chú'), null);
});
