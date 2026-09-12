/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { isProfileCommandResult } from './profileResults.js';
import type { ProfileCommandResult } from './profileResults.js';
import type { RedactedProfileSnapshot } from './profileViews.js';

const snapshot: RedactedProfileSnapshot = {
  identity: { kind: 'draft' },
  revision: 5,
  provider: 'openai',
  model: 'gpt-4o',
  isLoadBalancer: false,
};

const PAYLOADS = {
  committed: { snapshot },
  'no-op': { reason: 'unchanged' },
  queued: { baseRevision: 4 },
  'confirmation-required': {
    pending: { token: 't', commandKind: 'load', description: 'discard' },
  },
  cancelled: { reason: 'superseded' },
  busy: { activeCommandKind: 'load' },
  stale: { expectedRevision: 4, currentRevision: 5 },
  conflict: { cause: 'changed on disk' },
  invalid: { errors: ['bad'] },
  unverified: { constraints: ['offline'] },
  failed: { error: 'failed to load' },
} satisfies Record<ProfileCommandResult['kind'], Record<string, unknown>>;

describe('isProfileCommandResult', () => {
  it.each([
    { kind: 'committed', snapshot: 7 },
    { kind: 'committed', snapshot: {} },
    { kind: 'committed', snapshot: [] },
    { kind: 'no-op' },
    { kind: 'no-op', reason: 7 },
    { kind: 'cancelled' },
    { kind: 'cancelled', reason: null },
    { kind: 'confirmation-required', pending: {} },
    {
      kind: 'confirmation-required',
      pending: { token: 7, commandKind: 'load', description: 'discard' },
    },
    {
      kind: 'confirmation-required',
      pending: { token: 't', commandKind: 'unknown', description: 'discard' },
    },
    {
      kind: 'confirmation-required',
      pending: { token: 't', commandKind: 7, description: 'discard' },
    },
    {
      kind: 'confirmation-required',
      pending: { token: 't', commandKind: 'load', description: 7 },
    },
    {
      kind: 'confirmation-required',
      pending: { token: 't', commandKind: 'load' },
    },
    { kind: 'busy', activeCommandKind: 'unknown' },
    { kind: 'busy', activeCommandKind: 'constructor' },
    { kind: 'invalid', errors: [7] },
    { kind: 'invalid', errors: ['bad', ''] },
    { kind: 'invalid', errors: ['  '] },
    { kind: 'unverified', constraints: [7] },
    { kind: 'unverified', constraints: ['offline', ''] },
    { kind: 'unverified', constraints: ['  '] },
    { kind: 'failed', error: 7 },
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

  it.each([
    { identity: undefined },
    { identity: null },
    { identity: {} },
    { identity: { kind: 'other' } },
    {
      identity: { kind: 'saved', name: 7, source: { kind: 'hash', hash: 'h' } },
    },
    { identity: { kind: 'saved', name: 'work' } },
    { identity: { kind: 'saved', name: 'work', source: {} } },
    {
      identity: {
        kind: 'saved',
        name: 'work',
        source: { kind: 'hash', hash: 7 },
      },
    },
    {
      identity: {
        kind: 'saved',
        name: 'work',
        source: { kind: 'stat', mtimeMs: '1', size: 2 },
      },
    },
    {
      identity: {
        kind: 'saved',
        name: 'work',
        source: { kind: 'stat', mtimeMs: 1, size: '2' },
      },
    },
    { identity: { kind: 'draft', derivedFrom: {} } },
    { identity: { kind: 'draft', derivedFrom: null } },
    { revision: undefined },
    { revision: '5' },
    { provider: undefined },
    { provider: 7 },
    { model: undefined },
    { model: 7 },
    { isLoadBalancer: undefined },
    { isLoadBalancer: 'false' },
    { memberCount: '2' },
    { identityKind: 7 },
    { providerOrLbSummary: false },
    { health: {} },
    { health: { status: 'other', degradedAspects: [] } },
    { health: { status: 'ok', degradedAspects: [7] } },
    { roleRuntimeCount: '1' },
  ])('rejects malformed snapshot fields %j', (fields) => {
    expect(
      isProfileCommandResult({
        kind: 'committed',
        revision: 5,
        snapshot: { ...snapshot, ...fields },
      }),
    ).toStrictEqual(false);
  });

  it.each([
    { kind: 'saved', name: 'work', source: { kind: 'hash', hash: 'h' } },
    {
      kind: 'saved',
      name: 'work',
      source: { kind: 'stat', mtimeMs: 1, size: 2 },
    },
    {
      kind: 'draft',
      derivedFrom: { name: 'work', source: { kind: 'hash', hash: 'h' } },
    },
  ])('accepts complete snapshot identity %j', (identity) => {
    expect(
      isProfileCommandResult({
        kind: 'committed',
        revision: 5,
        snapshot: {
          ...snapshot,
          identity,
          isLoadBalancer: true,
          memberCount: 2,
          identityKind: null,
          providerOrLbSummary: null,
          health: { status: 'degraded', degradedAspects: ['offline'] },
          roleRuntimeCount: 1,
        },
      }),
    ).toStrictEqual(true);
  });

  it('accepts each of the eleven kinds', () => {
    for (const [kind, payload] of Object.entries(PAYLOADS)) {
      const result: unknown = { kind, revision: 5, ...payload };
      expect(isProfileCommandResult(result)).toBe(true);
    }
  });

  it('accepts a committed result carrying a snapshot', () => {
    const result: unknown = { kind: 'committed', revision: 5, snapshot };
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
