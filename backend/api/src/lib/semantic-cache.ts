import { redisConnection } from './queue';
import {
  buildEmbeddingText,
  generateContentCacheKey,
  normalizeChapter,
  type PptRequest,
} from '../shared';
import { fetchCacheEntry } from './cache';
import { cosineSimilarity } from './cosine';

export { cosineSimilarity };

const L2_INDEX_KEY = 'ppt:content:l2:index';
const L2_MAX_INDEX = 5000;
const SAVINGS_PER_HIT_INR = 0.86;

const THRESHOLD = parseFloat(process.env.SEMANTIC_CACHE_THRESHOLD || '0.92');
const STRICT_SLIDES_THRESHOLD = parseFloat(process.env.SEMANTIC_CACHE_STRICT_SLIDES_THRESHOLD || '0.97');

let l2Hits = 0;
let l2Misses = 0;
let lastL2Match: {
  score: number;
  requestChapter: string;
  matchedChapter: string;
} | null = null;

export function getL2Stats() {
  const total = l2Hits + l2Misses;
  return {
    hits: l2Hits,
    misses: l2Misses,
    total,
    hitRate: total > 0 ? `${((l2Hits / total) * 100).toFixed(1)}%` : '0%',
    estimatedSavingsINR: (l2Hits * SAVINGS_PER_HIT_INR).toFixed(2),
    threshold: THRESHOLD,
    indexSize: 0,
    lastMatch: lastL2Match,
  };
}

export async function embedQuery(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
    }),
  });

  if (!response.ok) {
    console.warn('[Cache] L2 embedding failed:', response.status);
    return null;
  }

  const payload: any = await response.json();
  return payload?.data?.[0]?.embedding ?? null;
}

interface L2IndexMeta {
  l1Key: string;
  grade: number;
  subject: string;
  chapter: string;
  numSlides: number;
  embedding: number[];
}

function l2MetaKey(hash: string): string {
  return `ppt:content:l2:${hash}`;
}

export async function indexL2Entry(req: PptRequest, l1Key: string, embedding?: number[]): Promise<void> {
  const hash = l1Key.replace('ppt:content:l1:', '');
  const vector = embedding ?? (await embedQuery(buildEmbeddingText(req)));
  if (!vector) return;

  const meta: L2IndexMeta = {
    l1Key,
    grade: req.grade,
    subject: req.subject.toLowerCase().trim(),
    chapter: normalizeChapter(req.chapter),
    numSlides: req.numSlides,
    embedding: vector,
  };

  await redisConnection.hset(l2MetaKey(hash), {
    l1Key: meta.l1Key,
    grade: String(meta.grade),
    subject: meta.subject,
    chapter: meta.chapter,
    numSlides: String(meta.numSlides),
    embedding: JSON.stringify(meta.embedding),
  });
  await redisConnection.sadd(L2_INDEX_KEY, hash);

  const size = await redisConnection.scard(L2_INDEX_KEY);
  if (size > L2_MAX_INDEX) {
    const members = await redisConnection.smembers(L2_INDEX_KEY);
    const trim = members.slice(0, size - L2_MAX_INDEX);
    for (const h of trim) {
      await redisConnection.srem(L2_INDEX_KEY, h);
      await redisConnection.del(l2MetaKey(h));
    }
  }
}

export interface SemanticMatch {
  entry: NonNullable<Awaited<ReturnType<typeof fetchCacheEntry>>>;
  l1Key: string;
  score: number;
  matchedChapter: string;
}

export async function findSemanticMatch(req: PptRequest): Promise<SemanticMatch | null> {
  const queryVector = await embedQuery(buildEmbeddingText(req));
  if (!queryVector) {
    l2Misses++;
    return null;
  }

  const subjectNorm = req.subject.toLowerCase().trim();
  const hashes = await redisConnection.smembers(L2_INDEX_KEY);
  let best: { score: number; meta: L2IndexMeta } | null = null;

  for (const hash of hashes) {
    const raw = await redisConnection.hgetall(l2MetaKey(hash));
    if (!raw?.l1Key || !raw.embedding) continue;

    const grade = Number(raw.grade);
    const subject = raw.subject;
    const numSlides = Number(raw.numSlides);
    if (grade !== req.grade || subject !== subjectNorm) continue;

    const embedding = JSON.parse(raw.embedding) as number[];
    const score = cosineSimilarity(queryVector, embedding);

    const threshold =
      numSlides === req.numSlides ? THRESHOLD : STRICT_SLIDES_THRESHOLD;

    if (score >= threshold && (!best || score > best.score)) {
      best = {
        score,
        meta: {
          l1Key: raw.l1Key,
          grade,
          subject,
          chapter: raw.chapter,
          numSlides,
          embedding,
        },
      };
    }
  }

  if (!best) {
    l2Misses++;
    return null;
  }

  const entry = await fetchCacheEntry(best.meta.l1Key);
  if (!entry) {
    l2Misses++;
    return null;
  }

  l2Hits++;
  lastL2Match = {
    score: best.score,
    requestChapter: req.chapter,
    matchedChapter: best.meta.chapter,
  };

  console.log(
    `[Cache] L2 HIT score=${best.score.toFixed(3)} req="${req.chapter}" matched="${best.meta.chapter}" saved=₹${SAVINGS_PER_HIT_INR}`,
  );

  return {
    entry,
    l1Key: best.meta.l1Key,
    score: best.score,
    matchedChapter: best.meta.chapter,
  };
}

export async function getL2IndexSize(): Promise<number> {
  return redisConnection.scard(L2_INDEX_KEY);
}

export function contentCacheKeyForRequest(req: PptRequest): string {
  return generateContentCacheKey(req);
}
