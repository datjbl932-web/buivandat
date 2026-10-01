// Cấu hình đọc từ biến môi trường (xem .env.example)
import fs from 'node:fs';
import path from 'node:path';

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadDotEnv(path.resolve(process.cwd(), '.env'));

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));

export const config = {
  port: num(process.env.PORT, 8080),
  host: process.env.HOST || '0.0.0.0',
  dbPath: process.env.DB_PATH || './data/datcrawl.db',
  adminToken: process.env.ADMIN_TOKEN || '',
  proxiesFile: process.env.PROXIES_FILE || './proxies.txt',
  proxies: process.env.PROXIES || '',              // danh sách proxy, cách nhau bởi dấu phẩy
  useDirect: bool(process.env.USE_DIRECT, false),  // cho phép gọi thẳng (không proxy) khi hết proxy
  concurrency: num(process.env.CONCURRENCY, 10),   // số request đồng thời toàn hệ thống
  perDomainConcurrency: num(process.env.PER_DOMAIN_CONCURRENCY, 4),
  perProxyDelayMs: num(process.env.PER_PROXY_DELAY_MS, 1500), // nghỉ giữa 2 request cùng proxy + cùng domain
  maxRetries: num(process.env.MAX_RETRIES, 4),
  timeoutMs: num(process.env.TIMEOUT_MS, 30000),
  maxBodyBytes: num(process.env.MAX_BODY_BYTES, 10 * 1024 * 1024),
  cacheTtlSec: num(process.env.CACHE_TTL_SEC, 3600),
  defaultRateLimit: num(process.env.DEFAULT_RATE_LIMIT, 60), // request/phút cho mỗi token
  allowPrivateNetworks: bool(process.env.ALLOW_PRIVATE_NETWORKS, false), // CHỈ bật khi test
  jobWorkers: num(process.env.JOB_WORKERS, 4),
  enableJs: bool(process.env.ENABLE_JS, false),    // dùng Playwright cho &javascript=true (cần cài thêm)
  logLevel: process.env.LOG_LEVEL || 'info',
};
