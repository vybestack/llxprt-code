/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createRequire } from 'node:module';
import { describe, expect, it } from 'bun:test';

const requireFromModule = createRequire(import.meta.url);
const mod = requireFromModule(
  '../../.github/scripts/ocr-review-context.cjs',
) as {
  resolveEffectiveReviewContext: (input: unknown) => {
    fromSha: string;
    rangeMode: string;
    prNumber: string;
    trustedBaseSha: string;
  };
};

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

describe('ocr-review-context.cjs — workflow_dispatch context', () => {
  it('uses mergeBaseSha for fromSha and full for rangeMode', () => {
    const result = mod.resolveEffectiveReviewContext({
      eventName: 'workflow_dispatch',
      mergeBaseSha: SHA_A,
      rangeFromSha: SHA_B,
      rangeMode: 'incremental',
      prNumber: '42',
      trustedBaseSha: SHA_A,
    });
    expect(result.fromSha).toBe(SHA_A);
    expect(result.rangeMode).toBe('full');
    expect(result.prNumber).toBe('42');
    expect(result.trustedBaseSha).toBe(SHA_A);
  });

  it('overrides noop rangeMode with full on dispatch', () => {
    const result = mod.resolveEffectiveReviewContext({
      eventName: 'workflow_dispatch',
      mergeBaseSha: SHA_A,
      rangeFromSha: SHA_B,
      rangeMode: 'noop',
      prNumber: '42',
      trustedBaseSha: SHA_A,
    });
    expect(result.rangeMode).toBe('full');
  });
});

describe('ocr-review-context.cjs — pull_request_target synchronize context', () => {
  it('uses rangeFromSha and rangeMode as-is for incremental', () => {
    const result = mod.resolveEffectiveReviewContext({
      eventName: 'pull_request_target',
      mergeBaseSha: SHA_A,
      rangeFromSha: SHA_B,
      rangeMode: 'incremental',
      prNumber: '42',
      trustedBaseSha: SHA_A,
    });
    expect(result.fromSha).toBe(SHA_B);
    expect(result.rangeMode).toBe('incremental');
  });

  it('passes through noop rangeMode for checkpoint match', () => {
    const result = mod.resolveEffectiveReviewContext({
      eventName: 'pull_request_target',
      mergeBaseSha: SHA_A,
      rangeFromSha: SHA_B,
      rangeMode: 'noop',
      prNumber: '42',
      trustedBaseSha: SHA_A,
    });
    expect(result.fromSha).toBe(SHA_B);
    expect(result.rangeMode).toBe('noop');
  });

  it('passes through full rangeMode when resolve-range falls back', () => {
    const result = mod.resolveEffectiveReviewContext({
      eventName: 'pull_request_target',
      mergeBaseSha: SHA_A,
      rangeFromSha: SHA_A,
      rangeMode: 'full',
      prNumber: '42',
      trustedBaseSha: SHA_A,
    });
    expect(result.fromSha).toBe(SHA_A);
    expect(result.rangeMode).toBe('full');
  });
});

describe('ocr-review-context.cjs — issue_comment context', () => {
  it('uses rangeFromSha and rangeMode as-is', () => {
    const result = mod.resolveEffectiveReviewContext({
      eventName: 'issue_comment',
      mergeBaseSha: SHA_A,
      rangeFromSha: SHA_A,
      rangeMode: 'full',
      prNumber: '42',
      trustedBaseSha: SHA_A,
    });
    expect(result.fromSha).toBe(SHA_A);
    expect(result.rangeMode).toBe('full');
  });
});

describe('ocr-review-context.cjs — resolve-range failed / empty-output path', () => {
  it('uses empty rangeFromSha when resolve-range produced no output on dispatch', () => {
    const result = mod.resolveEffectiveReviewContext({
      eventName: 'workflow_dispatch',
      mergeBaseSha: SHA_A,
      rangeFromSha: '',
      rangeMode: '',
      prNumber: '42',
      trustedBaseSha: SHA_A,
    });
    // Dispatch ignores rangeFromSha entirely and uses mergeBaseSha
    expect(result.fromSha).toBe(SHA_A);
    expect(result.rangeMode).toBe('full');
  });

  it('passes through empty values on non-dispatch when resolve-range failed', () => {
    const result = mod.resolveEffectiveReviewContext({
      eventName: 'pull_request_target',
      mergeBaseSha: SHA_A,
      rangeFromSha: '',
      rangeMode: '',
      prNumber: '42',
      trustedBaseSha: SHA_A,
    });
    expect(result.fromSha).toBe('');
    expect(result.rangeMode).toBe('');
  });
});

describe('ocr-review-context.cjs — pass-through fields', () => {
  it('passes prNumber and trustedBaseSha unchanged', () => {
    const result = mod.resolveEffectiveReviewContext({
      eventName: 'pull_request_target',
      mergeBaseSha: SHA_A,
      rangeFromSha: SHA_B,
      rangeMode: 'incremental',
      prNumber: '999',
      trustedBaseSha: SHA_B,
    });
    expect(result.prNumber).toBe('999');
    expect(result.trustedBaseSha).toBe(SHA_B);
  });
});

describe('ocr-review-context.cjs — defensive input handling', () => {
  it('handles null input without throwing', () => {
    const result = mod.resolveEffectiveReviewContext(null);
    expect(result.fromSha).toBe('');
    expect(result.rangeMode).toBe('');
    expect(result.prNumber).toBe('');
    expect(result.trustedBaseSha).toBe('');
  });

  it('handles undefined fields without throwing', () => {
    const result = mod.resolveEffectiveReviewContext({
      eventName: undefined,
      mergeBaseSha: undefined,
      rangeFromSha: undefined,
      rangeMode: undefined,
      prNumber: undefined,
      trustedBaseSha: undefined,
    });
    expect(result.fromSha).toBe('');
    expect(result.rangeMode).toBe('');
    expect(result.prNumber).toBe('');
    expect(result.trustedBaseSha).toBe('');
  });
});
