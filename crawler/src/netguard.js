// Chống SSRF: không cho crawl / gọi webhook vào mạng nội bộ, localhost, metadata cloud…
import dns from 'node:dns/promises';
import net from 'node:net';

const BLOCKED_V4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
const v4int = (ip) => ip.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const n = v4int(ip);
    return BLOCKED_V4.some(([base, bits]) => (n >>> (32 - bits)) === (v4int(base) >>> (32 - bits)));
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    if (x === '::' || x === '::1') return true;
    if (x.startsWith('::ffff:')) return isPrivateIp(x.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x);
  }
  return true;
}

export class UrlError extends Error {}

/** Kiểm tra URL hợp lệ để crawl. Trả về URL đã chuẩn hoá. */
export async function assertPublicUrl(raw, { allowPrivate = false } = {}) {
  let u;
  try { u = new URL(raw); } catch { throw new UrlError('URL không hợp lệ'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new UrlError('Chỉ hỗ trợ http và https');
  if (u.username || u.password) throw new UrlError('URL không được chứa tài khoản/mật khẩu');
  if (allowPrivate) return u;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) throw new UrlError('Không được crawl địa chỉ nội bộ');
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true, verbatim: true }).catch(() => [])).map((a) => a.address);
  if (!addrs.length) throw new UrlError('Không phân giải được tên miền');
  if (addrs.some(isPrivateIp)) throw new UrlError('Không được crawl địa chỉ nội bộ');
  return u;
}
