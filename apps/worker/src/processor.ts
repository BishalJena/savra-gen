// Main job processor — handles the full PPT generation pipeline
// Pipeline: Check cache → Call LLM → Build PPTX → Update job status
import { Job } from 'bullmq';
import type { PptJobData, CacheEntry } from './shared';
import { generateSlideContent, generateMockSlideContent } from './llm';
import { buildPptx } from './pptx-builder';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const USE_MOCK = !process.env.ANTHROPIC_API_KEY;

const redis = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const CACHE_TTL = 7 * 24 * 60 * 60; // 7 days

export async function processJob(job: Job<PptJobData>) {
  const { topic, grade, subject, numSlides, cacheKey } = job.data;
  const startTime = Date.now();

  console.log(`\n[Processor] Starting job ${job.id}: "${topic}" (Grade ${grade}, ${numSlides} slides)`);

  // Step 1: Check L1 cache
  await job.updateProgress({ step: 'Checking cache...', percent: 10, cached: false });

  try {
    const cachedEntry = await redis.get(cacheKey);
    if (cachedEntry) {
      const entry: CacheEntry = JSON.parse(cachedEntry);
      console.log(`[Processor] Cache HIT for "${topic}" — skipping LLM call`);

      await job.updateProgress({ step: 'Cache hit! Building slides...', percent: 60, cached: true });

      // Rebuild PPTX from cached JSON (fast, ~1s, free)
      const filePath = await buildPptx(entry.presentation, job.id!);
      const elapsed = Date.now() - startTime;

      console.log(`[Processor] Job ${job.id} completed from cache in ${elapsed}ms`);

      return {
        filePath,
        tokensUsed: 0,
        costINR: 0,
        model: entry.model + ' (cached)',
        cached: true,
        slidePreview: entry.presentation.slides.map(s => ({ type: s.slideType, title: s.title })),
        elapsedMs: elapsed,
      };
    }
  } catch (err) {
    console.warn('[Processor] Cache check failed, proceeding to LLM:', err);
  }

  // Step 2: Generate content via LLM
  await job.updateProgress({ step: 'Generating slide content with AI...', percent: 30, cached: false });

  let result;
  if (USE_MOCK) {
    console.log('[Processor] Using MOCK mode (no ANTHROPIC_API_KEY set)');
    result = generateMockSlideContent(topic, grade, subject, numSlides);
  } else {
    result = await generateSlideContent(topic, grade, subject, numSlides);
  }

  // Step 3: Cache the result
  await job.updateProgress({ step: 'Caching result...', percent: 70, cached: false });

  try {
    const cacheEntry: CacheEntry = {
      presentation: result.presentation,
      createdAt: new Date().toISOString(),
      model: result.model,
      tokensUsed: result.tokensUsed,
    };
    await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(cacheEntry));
    console.log(`[Processor] Cached result for "${topic}" (TTL: ${CACHE_TTL}s)`);
  } catch (err) {
    console.warn('[Processor] Cache write failed (non-fatal):', err);
  }

  // Step 4: Build PPTX from structured JSON
  await job.updateProgress({ step: 'Building your presentation...', percent: 85, cached: false });

  const filePath = await buildPptx(result.presentation, job.id!);

  // Step 5: Done
  await job.updateProgress({ step: 'Done!', percent: 100, cached: false });

  const elapsed = Date.now() - startTime;
  console.log(`[Processor] Job ${job.id} completed in ${elapsed}ms (model: ${result.model}, cost: ₹${result.costINR.toFixed(2)})`);

  return {
    filePath,
    tokensUsed: result.tokensUsed,
    costINR: result.costINR,
    model: result.model,
    cached: false,
    slidePreview: result.presentation.slides.map(s => ({ type: s.slideType, title: s.title })),
    elapsedMs: elapsed,
  };
}
