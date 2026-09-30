const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const root = path.join(__dirname, '..', '..');
const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

function requireEnv(name, { minLength = 1, allowEmpty = false } = {}) {
  const value = process.env[name];
  if (value === undefined || value === null || (!allowEmpty && String(value).trim() === '')) {
    throw new Error(`[config] ${name} must be set in environment (.env)`);
  }
  if (minLength && String(value).length < minLength) {
    throw new Error(`[config] ${name} must be at least ${minLength} characters`);
  }
  return value;
}

function requireSecret(name) {
  return requireEnv(name, { minLength: 32 });
}

/** Production defaults to MySQL; development defaults to SQLite. */
const rawClient = (process.env.DB_CLIENT
  || (isProd ? 'mysql' : 'sqlite')).toLowerCase();

function buildKnexConfig() {
  const migrations = {
    directory: path.join(root, 'database', 'migrations'),
    tableName: 'knex_migrations'
  };
  const seeds = {
    directory: path.join(root, 'database', 'seeds')
  };

  if (rawClient === 'mysql' || rawClient === 'mysql2') {
    if (isProd) {
      requireEnv('DB_HOST');
      requireEnv('DB_NAME');
      requireEnv('DB_USER');
      if (process.env.DB_PASSWORD === undefined) {
        throw new Error('[config] DB_PASSWORD must be set in production (use empty string only if intentional)');
      }
    }
    return {
      client: 'mysql2',
      connection: {
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD != null ? process.env.DB_PASSWORD : '',
        database: process.env.DB_NAME || 'legal_app',
        charset: 'utf8mb4',
        timezone: 'Z',
        multipleStatements: false
      },
      pool: { min: 1, max: 10 },
      migrations,
      seeds
    };
  }

  if (rawClient === 'pg' || rawClient === 'postgres' || rawClient === 'postgresql') {
    if (isProd) {
      throw new Error('[config] Production database must be MySQL (DB_CLIENT=mysql). PostgreSQL is not enabled for production in this release.');
    }
    return {
      client: 'pg',
      connection: {
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 5432),
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'legal_app'
      },
      pool: { min: 1, max: 10 },
      migrations,
      seeds
    };
  }

  if (isProd) {
    throw new Error('[config] Production requires DB_CLIENT=mysql (SQLite is development-only)');
  }

  // Development SQLite — sqlite3 is an optionalDependency
  try {
    require.resolve('sqlite3');
  } catch {
    throw new Error('[config] sqlite3 is not installed. Run npm install (optionalDependency) or set DB_CLIENT=mysql');
  }

  const filename = path.resolve(root, process.env.DB_FILENAME || './database/legal.sqlite');
  return {
    client: 'sqlite3',
    connection: { filename },
    useNullAsDefault: true,
    pool: {
      afterCreate(conn, done) {
        conn.run('PRAGMA foreign_keys = ON', done);
      }
    },
    migrations,
    seeds
  };
}

const DEV_CORS_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

const corsOriginRaw = process.env.CORS_ORIGIN || '';
const corsFromEnv = corsOriginRaw
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const corsOrigins = isProd
  ? corsFromEnv
  : [...new Set([...DEV_CORS_ORIGINS, ...corsFromEnv])];

if (isProd && (!corsOrigins.length || corsOrigins.includes('*'))) {
  throw new Error('[config] CORS_ORIGIN must be set to explicit frontend origin(s) in production (no *)');
}

if (isProd) {
  if (!(process.env.REDIS_URL || '').trim()) {
    throw new Error('[config] REDIS_URL is required in production for shared rate limiting');
  }
  const backupKey = process.env.BACKUP_ENCRYPTION_KEY || '';
  if (!backupKey || backupKey.length < 32) {
    throw new Error('[config] BACKUP_ENCRYPTION_KEY (≥32) is required in production');
  }
  const mfaKey = process.env.MFA_ENCRYPTION_KEY || process.env.BACKUP_ENCRYPTION_KEY || '';
  if (!mfaKey || mfaKey.length < 32) {
    throw new Error('[config] MFA_ENCRYPTION_KEY or BACKUP_ENCRYPTION_KEY is required in production');
  }
  // Off-server backup credentials are validated when backup runs; warn at boot if missing
  const driver = (process.env.BACKUP_STORAGE || 's3').toLowerCase();
  if (driver === 's3' || driver === 's3-compatible') {
    if (!process.env.S3_ENDPOINT || !process.env.S3_BUCKET
      || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) {
      throw new Error('[config] S3 backup credentials required in production (S3_ENDPOINT/BUCKET/ACCESS_KEY_ID/SECRET)');
    }
  } else {
    throw new Error('[config] Production requires BACKUP_STORAGE=s3');
  }
  const pubUrl = (process.env.APP_PUBLIC_URL || process.env.PUBLIC_APP_URL || '').trim();
  if (!pubUrl) {
    throw new Error('[config] APP_PUBLIC_URL is required in production (HTTPS public origin for invitation links)');
  }
  if (!/^https:\/\//i.test(pubUrl)) {
    throw new Error('[config] APP_PUBLIC_URL must use HTTPS in production');
  }
}

