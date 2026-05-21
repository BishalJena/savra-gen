// Worker process entrypoint — runs separately from the API server
// This is a BullMQ worker that dequeues and processes PPT generation jobs
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { processJob } from './processor';
import type { PptJobData } from './shared';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '3', 10);

const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const worker = new Worker<PptJobData>(
  'ppt-generation',
  async (job) => {
    return processJob(job);
  },
  {
    connection,
    concurrency: CONCURRENCY,
    // Retry config (also set at queue level, but worker-level takes priority)
    settings: {
      backoffStrategy: (attemptsMade: number) => {
        // Exponential backoff: 1s, 2s, 4s
        return Math.min(1000 * Math.pow(2, attemptsMade - 1), 10000);
      },
    },
  },
);

worker.on('completed', (job) => {
  console.log(`✅ Job ${job.id} completed successfully`);
});

worker.on('failed', (job, err) => {
  console.error(`❌ Job ${job?.id} failed: ${err.message}`);
});

worker.on('error', (err) => {
  console.error('[Worker] Error:', err);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Worker] SIGTERM received, shutting down...');
  await worker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Worker] SIGINT received, shutting down...');
  await worker.close();
  process.exit(0);
});

console.log(`\n🔧 Savra PPT Worker started (concurrency: ${CONCURRENCY})`);
console.log(`   Redis: ${REDIS_URL}`);
console.log(`   Mode: ${process.env.ANTHROPIC_API_KEY ? 'LIVE (Anthropic)' : 'MOCK (no API key)'}\n`);
