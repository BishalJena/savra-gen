import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestGuards } from './request-guards';
import { pptQueue, queueEvents, redisConnection } from './queue';

function fakeRedis() {
  const values = new Map<string, string>();
  return {
    async incr(key: string) {
      const next = Number(values.get(key) || '0') + 1;
      values.set(key, String(next));
      return next;
    },
    async expire() {
      return 1;
    },
    async set(key: string, value: string, _mode: 'EX', _seconds: number, condition: 'NX') {
      if (condition === 'NX' && values.has(key)) return null;
      values.set(key, value);
      return 'OK';
    },
    async get(key: string) {
      return values.get(key) ?? null;
    },
    async del(key: string) {
      values.delete(key);
      return 1;
    },
  };
}

test('Redis-backed rate limit blocks after 10 requests', async () => {
  const guards = createRequestGuards(fakeRedis());
  for (let i = 0; i < 10; i++) {
    assert.equal((await guards.checkRateLimit('teacher-1')).allowed, true);
  }
  assert.equal((await guards.checkRateLimit('teacher-1')).allowed, false);
});

test('Redis-backed dedupe returns the first reserved job id', async () => {
  const guards = createRequestGuards(fakeRedis());
  assert.deepEqual(await guards.reserveOrGetDuplicateJob('same-request', 'job-a'), {
    reserved: true,
    jobId: 'job-a',
  });
  assert.deepEqual(await guards.reserveOrGetDuplicateJob('same-request', 'job-b'), {
    reserved: false,
    jobId: 'job-a',
  });
});

test('dedupe reservation can be released after queue failure', async () => {
  const guards = createRequestGuards(fakeRedis());
  await guards.reserveOrGetDuplicateJob('same-request', 'job-a');
  await guards.releaseDedupReservation('same-request', 'job-a');
  assert.deepEqual(await guards.reserveOrGetDuplicateJob('same-request', 'job-b'), {
    reserved: true,
    jobId: 'job-b',
  });
});

test.after(async () => {
  await queueEvents.close();
  await pptQueue.close();
  await redisConnection.quit();
});
