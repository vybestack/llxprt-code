/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  captureRefusalPolicy,
  decideRefusal,
  refusalBackoffMs,
  type RefusalPolicy,
} from './refusalPolicy.js';

const POLICY: RefusalPolicy = {
  retries: 2,
  backoffMs: 15000,
  rewrite: true,
  reviewProfile: undefined,
  maxRewrites: 1,
};

describe('refusalBackoffMs', () => {
  it('grows by a factor of four from the base: 15 s, 60 s, 180 s', () => {
    expect([1, 2, 3].map((n) => refusalBackoffMs(15000, n))).toStrictEqual([
      15000, 60000, 180000,
    ]);
  });

  it('never exceeds 180 s however many retries have run', () => {
    expect(refusalBackoffMs(15000, 4)).toBe(180000);
    expect(refusalBackoffMs(15000, 10)).toBe(180000);
    expect(refusalBackoffMs(500000, 1)).toBe(180000);
  });

  it('is zero for a zero base, so retries are immediate', () => {
    expect(refusalBackoffMs(0, 3)).toBe(0);
  });
});

describe('decideRefusal', () => {
  it('retries while the budget has retries left, naming the retry number', () => {
    expect(
      decideRefusal(POLICY, { retriesUsed: 0, rewritesUsed: 0 }),
    ).toStrictEqual({ action: 'retry', retryNumber: 1, delayMs: 15000 });
    expect(
      decideRefusal(POLICY, { retriesUsed: 1, rewritesUsed: 0 }),
    ).toStrictEqual({ action: 'retry', retryNumber: 2, delayMs: 60000 });
  });

  it('hands over to review once retries are used and rewriting is allowed', () => {
    expect(
      decideRefusal(POLICY, { retriesUsed: 2, rewritesUsed: 0 }),
    ).toStrictEqual({ action: 'review' });
  });

  it('stops when rewriting is off', () => {
    expect(
      decideRefusal(
        { ...POLICY, rewrite: false },
        { retriesUsed: 2, rewritesUsed: 0 },
      ),
    ).toStrictEqual({ action: 'stop' });
  });

  it('stops when every rewrite round is used', () => {
    expect(
      decideRefusal(POLICY, { retriesUsed: 2, rewritesUsed: 1 }),
    ).toStrictEqual({ action: 'stop' });
    expect(
      decideRefusal(
        { ...POLICY, maxRewrites: 0 },
        { retriesUsed: 2, rewritesUsed: 0 },
      ),
    ).toStrictEqual({ action: 'stop' });
  });

  it('goes straight to review with zero retries, and stops with rewrite off', () => {
    const none = { ...POLICY, retries: 0 };
    expect(
      decideRefusal(none, { retriesUsed: 0, rewritesUsed: 0 }),
    ).toStrictEqual({ action: 'review' });
    expect(
      decideRefusal(
        { ...none, rewrite: false },
        { retriesUsed: 0, rewritesUsed: 0 },
      ),
    ).toStrictEqual({ action: 'stop' });
  });
});

describe('captureRefusalPolicy', () => {
  it('reads every setting once and is unaffected by later changes to the source', () => {
    let retries = 3;
    const policy = captureRefusalPolicy({
      retries: () => retries,
      backoffMs: () => 250,
      rewrite: () => false,
      reviewProfile: () => 'reviewer',
      maxRewrites: () => 2,
    });
    retries = 9;

    expect(policy).toStrictEqual({
      retries: 3,
      backoffMs: 250,
      rewrite: false,
      reviewProfile: 'reviewer',
      maxRewrites: 2,
    });
  });
});
