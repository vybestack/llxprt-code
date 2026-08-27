/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, it, expect } from 'bun:test';
import {
  AllBucketsExhaustedError,
  isAuthBucketFailureReason,
} from './errors.js';
import {
  resetCliRuntimeRegistryForTesting,
  setDefaultCliRuntimeId,
  upsertRuntimeEntry,
} from './runtime/runtimeRegistry.js';

afterEach(() => {
  resetCliRuntimeRegistryForTesting();
});

/**
 * @plan PLAN-20260827-ISSUE2562.P04
 * @requirement REQ-2562-3
 */
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

  it('directs subagent re-authentication to the interactive host', () => {
    upsertRuntimeEntry('p04-error-subagent', {
      runtimeKind: 'subagent',
    });
    setDefaultCliRuntimeId('p04-error-subagent');

    const error = new AllBucketsExhaustedError(
      'anthropic',
      ['work'],
      new Error('Auth failed'),
      { work: 'reauth-failed' },
    );

    expect(error.message).toContain('interactive host session');
    expect(error.message).toContain('anthropic via /auth there');
    expect(error.message).not.toContain(
      'auth dialog will open on your next message',
    );
  });

  it('directs agent re-authentication to the interactive host', () => {
    upsertRuntimeEntry('p04-error-agent', { runtimeKind: 'agent' });
    setDefaultCliRuntimeId('p04-error-agent');

    const error = new AllBucketsExhaustedError(
      'anthropic',
      ['work'],
      new Error('Auth failed'),
      { work: 'reauth-failed' },
    );

    expect(error.message).toContain('interactive host session');
    expect(error.message).toContain('anthropic via /auth there');
    expect(error.message).not.toContain(
      'auth dialog will open on your next message',
    );
  });

  it('preserves the existing re-authentication wording without an agent runtime', () => {
    const error = new AllBucketsExhaustedError(
      'anthropic',
      ['work'],
      new Error('Auth failed'),
      { work: 'reauth-failed' },
    );

    expect(error.message).toContain(
      'Please re-authenticate to continue. The auth dialog will open on your next message.',
    );
  });

  it('preserves the existing re-authentication wording in a host runtime', () => {
    upsertRuntimeEntry('p04-error-host', { runtimeKind: 'cli-interactive' });
    setDefaultCliRuntimeId('p04-error-host');

    const error = new AllBucketsExhaustedError(
      'anthropic',
      ['work'],
      new Error('Auth failed'),
      { work: 'reauth-failed' },
    );

    expect(error.message).toContain(
      'Please re-authenticate to continue. The auth dialog will open on your next message.',
    );
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