const zarinpalSandbox = String(process.env.ZARINPAL_SANDBOX || 'false').toLowerCase() === 'true';
const zarinpalMerchantId = (process.env.ZARINPAL_MERCHANT_ID || '').trim();
const zarinpalCallbackUrl = (process.env.ZARINPAL_CALLBACK_URL || '').trim();

const knexConfig = buildKnexConfig();
const dbClient = knexConfig.client;

const port = Number(process.env.PORT || 3000);
const publicAppUrlRaw = (process.env.APP_PUBLIC_URL || process.env.PUBLIC_APP_URL || '').trim();
const publicAppUrl = publicAppUrlRaw || `http://localhost:${port}`;

module.exports = {
  port,
  nodeEnv,
  isProd,
  publicAppUrl,
  invitation: {
    tokenTtlDays: Number(process.env.INVITATION_TOKEN_TTL_DAYS || 7)
  },
  dbClient,
  knex: knexConfig,
  jwt: {
    accessSecret: requireSecret('JWT_ACCESS_SECRET'),
    refreshSecret: requireSecret('JWT_REFRESH_SECRET'),
    accessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
    refreshExpires: process.env.JWT_REFRESH_EXPIRES || '30d'
  },
  uploadDir: path.resolve(root, process.env.UPLOAD_DIR || './storage/uploads'),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 20),
  corsOrigins,
  admin: {
    email: process.env.ADMIN_EMAIL || '',
    password: process.env.ADMIN_PASSWORD || '',
    name: process.env.ADMIN_NAME || 'مدیر سیستم'
  },
  zarinpal: {
    merchantId: zarinpalMerchantId,
    sandbox: zarinpalSandbox,
    callbackUrl: zarinpalCallbackUrl
  },
  vapid: {
    publicKey: (process.env.VAPID_PUBLIC_KEY || '').trim(),
    privateKey: (process.env.VAPID_PRIVATE_KEY || '').trim(),
    subject: (process.env.VAPID_SUBJECT || 'mailto:admin@legal.local').trim()
  },
  defaultTimezone: process.env.DEFAULT_TIMEZONE || 'Asia/Tehran',
  mysql: {
    host: process.env.DB_HOST || '',
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME || '',
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD != null ? process.env.DB_PASSWORD : ''
  },
  redisUrl: (process.env.REDIS_URL || '').trim(),
  backup: {
    encryptionKeySet: !!(process.env.BACKUP_ENCRYPTION_KEY && process.env.BACKUP_ENCRYPTION_KEY.length >= 32),
    storage: (process.env.BACKUP_STORAGE || (isProd ? 's3' : 'local')).toLowerCase(),
    retentionCount: Number(process.env.BACKUP_RETENTION_COUNT || 14)
  },
  mfa: {
    encryptionKeySet: !!(
      (process.env.MFA_ENCRYPTION_KEY && process.env.MFA_ENCRYPTION_KEY.length >= 32)
      || (process.env.BACKUP_ENCRYPTION_KEY && process.env.BACKUP_ENCRYPTION_KEY.length >= 32)
    ),
    requiredForAdminInProd: true
  },
  documents: {
    softDeleteRetentionDays: Number(process.env.DOCUMENT_SOFT_DELETE_RETENTION_DAYS || 30)
  },
  /** AI assistant — disabled unless AI_ENABLED=true and AI_API_KEY set. Never crash on missing key. */
  ai: {
    enabled: String(process.env.AI_ENABLED || 'false').toLowerCase() === 'true',
    apiKey: (process.env.AI_API_KEY || '').trim(),
    baseUrl: (process.env.AI_BASE_URL || 'https://api.openai.com/v1').trim().replace(/\/$/, ''),
    model: (process.env.AI_MODEL || 'gpt-4o-mini').trim(),
    maxInputChars: Number(process.env.AI_MAX_INPUT_CHARS || 2000),
    maxOutputTokens: Number(process.env.AI_MAX_OUTPUT_TOKENS || 1024),
    maxContextChars: Number(process.env.AI_MAX_CONTEXT_CHARS || 4000),
    dailyLimitPro: Number(process.env.AI_DAILY_LIMIT_PRO || 50)
  }
};
