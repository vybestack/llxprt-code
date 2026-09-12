/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { isProfileCommandResult } from './profileResults.js';
import type { ProfileCommandResult } from './profileResults.js';

const PAYLOADS = {
  committed: { snapshot: {} },
  'no-op': {},
  queued: { baseRevision: 4 },
  'confirmation-required': {
    pending: { token: 't', commandKind: 'load', description: 'discard' },
  },
  cancelled: {},
  busy: { activeCommandKind: 'load' },
  stale: { expectedRevision: 4, currentRevision: 5 },
  conflict: { cause: 'changed on disk' },
  invalid: { errors: ['bad'] },
  unverified: { constraints: ['offline'] },
  failed: { error: 'failed to load' },
} satisfies Record<ProfileCommandResult['kind'], Record<string, unknown>>;

describe('isProfileCommandResult', () => {
  it.each([
    { kind: 'committed' },
    { kind: 'committed', snapshot: undefined },
    { kind: 'committed', snapshot: null },
    { kind: 'confirmation-required' },
    { kind: 'confirmation-required', pending: null },
    { kind: 'confirmation-required', pending: [] },
    { kind: 'confirmation-required', pending: 'token' },
    { kind: 'busy' },
    { kind: 'busy', activeCommandKind: 7 },
    { kind: 'queued' },
    { kind: 'queued', baseRevision: '4' },
    { kind: 'stale', expectedRevision: 4 },
    { kind: 'stale', currentRevision: 5 },
    { kind: 'stale', expectedRevision: '4', currentRevision: 5 },
    { kind: 'stale', expectedRevision: 4, currentRevision: '5' },
    { kind: 'conflict' },
    { kind: 'conflict', cause: 7 },
    { kind: 'invalid' },
    { kind: 'invalid', errors: 'bad' },
    { kind: 'invalid', errors: null },
    { kind: 'unverified' },
    { kind: 'unverified', constraints: {} },
    { kind: 'failed' },
    { kind: 'failed', error: {} },
  ])('rejects malformed payload %j', (payload) => {
    expect(isProfileCommandResult({ revision: 5, ...payload })).toBe(false);
  });

  it('accepts each of the eleven kinds', () => {
    for (const [kind, payload] of Object.entries(PAYLOADS)) {
      const result: unknown = { kind, revision: 5, ...payload };
      expect(isProfileCommandResult(result)).toBe(true);
    }
  });

  it('accepts a committed result carrying a snapshot', () => {
    const result: unknown = { kind: 'committed', revision: 5, snapshot: {} };
    expect(isProfileCommandResult(result)).toBe(true);
  });

  it('accepts an invalid result carrying readonly error lines', () => {
    const result: unknown = { kind: 'invalid', revision: 1, errors: ['bad'] };
    expect(isProfileCommandResult(result)).toBe(true);
  });

  it('rejects a result without a revision', () => {
    const result: unknown = { kind: 'committed' };
    expect(isProfileCommandResult(result)).toBe(false);
  });

  it('rejects a result with a non-number revision', () => {
    const result: unknown = { kind: 'committed', revision: '5' };
    expect(isProfileCommandResult(result)).toBe(false);
  });

  it('rejects an unknown kind', () => {
    const result: unknown = { kind: 'executed', revision: 5 };
    expect(isProfileCommandResult(result)).toBe(false);
  });

  it('rejects null', () => {
    expect(isProfileCommandResult(null)).toBe(false);
  });

  it('rejects an array', () => {
    expect(isProfileCommandResult(['committed', 5])).toBe(false);
  });

  it('rejects a primitive string', () => {
    expect(isProfileCommandResult('committed')).toBe(false);
  });
});
