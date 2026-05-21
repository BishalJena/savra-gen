// L1 Exact-match cache layer using Redis
// Cache key: SHA-256 hash of normalized request params
// Stores generated slide JSON (not PPTX files — those are rebuilt cheaply)
import { createHash } from 'crypto';
import { redisConnection } from './queue';
import type { CacheEntry } from '../shared';
import { normalizeRequest, type PptRequest } from '../shared';

const CACHE_PREFIX = 'ppt:l1:';
const CACHE_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

// Metrics counters (in-memory for prototype; use Redis INCR in production)
let cacheHits = 0;
let cacheMisses = 0;

export function generateCacheKey(req: PptRequest): string {
  const normalized = normalizeRequest(req);
  const hash = createHash('sha256').update(normalized).digest('hex').substring(0, 16);
  return `${CACHE_PREFIX}${hash}`;
}

export async function getFromCache(cacheKey: string): Promise<CacheEntry | null> {
  try {
    const cached = await redisConnection.get(cacheKey);
    if (cached) {
      cacheHits++;
      console.log(`[Cache] L1 HIT for key ${cacheKey} (total hits: ${cacheHits})`);
      return JSON.parse(cached);
    }
    cacheMisses++;
    console.log(`[Cache] L1 MISS for key ${cacheKey} (total misses: ${cacheMisses})`);
    return null;
  } catch (err) {
    console.error('[Cache] L1 read error:', err);
    return null; // Cache failure should not block generation
  }
}

export async function setInCache(cacheKey: string, entry: CacheEntry): Promise<void> {
  try {
    await redisConnection.setex(cacheKey, CACHE_TTL, JSON.stringify(entry));
    console.log(`[Cache] L1 SET for key ${cacheKey} (TTL: ${CACHE_TTL}s)`);
  } catch (err) {
    console.error('[Cache] L1 write error:', err);
    // Non-fatal — generation still succeeds
  }
}

export function getCacheStats() {
  const total = cacheHits + cacheMisses;
  return {
    hits: cacheHits,
    misses: cacheMisses,
    total,
    hitRate: total > 0 ? ((cacheHits / total) * 100).toFixed(1) + '%' : '0%',
    estimatedSavingsINR: (cacheHits * 0.86).toFixed(2), // ₹0.86 saved per cache hit
  };
}
