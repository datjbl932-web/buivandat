// Danh sách scraper. Tên giống Crawlbase để dễ chuyển code sang.
import { parseProduct } from './amazon/product.js';
import { parseSearch } from './amazon/search.js';
import { parseBestSellers } from './amazon/bestsellers.js';
import { parseGeneric } from './generic.js';

export const SCRAPERS = {
  'amazon-product-details': { site: 'amazon', parse: parseProduct, describe: 'Trang sản phẩm Amazon (/dp/ASIN)' },
  'amazon-serp': { site: 'amazon', parse: parseSearch, describe: 'Kết quả tìm kiếm Amazon (/s?k=...)' },
  'amazon-best-sellers': { site: 'amazon', parse: parseBestSellers, describe: 'Best Sellers / New Releases của Amazon' },
  generic: { site: null, parse: parseGeneric, describe: 'Mọi website: tiêu đề, mô tả, Open Graph, JSON-LD, liên kết' },
};

/** scraper=auto: đoán scraper theo URL */
export function detectScraper(url) {
  let u; try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)amazon\./i.test(u.hostname)) return 'generic';
  if (/\/(dp|gp\/product|gp\/aw\/d)\/[A-Z0-9]{10}/i.test(u.pathname)) return 'amazon-product-details';
  if (/^\/s(\/|$)/.test(u.pathname) && (u.searchParams.has('k') || u.searchParams.has('rh'))) return 'amazon-serp';
  if (/\/(zgbs|gp\/bestsellers|gp\/new-releases|gp\/movers-and-shakers|Best-Sellers)/i.test(u.pathname)) return 'amazon-best-sellers';
  return 'generic';
}
