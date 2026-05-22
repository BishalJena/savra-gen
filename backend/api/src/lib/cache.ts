import { redisConnection } from './queue';
import type { CacheEntry } from '../shared';
import { generateContentCacheKey, type PptRequest } from '../shared';
import { buildDraftOutline } from './outline';
import { generateSlideContent, hasLlmProvider } from './llm';
import { findSemanticMatch, indexL2Entry, getL2Stats, getL2IndexSize } from './semantic-cache';
import type { ContentStrategy, PresentationData } from '../shared';

const CACHE_TTL = 7 * 24 * 60 * 60;
const SAVINGS_PER_HIT_INR = 0.86;

let l1Hits = 0;
let l1Misses = 0;

export { generateContentCacheKey };
export function generateCacheKey(req: PptRequest): string {
  return generateContentCacheKey(req);
}

export async function fetchCacheEntry(cacheKey: string): Promise<CacheEntry | null> {
  try {
    const cached = await redisConnection.get(cacheKey);
    return cached ? JSON.parse(cached) : null;
  } catch (err) {
    console.error('[Cache] L1 read error:', err);
    return null;
  }
}

export async function getFromCache(cacheKey: string): Promise<CacheEntry | null> {
  const entry = await fetchCacheEntry(cacheKey);
  if (entry) {
    l1Hits++;
    console.log(`[Cache] L1 HIT for key ${cacheKey} (total hits: ${l1Hits})`);
    return entry;
  }
  l1Misses++;
  console.log(`[Cache] L1 MISS for key ${cacheKey} (total misses: ${l1Misses})`);
  return null;
}

export async function setInCache(cacheKey: string, entry: CacheEntry): Promise<void> {
  try {
    await redisConnection.setex(cacheKey, CACHE_TTL, JSON.stringify(entry));
    console.log(`[Cache] L1 SET for key ${cacheKey} (TTL: ${CACHE_TTL}s)`);
  } catch (err) {
    console.error('[Cache] L1 write error:', err);
  }
}

export interface ResolvedContent {
  presentation: PresentationData;
  strategy: ContentStrategy;
  cached: boolean;
  cacheKey: string;
  similarityScore?: number;
  matchedChapter?: string;
  model?: string;
  tokensUsed?: number;
}

export async function resolvePresentation(req: PptRequest): Promise<ResolvedContent> {
  const cacheKey = generateContentCacheKey(req);

  const l1 = await getFromCache(cacheKey);
  if (l1) {
    return {
      presentation: l1.presentation,
      strategy: 'l1-cache',
      cached: true,
      cacheKey,
      model: l1.model,
      tokensUsed: 0,
    };
  }

  const l2 = await findSemanticMatch(req);
  if (l2?.entry) {
    return {
      presentation: l2.entry.presentation,
      strategy: 'l2-semantic',
      cached: true,
      cacheKey: l2.l1Key,
      similarityScore: l2.score,
      matchedChapter: l2.matchedChapter,
      model: l2.entry.model + ' (semantic)',
      tokensUsed: 0,
    };
  }

  if (hasLlmProvider()) {
    try {
      const result = await generateSlideContent(req);
      const entry: CacheEntry = {
        presentation: result.presentation,
        createdAt: new Date().toISOString(),
        model: result.model,
        tokensUsed: result.tokensUsed,
      };
      await setInCache(cacheKey, entry);
      await indexL2Entry(req, cacheKey);
      return {
        presentation: result.presentation,
        strategy: 'llm',
        cached: false,
        cacheKey,
        model: result.model,
        tokensUsed: result.tokensUsed,
      };
    } catch (err) {
      console.warn('[LLM] Outline generation failed; returning template fallback:', err);
      const presentation = buildDraftOutline(req);
      return {
        presentation,
        strategy: 'template-fallback',
        cached: false,
        cacheKey,
        model: 'template-fallback',
        tokensUsed: 0,
      };
    }
  }

  const presentation = buildDraftOutline(req);
  const entry: CacheEntry = {
    presentation,
    createdAt: new Date().toISOString(),
    model: 'template',
    tokensUsed: 0,
  };
  await setInCache(cacheKey, entry);
  return {
    presentation,
    strategy: 'template',
    cached: false,
    cacheKey,
    model: 'template',
    tokensUsed: 0,
  };
}

export async function getCacheStats() {
  const l1Total = l1Hits + l1Misses;
  const l2 = getL2Stats();
  const indexSize = await getL2IndexSize();
  const combinedHits = l1Hits + l2.hits;
  const combinedTotal = l1Total + l2.total;

  return {
    l1: {
      hits: l1Hits,
      misses: l1Misses,
      total: l1Total,
      hitRate: l1Total > 0 ? `${((l1Hits / l1Total) * 100).toFixed(1)}%` : '0%',
      estimatedSavingsINR: (l1Hits * SAVINGS_PER_HIT_INR).toFixed(2),
    },
    l2: { ...l2, indexSize },
    combinedHitRate:
      combinedTotal > 0 ? `${((combinedHits / combinedTotal) * 100).toFixed(1)}%` : '0%',
    hits: l1Hits,
    misses: l1Misses,
    hitRate: l1Total > 0 ? `${((l1Hits / l1Total) * 100).toFixed(1)}%` : '0%',
    estimatedSavingsINR: (combinedHits * SAVINGS_PER_HIT_INR).toFixed(2),
  };
}
