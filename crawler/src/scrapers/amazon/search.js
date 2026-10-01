// scraper=amazon-serp – trang kết quả tìm kiếm Amazon (/s?k=...)
import * as cheerio from 'cheerio';
import { clean, parsePrice, parseRating, parseCount, absolute } from './common.js';

/** Link quảng cáo /sspa/click?...&url=%2F...%2Fdp%2FASIN -> link sản phẩm thật */
function productUrl(href, base, asin) {
  const abs = absolute(href, base);
  if (!abs) return asin ? absolute(`/dp/${asin}`, base) : null;
  const u = new URL(abs);
  if (/\/sspa\/click/.test(u.pathname) && u.searchParams.get('url')) return absolute(u.searchParams.get('url'), base);
  return abs;
}

export function parseSearch(html, url) {
  const $ = cheerio.load(html);
  const products = [];
  $('div[data-component-type="s-search-result"][data-asin]').each((_, el) => {
    const $el = $(el);
    const asin = clean($el.attr('data-asin'));
    if (!asin) return;
    const link = $el.find('h2 a, a.a-link-normal.s-no-outline, [data-cy="title-recipe"] a').first();
    const name = clean($el.find('h2 span').first().text()) || clean($el.find('h2').first().text()) || clean(link.text());
    const priceEl = $el.find('.a-price:not(.a-text-price) .a-offscreen').first();
    const listEl = $el.find('.a-price.a-text-price .a-offscreen').first();
    const price = priceEl.length ? parsePrice(priceEl.text(), url) : null;
    const listPrice = listEl.length ? parsePrice(listEl.text(), url) : null;
    const ratingText = clean($el.find('i[class*="a-icon-star"] .a-icon-alt, span.a-icon-alt').first().text())
      || clean($el.find('[aria-label*="out of 5 stars"]').first().attr('aria-label'));
    const countEl = $el.find('a[href*="#customerReviews"] span, span[aria-label$="ratings"], span[aria-label$="rating"], span.s-underline-text').first();
    const sponsored = $el.find('.puis-sponsored-label-text, .s-sponsored-label-text, [data-component-type="sp-sponsored-result"]').length > 0
      || /\bSponsored\b/.test(clean($el.find('.puis-label-popover-default, .s-label-popover-default').text()));
    products.push({
      position: products.length + 1,
      asin,
      name: name || null,
      url: productUrl(link.attr('href'), url, asin),
      image: clean($el.find('img.s-image').first().attr('src')) || null,
      price: price?.value ?? null,
      listPrice: listPrice?.value ?? null,
      currency: price?.currency ?? null,
      rawPrice: price?.raw ?? null,
      rating: parseRating(ratingText),
      reviewsCount: parseCount(countEl.attr('aria-label') || countEl.text()),
      isPrime: $el.find('i.a-icon-prime, [aria-label="Amazon Prime"]').length > 0,
      sponsored,
    });
  });
  const resultText = clean($('[data-component-type="s-result-info-bar"] h1, .s-desktop-toolbar h1, span[data-component-type="s-result-info-bar"]').first().text());
  const total = resultText.match(/of\s+(?:over\s+)?([\d.,]+)\s+results/i);
  return {
    query: (() => { try { return new URL(url).searchParams.get('k'); } catch { return null; } })(),
    resultsText: resultText || null,
    totalResults: total ? parseCount(total[1]) : null,
    products,
    nextPage: absolute($('a.s-pagination-next').attr('href'), url),
    url,
  };
}
