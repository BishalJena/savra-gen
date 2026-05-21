// BullMQ queue setup for PPT generation jobs
import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import type { PptJobData } from '../shared';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// BullMQ requires maxRetriesPerRequest: null on the ioredis connection
export const redisConnection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy: (times: number) => Math.min(times * 50, 2000),
});

export const pptQueue = new Queue<PptJobData>('ppt-generation', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: {
      count: 500,
      age: 86400, // 24 hours
    },
    removeOnFail: {
      count: 100,
    },
  },
});

export const queueEvents = new QueueEvents('ppt-generation', {
  connection: redisConnection,
});

// Log queue events for observability
queueEvents.on('completed', ({ jobId }) => {
  console.log(`[Queue] Job ${jobId} completed`);
});

queueEvents.on('failed', ({ jobId, failedReason }) => {
  console.log(`[Queue] Job ${jobId} failed: ${failedReason}`);
});

console.log('[Queue] PPT generation queue initialized');
