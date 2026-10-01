// scraper=amazon-best-sellers – trang Best Sellers / New Releases (/zgbs/, /gp/bestsellers/, /gp/new-releases/)
import * as cheerio from 'cheerio';
import { clean, parsePrice, parseRating, parseCount, absolute } from './common.js';

export function parseBestSellers(html, url) {
  const $ = cheerio.load(html);
  const products = [];
  $('#gridItemRoot, .zg-grid-general-faceout, li.zg-item-immersion, [id^="p13n-asin-index-"]').each((_, el) => {
    const $el = $(el);
    const holder = $el.is('[data-asin]') ? $el : $el.find('[data-asin]').first();
    const asin = clean(holder.attr('data-asin')) || (clean($el.find('a[href*="/dp/"]').attr('href')).match(/\/dp\/([A-Z0-9]{10})/) || [])[1];
    if (!asin || products.some((p) => p.asin === asin)) return;
    const link = $el.find('a[href*="/dp/"]').first();
    const img = $el.find('img').first();
    const name = clean($el.find('[class*="p13n-sc-css-line-clamp"], .p13n-sc-truncated, ._cDEzb_p13n-sc-css-line-clamp-3_g3dy1').first().text())
      || clean(img.attr('alt')) || clean(link.text());
    const priceText = clean($el.find('[class*="p13n-sc-price"], .p13n-sc-price, .a-color-price').first().text());
    const price = priceText ? parsePrice(priceText, url) : null;
    const rankText = clean($el.find('.zg-bdg-text, .zg-badge-text').first().text());
    const ratingEl = $el.find('i[class*="a-icon-star"] .a-icon-alt, .a-icon-alt').first();
    const countEl = $el.find('a[href*="product-reviews"] span, .a-size-small').last();
    products.push({
      rank: parseCount(rankText) ?? products.length + 1,
      asin,
      name: name || null,
      url: absolute(link.attr('href'), url),
      image: clean(img.attr('src')) || null,
      price: price?.value ?? null,
      currency: price?.currency ?? null,
      rawPrice: price?.raw ?? null,
      rating: parseRating(ratingEl.text()),
      reviewsCount: parseCount(countEl.text()),
    });
  });
  return {
    category: clean($('#zg_banner_text, h1, .a-size-large.a-spacing-medium').first().text()) || null,
    products: products.sort((a, b) => a.rank - b.rank),
    nextPage: absolute($('ul.a-pagination li.a-last a').attr('href'), url),
    url,
  };
}
