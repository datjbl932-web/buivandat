// scraper=amazon-product-details – trang sản phẩm Amazon (/dp/ASIN)
import * as cheerio from 'cheerio';
import { clean, parsePrice, parseRating, parseCount, absolute, asinFromUrl, largestDynamicImage, marketplace } from './common.js';

const first = ($, sels) => {
  for (const s of sels) {
    const el = $(s).first();
    if (el.length && clean(el.text())) return el;
  }
  return null;
};

export function parseProduct(html, url) {
  const $ = cheerio.load(html);
  const text = (sels) => clean(first($, sels)?.text());

  const asin = asinFromUrl(url) || clean($('input#ASIN').attr('value')) || clean($('[data-asin]').first().attr('data-asin')) || null;

  const priceEl = first($, [
    '#corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen',
    '#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-offscreen',
    '#apex_desktop .a-price:not(.a-text-price) .a-offscreen',
    '#priceblock_dealprice', '#priceblock_ourprice', '#priceblock_saleprice',
    '#price_inside_buybox', '#newBuyBoxPrice', '#kindle-price', '.a-price .a-offscreen',
  ]);
  const listEl = first($, [
    '#corePriceDisplay_desktop_feature_div .basisPrice .a-offscreen',
    '#corePrice_feature_div .a-price.a-text-price .a-offscreen',
    '.a-price.a-text-price[data-a-strike="true"] .a-offscreen', '#listPrice', '#priceblock_listprice',
  ]);
  const price = priceEl ? parsePrice(priceEl.text(), url) : null;
  const listPrice = listEl ? parsePrice(listEl.text(), url) : null;

  const ratingText = clean($('#acrPopover').attr('title')) || text(['#acrPopover .a-icon-alt', 'i.a-icon-star .a-icon-alt', '[data-hook="rating-out-of-text"]']);
  const availability = text(['#availability span', '#availability', '#outOfStock']);
  const inStock = availability
    ? !/currently unavailable|out of stock|nicht verfügbar|indisponible|non disponibile|no disponible|在庫切れ/i.test(availability)
    : $('#add-to-cart-button').length > 0;

  // ảnh: ảnh chính + danh sách ảnh độ phân giải cao trong script "colorImages"
  const landing = $('#landingImage, #imgBlkFront, #ebooksImgBlkFront').first();
  const mainImage = clean(landing.attr('data-old-hires')) || largestDynamicImage(landing.attr('data-a-dynamic-image')) || clean(landing.attr('src')) || null;
  const images = new Set(mainImage ? [mainImage] : []);
  for (const m of html.matchAll(/"hiRes":"(https:[^"]+)"/g)) images.add(m[1]);
  for (const m of html.matchAll(/"large":"(https:[^"]+)"/g)) if (images.size < 30) images.add(m[1]);

  const features = $('#feature-bullets li span.a-list-item, #feature-bullets li')
    .map((_, el) => clean($(el).text())).get()
    .filter((s, i, a) => s && !/^›?\s*See more product details/i.test(s) && a.indexOf(s) === i);

  const info = [];
  $('#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr, #productDetails_feature_div table tr, #prodDetails table tr').each((_, tr) => {
    const name = clean($(tr).find('th').first().text()); const value = clean($(tr).find('td').first().text());
    if (name && value) info.push({ name, value });
  });
  $('#detailBullets_feature_div li span.a-list-item').each((_, li) => {
    const name = clean($(li).find('span.a-text-bold').first().text()).replace(/\s*[:‏‎]+\s*$/, '');
    const value = clean($(li).clone().find('span.a-text-bold').remove().end().text());
    if (name && value) info.push({ name, value });
  });
  const dedup = [...new Map(info.map((x) => [x.name.toLowerCase(), x])).values()];
  const rankEntry = dedup.find((x) => /best sellers rank|bestseller-rang|classement des meilleures ventes|売れ筋ランキング/i.test(x.name));
  const bestSellersRank = rankEntry
    ? [...rankEntry.value.replace(/\([^)]*\)/g, ' ').matchAll(/(?:#|Nr\.\s*|n\.\s*|nº\s*)([\d.,]+)\s+(?:in|en|dans|に)\s+(.+?)(?=\s*(?:#|Nr\.|n\.\s*\d|nº)|$)/gi)].map((m) => ({ rank: parseCount(m[1]), category: clean(m[2]) }))
    : [];

  let brand = text(['#bylineInfo', '#brand', 'a#brand']);
  brand = brand.replace(/^(Visit the|Besuche den|Visitez la boutique|Visita lo Store di|Visita la tienda de)\s+/i, '').replace(/[\s-]+(Store|Shop)$/i, '').replace(/^(Brand|Marke|Marque|Marca):\s*/i, '') || null;

  return {
    asin,
    name: text(['#productTitle', '#title', 'h1#title']) || null,
    brand,
    price: price?.value ?? null,
    listPrice: listPrice?.value ?? null,
    currency: price?.currency ?? listPrice?.currency ?? null,
    rawPrice: price?.raw ?? null,
    rating: parseRating(ratingText),
    reviewsCount: parseCount(text(['#acrCustomerReviewText', '[data-hook="total-review-count"]'])),
    availability: availability || null,
    inStock,
    isPrime: $('#primeSavingsUpsellAccordionRow, #prime-badge, #apex_desktop i.a-icon-prime, #deliveryBlockMessage i.a-icon-prime').length > 0,
    seller: text(['#sellerProfileTriggerId', '#merchant-info a', '#merchantInfoFeature_feature_div .offer-display-feature-text-message']) || null,
    mainImage,
    images: [...images],
    features,
    description: text(['#productDescription', '#bookDescription_feature_div .a-expander-content', '#aplus_feature_div']) || null,
    breadcrumbs: $('#wayfinding-breadcrumbs_feature_div li a, #wayfinding-breadcrumbs_container li a').map((_, a) => clean($(a).text())).get().filter(Boolean),
    bestSellersRank,
    productInformation: dedup,
    marketplace: marketplace(url),
    url,
  };
}
