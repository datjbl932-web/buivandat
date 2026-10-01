// SQLite: API token, thống kê sử dụng, cache, job hàng loạt
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS tokens (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      hash TEXT NOT NULL UNIQUE,
      prefix TEXT NOT NULL,
      webhook_secret TEXT NOT NULL,
      rate_limit INTEGER,           -- request/phút; NULL = mặc định
      monthly_quota INTEGER,        -- số request thành công/tháng; NULL = không giới hạn
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS usage (
      token_id INTEGER NOT NULL,
      day TEXT NOT NULL,
      success INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      cached INTEGER NOT NULL DEFAULT 0,
      bytes INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (token_id, day)
    );
    CREATE TABLE IF NOT EXISTS cache (
      key TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      status INTEGER NOT NULL,
      final_url TEXT,
      body BLOB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cache_exp ON cache(expires_at);
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      token_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      scraper TEXT,
      options TEXT NOT NULL,
      callback_url TEXT,
      total INTEGER NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'queued'
    );
    CREATE TABLE IF NOT EXISTS job_items (
      job_id TEXT NOT NULL,
      idx INTEGER NOT NULL,
      url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',   -- queued | running | done | failed
      attempts INTEGER NOT NULL DEFAULT 0,
      result TEXT,
      updated_at INTEGER,
      PRIMARY KEY (job_id, idx)
    );
    CREATE INDEX IF NOT EXISTS job_items_q ON job_items(status);
  `);
  return db;
}

export const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
export const today = () => new Date().toISOString().slice(0, 10);

export function createToken(db, { name, rateLimit = null, monthlyQuota = null }) {
  const token = 'dc_' + crypto.randomBytes(24).toString('base64url');
  const secret = crypto.randomBytes(24).toString('base64url');
  const info = db.prepare(`INSERT INTO tokens (name, hash, prefix, webhook_secret, rate_limit, monthly_quota, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(name, hashToken(token), token.slice(0, 8), secret, rateLimit, monthlyQuota, Date.now());
  return { id: info.lastInsertRowid, token, webhookSecret: secret };
}

export function findToken(db, token) {
  if (!token || typeof token !== 'string') return null;
  return db.prepare('SELECT * FROM tokens WHERE hash = ? AND disabled = 0').get(hashToken(token)) || null;
}

export function recordUsage(db, tokenId, { ok, cached = false, bytes = 0 }) {
  db.prepare(`INSERT INTO usage (token_id, day, success, failed, cached, bytes) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(token_id, day) DO UPDATE SET success = success + excluded.success, failed = failed + excluded.failed,
    cached = cached + excluded.cached, bytes = bytes + excluded.bytes`)
    .run(tokenId, today(), ok ? 1 : 0, ok ? 0 : 1, cached ? 1 : 0, bytes);
}

export function monthSuccess(db, tokenId) {
  const month = today().slice(0, 7);
  return db.prepare("SELECT COALESCE(SUM(success), 0) n FROM usage WHERE token_id = ? AND day LIKE ? || '%'").get(tokenId, month).n;
}
