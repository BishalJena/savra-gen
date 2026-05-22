// Main job processor — handles the full PPT generation pipeline
import { Job } from 'bullmq';
import type { PptJobData, CacheEntry } from './shared';
import { buildPptx } from './pptx-builder';
import IORedis from 'ioredis';
import { generateFreshContent, loadCachedPresentation, storePresentation } from './lib/content-cache';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const redis = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

export async function processJob(job: Job<PptJobData>) {
  const { chapter, grade, subject, numSlides, cacheKey, approvedPresentation } = job.data;
  const req = { chapter, grade, subject, numSlides };
  const startTime = Date.now();

  console.log(`\n[Processor] Starting job ${job.id}: "${chapter}" (Class ${grade}, ${numSlides} slides)`);

  await job.updateProgress({ step: 'Checking cache...', percent: 10, cached: false });

  if (approvedPresentation) {
    await job.updateProgress({ step: 'Rendering teacher-approved slides...', percent: 75, cached: false });
    const filePath = await buildPptx(approvedPresentation, job.id!);
    const elapsed = Date.now() - startTime;
    console.log(`[Processor] Job ${job.id} rendered from approved outline in ${elapsed}ms`);
    return {
      filePath,
      tokensUsed: 0,
      costINR: 0,
      model: 'teacher-approved outline',
      cached: false,
      slidePreview: approvedPresentation.slides.map((s) => ({ type: s.slideType, title: s.title })),
      elapsedMs: elapsed,
    };
  }

  try {
    const cached = await loadCachedPresentation(redis, req, cacheKey);
    if (cached) {
      await job.updateProgress({
        step: cached.source === 'l2' ? 'Semantic cache hit! Building slides...' : 'Cache hit! Building slides...',
        percent: 60,
        cached: true,
      });
      const filePath = await buildPptx(cached.entry.presentation, job.id!);
      const elapsed = Date.now() - startTime;
      const label = cached.source === 'l2' ? 'semantic cache' : 'L1 cache';
      console.log(`[Processor] Job ${job.id} completed from ${label} in ${elapsed}ms`);
      return {
        filePath,
        tokensUsed: 0,
        costINR: 0,
        model: `${cached.entry.model} (${label})`,
        cached: true,
        slidePreview: cached.entry.presentation.slides.map((s) => ({ type: s.slideType, title: s.title })),
        elapsedMs: elapsed,
      };
    }
  } catch (err) {
    console.warn('[Processor] Cache check failed, proceeding to LLM:', err);
  }

  await job.updateProgress({ step: 'Generating slide content with AI...', percent: 30, cached: false });

  const fresh = await generateFreshContent(req);
  const cacheEntry: CacheEntry = {
    presentation: fresh.presentation,
    createdAt: new Date().toISOString(),
    model: fresh.model,
    tokensUsed: fresh.tokensUsed,
  };
  await storePresentation(redis, req, cacheEntry);

  await job.updateProgress({ step: 'Building your presentation...', percent: 85, cached: false });

  const filePath = await buildPptx(fresh.presentation, job.id!);
  await job.updateProgress({ step: 'Done!', percent: 100, cached: false });

  const elapsed = Date.now() - startTime;
  console.log(`[Processor] Job ${job.id} completed in ${elapsed}ms (model: ${fresh.model})`);

  return {
    filePath,
    tokensUsed: fresh.tokensUsed,
    costINR: fresh.costINR,
    model: fresh.model,
    cached: false,
    slidePreview: fresh.presentation.slides.map((s) => ({ type: s.slideType, title: s.title })),
    elapsedMs: elapsed,
  };
}
