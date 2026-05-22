import type { Redis } from 'ioredis';
import {
  buildEmbeddingText,
  generateContentCacheKey,
  normalizeChapter,
  type CacheEntry,
  type PptRequest,
} from '../shared';
import { generateSlideContent, generateMockSlideContent } from '../llm';

const CACHE_TTL = 7 * 24 * 60 * 60;
const L2_INDEX_KEY = 'ppt:content:l2:index';
const THRESHOLD = parseFloat(process.env.SEMANTIC_CACHE_THRESHOLD || '0.92');
const STRICT_SLIDES_THRESHOLD = parseFloat(process.env.SEMANTIC_CACHE_STRICT_SLIDES_THRESHOLD || '0.97');

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

async function embedQuery(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
  });
  if (!response.ok) return null;
  const payload: any = await response.json();
  return payload?.data?.[0]?.embedding ?? null;
}

function l2MetaKey(hash: string): string {
  return `ppt:content:l2:${hash}`;
}

async function fetchEntry(redis: Redis, cacheKey: string): Promise<CacheEntry | null> {
  const cached = await redis.get(cacheKey);
  return cached ? JSON.parse(cached) : null;
}

async function findSemanticMatch(redis: Redis, req: PptRequest): Promise<{ entry: CacheEntry; score: number } | null> {
  const queryVector = await embedQuery(buildEmbeddingText(req));
  if (!queryVector) return null;

  const subjectNorm = req.subject.toLowerCase().trim();
  const hashes = await redis.smembers(L2_INDEX_KEY);
  let best: { score: number; l1Key: string } | null = null;

  for (const hash of hashes) {
    const raw = await redis.hgetall(l2MetaKey(hash));
    if (!raw?.l1Key || !raw.embedding) continue;
    if (Number(raw.grade) !== req.grade || raw.subject !== subjectNorm) continue;

    const numSlides = Number(raw.numSlides);
    const score = cosineSimilarity(queryVector, JSON.parse(raw.embedding));
    const threshold = numSlides === req.numSlides ? THRESHOLD : STRICT_SLIDES_THRESHOLD;
    if (score >= threshold && (!best || score > best.score)) {
      best = { score, l1Key: raw.l1Key };
    }
  }

  if (!best) return null;
  const entry = await fetchEntry(redis, best.l1Key);
  if (!entry) return null;

  console.log(`[Cache] L2 HIT (worker) score=${best.score.toFixed(3)} chapter="${req.chapter}"`);
  return { entry, score: best.score };
}

export async function loadCachedPresentation(
  redis: Redis,
  req: PptRequest,
  cacheKey: string,
): Promise<{ entry: CacheEntry; source: 'l1' | 'l2'; score?: number } | null> {
  const l1 = await fetchEntry(redis, cacheKey);
  if (l1) {
    console.log(`[Cache] L1 HIT (worker) for "${req.chapter}"`);
    return { entry: l1, source: 'l1' };
  }

  const l2 = await findSemanticMatch(redis, req);
  if (l2) return { entry: l2.entry, source: 'l2', score: l2.score };

  return null;
}

export async function storePresentation(
  redis: Redis,
  req: PptRequest,
  entry: CacheEntry,
): Promise<string> {
  const cacheKey = generateContentCacheKey(req);
  await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(entry));

  const vector = await embedQuery(buildEmbeddingText(req));
  if (vector) {
    const hash = cacheKey.replace('ppt:content:l1:', '');
    await redis.hset(l2MetaKey(hash), {
      l1Key: cacheKey,
      grade: String(req.grade),
      subject: req.subject.toLowerCase().trim(),
      chapter: normalizeChapter(req.chapter),
      numSlides: String(req.numSlides),
      embedding: JSON.stringify(vector),
    });
    await redis.sadd(L2_INDEX_KEY, hash);
  }

  return cacheKey;
}

export async function generateFreshContent(req: PptRequest) {
  const useMock = !process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY;
  if (useMock) {
    const mock = generateMockSlideContent(req);
    return {
      presentation: mock.presentation,
      model: mock.model,
      tokensUsed: 0,
      costINR: 0,
    };
  }
  const result = await generateSlideContent(req);
  return {
    presentation: result.presentation,
    model: result.model,
    tokensUsed: result.tokensUsed,
    costINR: result.costINR,
  };
}
