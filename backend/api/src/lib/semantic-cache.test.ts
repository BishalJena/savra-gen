import assert from 'node:assert/strict';
import test from 'node:test';
import { cosineSimilarity } from './cosine';

test('cosineSimilarity returns 1 for identical vectors', () => {
  const v = [1, 0, 1, 0];
  assert.ok(cosineSimilarity(v, v) > 0.9999);
});

test('cosineSimilarity returns 0 for orthogonal vectors', () => {
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});

test('cosineSimilarity is high for near-identical phrasing vectors', () => {
  const a = [0.9, 0.1, 0.8, 0.2];
  const b = [0.88, 0.12, 0.79, 0.21];
  assert.ok(cosineSimilarity(a, b) > 0.99);
});
