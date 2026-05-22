import { redisConnection } from './queue';

const RATE_LIMIT = 10;
const RATE_WINDOW_SECONDS = 60;
const DEDUP_WINDOW_SECONDS = 30;

interface GuardRedis {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  set(key: string, value: string, mode: 'EX', seconds: number, condition: 'NX'): Promise<string | null>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
}

export function createRequestGuards(redis: GuardRedis) {
  return {
    async checkRateLimit(clientId: string): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
      const key = `rate:ppt:${clientId}`;
      try {
        const count = await redis.incr(key);
        if (count === 1) await redis.expire(key, RATE_WINDOW_SECONDS);
        return {
          allowed: count <= RATE_LIMIT,
          retryAfterSeconds: RATE_WINDOW_SECONDS,
        };
      } catch (err) {
        console.warn('[RateLimit] Redis unavailable; allowing request:', err);
        return { allowed: true, retryAfterSeconds: RATE_WINDOW_SECONDS };
      }
    },

    async reserveOrGetDuplicateJob(
      dedupKey: string,
      jobId: string,
    ): Promise<{ reserved: true; jobId: string } | { reserved: false; jobId: string | null }> {
      const key = `dedupe:ppt:${dedupKey}`;
      try {
        const reserved = await redis.set(key, jobId, 'EX', DEDUP_WINDOW_SECONDS, 'NX');
        if (reserved === 'OK') return { reserved: true, jobId };
        return { reserved: false, jobId: await redis.get(key) };
      } catch (err) {
        console.warn('[Dedup] Redis unavailable; proceeding without dedupe:', err);
        return { reserved: true, jobId };
      }
    },

    async releaseDedupReservation(dedupKey: string, jobId: string): Promise<void> {
      const key = `dedupe:ppt:${dedupKey}`;
      try {
        const current = await redis.get(key);
        if (current === jobId) await redis.del(key);
      } catch (err) {
        console.warn('[Dedup] Failed to release reservation:', err);
      }
    },
  };
}

export const {
  checkRateLimit,
  reserveOrGetDuplicateJob,
  releaseDedupReservation,
} = createRequestGuards(redisConnection);
