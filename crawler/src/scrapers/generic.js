// scraper=generic – trích thông tin chung của mọi trang: tiêu đề, mô tả, Open Graph, JSON-LD, liên kết
import * as cheerio from 'cheerio';
import { clean, absolute } from './amazon/common.js';

export function parseGeneric(html, url) {
  const $ = cheerio.load(html);
  const meta = (n) => clean($(`meta[name="${n}"], meta[property="${n}"]`).first().attr('content')) || null;
  const jsonLd = [];
  $('script[type="application/ld+json"]').each((_, s) => { try { jsonLd.push(JSON.parse($(s).text())); } catch { /* bỏ qua JSON hỏng */ } });
  const links = [...new Set($('a[href]').map((_, a) => absolute($(a).attr('href'), url)).get().filter((h) => h && /^https?:/.test(h)))];
  return {
    title: clean($('title').first().text()) || null,
    description: meta('description') || meta('og:description'),
    canonical: absolute($('link[rel="canonical"]').attr('href'), url),
    openGraph: Object.fromEntries($('meta[property^="og:"]').map((_, m) => [[$(m).attr('property').slice(3), clean($(m).attr('content'))]]).get()),
    headings: { h1: $('h1').map((_, h) => clean($(h).text())).get().filter(Boolean), h2: $('h2').map((_, h) => clean($(h).text())).get().filter(Boolean).slice(0, 50) },
    jsonLd,
    links: links.slice(0, 500),
    linksCount: links.length,
    url,
  };
}
