/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { fingerprintsMatch } from './profileState.js';
import type { SourceFingerprint } from './profileState.js';

describe('fingerprintsMatch', () => {
  it('returns true for identical stat fingerprints', () => {
    const a: SourceFingerprint = {
      kind: 'stat',
      mtimeMs: 1_700_000_000_000,
      size: 1024,
    };
    expect(fingerprintsMatch(a, { ...a })).toBe(true);
  });

  it('returns true for identical hash fingerprints', () => {
    const a: SourceFingerprint = {
      kind: 'hash',
      hash: 'abc123def456',
    };
    expect(fingerprintsMatch(a, { ...a })).toBe(true);
  });

  it('returns false across stat and hash kinds', () => {
    const stat: SourceFingerprint = {
      kind: 'stat',
      mtimeMs: 1_700_000_000_000,
      size: 1024,
    };
    const hash: SourceFingerprint = {
      kind: 'hash',
      hash: 'abc123def456',
    };
    expect(fingerprintsMatch(stat, hash)).toBe(false);
    expect(fingerprintsMatch(hash, stat)).toBe(false);
  });

  it('returns false when mtimeMs differs', () => {
    const a: SourceFingerprint = {
      kind: 'stat',
      mtimeMs: 1_700_000_000_000,
      size: 1024,
    };
    const b: SourceFingerprint = {
      kind: 'stat',
      mtimeMs: 1_700_000_000_001,
      size: 1024,
    };
    expect(fingerprintsMatch(a, b)).toBe(false);
  });

  it('returns false when size differs', () => {
    const a: SourceFingerprint = {
      kind: 'stat',
      mtimeMs: 1_700_000_000_000,
      size: 1024,
    };
    const b: SourceFingerprint = {
      kind: 'stat',
      mtimeMs: 1_700_000_000_000,
      size: 2048,
    };
    expect(fingerprintsMatch(a, b)).toBe(false);
  });

  it('returns false when hash differs', () => {
    const a: SourceFingerprint = {
      kind: 'hash',
      hash: 'abc123def456',
    };
    const b: SourceFingerprint = {
      kind: 'hash',
      hash: 'abc123def789',
    };
    expect(fingerprintsMatch(a, b)).toBe(false);
  });
});
