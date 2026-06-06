/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSubmissionError } from './streamUtils.js';
import {
  AllBucketsExhaustedError,
  isAuthBucketFailureReason,
} from '@vybestack/llxprt-code-providers';
import type { Config } from '@vybestack/llxprt-code-core';
import { MessageType } from '../../types.js';

describe('handleSubmissionError', () => {
  const mockAddItem = vi.fn();
  const mockOnAuthError = vi.fn();
  const mockConfig = {
    getModel: vi.fn(() => 'test-model'),
  } as unknown as Config;

  beforeEach(() => {
    mockAddItem.mockClear();
    mockOnAuthError.mockClear();
  });

  it('detects AllBucketsExhaustedError with auth-related reasons, adds error item, invokes onAuthError, returns true', () => {
    const error = new AllBucketsExhaustedError(
      'anthropic',
      ['bucket-a'],
      new Error('Token revoked'),
      { 'bucket-a': 'reauth-failed' },
    );

    const result = handleSubmissionError(
      error,
      mockAddItem,
      mockConfig,
      mockOnAuthError,
      Date.now(),
    );

    expect(result).toBe(true);
    expect(mockOnAuthError).toHaveBeenCalled();
    expect(mockAddItem).toHaveBeenCalled();
    const addedItem = mockAddItem.mock.calls[0][0] as {
      type: string;
      text: string;
    };
    expect(addedItem.type).toBe(MessageType.ERROR);
    expect(addedItem.text).toContain('re-authenticate');
  });

  it('returns true for AllBucketsExhaustedError with reauth-timeout reason', () => {
    const error = new AllBucketsExhaustedError(
      'anthropic',
      ['bucket-a'],
      new Error('Auth timed out'),
      { 'bucket-a': 'reauth-timeout' },
    );

    const result = handleSubmissionError(
      error,
      mockAddItem,
      mockConfig,
      mockOnAuthError,
      Date.now(),
    );

    expect(result).toBe(true);
    expect(mockOnAuthError).toHaveBeenCalled();
  });

  it('returns true for AllBucketsExhaustedError with expired-refresh-failed reason', () => {
    const error = new AllBucketsExhaustedError(
      'anthropic',
      ['bucket-a'],
      new Error('Refresh failed'),
      { 'bucket-a': 'expired-refresh-failed' },
    );

    const result = handleSubmissionError(
      error,
      mockAddItem,
      mockConfig,
      mockOnAuthError,
      Date.now(),
    );

    expect(result).toBe(true);
    expect(mockOnAuthError).toHaveBeenCalled();
  });

  it('returns false for AllBucketsExhaustedError with non-auth reasons (generic handling)', () => {
    const error = new AllBucketsExhaustedError(
      'anthropic',
      ['bucket-a'],
      new Error('Rate limited'),
      { 'bucket-a': 'quota-exhausted' },
    );

    const result = handleSubmissionError(
      error,
      mockAddItem,
      mockConfig,
      mockOnAuthError,
      Date.now(),
    );

    expect(result).toBe(false);
    expect(mockOnAuthError).not.toHaveBeenCalled();
  });

  it('returns false for AllBucketsExhaustedError without reasons (generic handling)', () => {
    const error = new AllBucketsExhaustedError(
      'anthropic',
      ['bucket-a'],
      new Error('Unknown failure'),
    );

    const result = handleSubmissionError(
      error,
      mockAddItem,
      mockConfig,
      mockOnAuthError,
      Date.now(),
    );

    expect(result).toBe(false);
    expect(mockOnAuthError).not.toHaveBeenCalled();
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
