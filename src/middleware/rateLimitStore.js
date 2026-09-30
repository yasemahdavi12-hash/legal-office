const Redis = require('ioredis');

/**
 * Rate-limit store: Redis required in production; Memory only in development.
 */
class MemoryRateLimitStore {
  constructor() {
    this.hits = new Map();
  }

  async incr(key, windowMs) {
    const now = Date.now();
    if (this.hits.size > 10000) {
      for (const [k, entry] of this.hits.entries()) {
        if (now - entry.start >= windowMs) this.hits.delete(k);
      }
    }
    let entry = this.hits.get(key);
    if (!entry || now - entry.start >= windowMs) {
      entry = { start: now, count: 0 };
      this.hits.set(key, entry);
    }
    entry.count += 1;
    return {
      count: entry.count,
      resetMs: entry.start + windowMs - now
    };
  }

  async quit() { /* noop */ }
}

class RedisRateLimitStore {
  constructor(client) {
    this.client = client;
  }

  async incr(key, windowMs) {
    const redisKey = `rl:${key}`;
    const count = await this.client.incr(redisKey);
    if (count === 1) {
      await this.client.pexpire(redisKey, windowMs);
    }
    let ttl = await this.client.pttl(redisKey);
    if (ttl < 0) ttl = windowMs;
    return { count, resetMs: ttl };
  }

  async quit() {
    if (this.client) await this.client.quit();
  }
}

let cachedStore = null;

function isProduction() {
  return (process.env.NODE_ENV || 'development') === 'production';
}

function createRateLimitStore() {
  const url = (process.env.REDIS_URL || '').trim();

  if (isProduction()) {
    if (!url) {
      throw new Error('[rateLimit] REDIS_URL is required in production (shared rate-limit store)');
    }
    const client = new Redis(url, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      lazyConnect: false
    });
    client.on('error', (err) => {
      console.error('[rateLimit] Redis error:', err.message);
    });
    return new RedisRateLimitStore(client);
  }

  // Development: Redis if configured, otherwise memory
  if (url) {
    try {
      const client = new Redis(url, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        lazyConnect: false
      });
      client.on('error', () => {});
      return new RedisRateLimitStore(client);
    } catch (err) {
      console.error('[rateLimit] Redis unavailable in development — using memory:', err.message);
    }
  }
  return new MemoryRateLimitStore();
}

function getRateLimitStore() {
  if (!cachedStore) cachedStore = createRateLimitStore();
  return cachedStore;
}

function resetRateLimitStoreForTests(store) {
  cachedStore = store || new MemoryRateLimitStore();
  return cachedStore;
}

module.exports = {
  MemoryRateLimitStore,
  RedisRateLimitStore,
  getRateLimitStore,
  resetRateLimitStoreForTests,
  createRateLimitStore
};
