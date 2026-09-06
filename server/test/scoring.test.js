import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE_POINTS, computeScore, isAnswerCorrect } from '../src/lib/scoring.js';

test('multiple-choice answer must match the full set', () => {
  assert.equal(isAnswerCorrect(['a', 'b'], ['b', 'a']), true);
  assert.equal(isAnswerCorrect(['a', 'b'], ['a']), false);
  assert.equal(isAnswerCorrect(['a'], ['a', 'b']), false);
});

test('score is bounded and speed-sensitive', () => {
  assert.equal(computeScore({ correct: false, speedBonus: true, timeLeftMs: 9, timeLimitMs: 10 }), 0);
  assert.equal(
    computeScore({ correct: true, speedBonus: false, timeLeftMs: 0, timeLimitMs: 10 }),
    BASE_POINTS
  );
  assert.equal(
    computeScore({ correct: true, speedBonus: true, timeLeftMs: 10_000, timeLimitMs: 10_000 }),
    BASE_POINTS
  );
  assert.equal(
    computeScore({ correct: true, speedBonus: true, timeLeftMs: 0, timeLimitMs: 10_000 }),
    BASE_POINTS / 2
  );
});
