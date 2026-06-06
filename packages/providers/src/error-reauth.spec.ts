/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  AllBucketsExhaustedError,
  isAuthBucketFailureReason,
} from './errors.js';

describe('AllBucketsExhaustedError re-authenticate instruction', () => {
  it('includes re-authenticate instruction when failure reasons contain expired-refresh-failed', () => {
    const error = new AllBucketsExhaustedError(
      'anthropic',
      ['bucket-a', 'bucket-b'],
      new Error('Unauthorized'),
      {
        'bucket-a': 'expired-refresh-failed',
        'bucket-b': 'expired-refresh-failed',
      },
    );

    expect(error.message).toContain('re-authenticate');
  });

  it('includes re-authenticate instruction when failure reasons contain reauth-failed', () => {
    const error = new AllBucketsExhaustedError(
      'anthropic',
      ['bucket-a'],
      new Error('Auth error'),
      { 'bucket-a': 'reauth-failed' },
    );

    expect(error.message).toContain('re-authenticate');
  });

  it('includes re-authenticate instruction when failure reasons contain reauth-timeout', () => {
    const error = new AllBucketsExhaustedError(
      'anthropic',
      ['bucket-a'],
      new Error('Auth timed out'),
      { 'bucket-a': 'reauth-timeout' },
    );

    expect(error.message).toContain('re-authenticate');
  });

  it('does not include re-authenticate instruction for non-auth reasons', () => {
    const error = new AllBucketsExhaustedError(
      'anthropic',
      ['bucket-a'],
      new Error('Rate limited'),
      { 'bucket-a': 'quota-exhausted' },
    );

    expect(error.message).not.toContain('re-authenticate');
  });

  it('does not include re-authenticate instruction when no reasons provided', () => {
    const error = new AllBucketsExhaustedError(
      'anthropic',
      ['bucket-a'],
      new Error('Rate limited'),
    );

    expect(error.message).not.toContain('re-authenticate');
  });

  it('includes re-authenticate instruction with mixed auth and non-auth reasons', () => {
    const error = new AllBucketsExhaustedError(
      'anthropic',
      ['bucket-a', 'bucket-b'],
      new Error('Mixed failure'),
      { 'bucket-a': 'quota-exhausted', 'bucket-b': 'reauth-failed' },
    );

    expect(error.message).toContain('re-authenticate');
  });
});

describe('isAuthBucketFailureReason', () => {
  it('returns true for expired-refresh-failed', () => {
    expect(isAuthBucketFailureReason('expired-refresh-failed')).toBe(true);
  });

  it('returns true for reauth-failed', () => {
    expect(isAuthBucketFailureReason('reauth-failed')).toBe(true);
  });

  it('returns true for reauth-timeout', () => {
    expect(isAuthBucketFailureReason('reauth-timeout')).toBe(true);
  });

  it('returns false for quota-exhausted', () => {
    expect(isAuthBucketFailureReason('quota-exhausted')).toBe(false);
  });

  it('returns false for no-token', () => {
    expect(isAuthBucketFailureReason('no-token')).toBe(false);
  });

  it('returns false for skipped', () => {
    expect(isAuthBucketFailureReason('skipped')).toBe(false);
  });
});
