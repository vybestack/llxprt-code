/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Constructor-tuning validation behavioral tests for PerfRetention (D-LC-5).
 *
 * Covers the constructor fail-fast validation split out of the original
 * retention.behavior.test.ts: rejection of non-positive / non-finite tuning
 * options and path-injection-safe runUuid handling.
 *
 * Real files, real filesystem, no mocks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { PerfRetention } from './retention.js';

let dir: string;

describe('PerfRetention validation behavior', () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-retention-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('PerfRetention constructor tuning validation (D-LC-5)', () => {
    it('rejects maxBytes <= 0', () => {
      expect(
        () =>
          new PerfRetention({
            dir,
            runUuid: '00000000-0000-4000-8000-000000000020',
            maxBytes: 0,
          }),
      ).toThrow(RangeError);
      expect(
        () =>
          new PerfRetention({
            dir,
            runUuid: '00000000-0000-4000-8000-000000000020',
            maxBytes: -1,
          }),
      ).toThrow(RangeError);
    });

    it('rejects maxFiles <= 0', () => {
      expect(
        () =>
          new PerfRetention({
            dir,
            runUuid: '00000000-0000-4000-8000-000000000020',
            maxFiles: 0,
          }),
      ).toThrow(RangeError);
      expect(
        () =>
          new PerfRetention({
            dir,
            runUuid: '00000000-0000-4000-8000-000000000020',
            maxFiles: -5,
          }),
      ).toThrow(RangeError);
    });

    it('rejects non-finite maxBytes/maxFiles', () => {
      expect(
        () =>
          new PerfRetention({
            dir,
            runUuid: '00000000-0000-4000-8000-000000000020',
            maxBytes: NaN,
          }),
      ).toThrow(RangeError);
      expect(
        () =>
          new PerfRetention({
            dir,
            runUuid: '00000000-0000-4000-8000-000000000020',
            maxBytes: Infinity,
          }),
      ).toThrow(RangeError);
      expect(
        () =>
          new PerfRetention({
            dir,
            runUuid: '00000000-0000-4000-8000-000000000020',
            maxFiles: NaN,
          }),
      ).toThrow(RangeError);
    });

    it('rejects maintenanceIntervalMs <= 0', () => {
      expect(
        () =>
          new PerfRetention({
            dir,
            runUuid: '00000000-0000-4000-8000-000000000020',
            maintenanceIntervalMs: 0,
          }),
      ).toThrow(RangeError);
      expect(
        () =>
          new PerfRetention({
            dir,
            runUuid: '00000000-0000-4000-8000-000000000020',
            maintenanceIntervalMs: -1,
          }),
      ).toThrow(RangeError);
    });

    it('rejects non-finite maintenanceIntervalMs/claimLeaseMs', () => {
      expect(
        () =>
          new PerfRetention({
            dir,
            runUuid: '00000000-0000-4000-8000-000000000020',
            maintenanceIntervalMs: NaN,
          }),
      ).toThrow(RangeError);
      expect(
        () =>
          new PerfRetention({
            dir,
            runUuid: '00000000-0000-4000-8000-000000000020',
            claimLeaseMs: Infinity,
          }),
      ).toThrow(RangeError);
    });

    it('rejects claimLeaseMs <= 0', () => {
      expect(
        () =>
          new PerfRetention({
            dir,
            runUuid: '00000000-0000-4000-8000-000000000020',
            claimLeaseMs: 0,
          }),
      ).toThrow(RangeError);
    });

    it('rejects negative diagRateLimitMs but allows zero', () => {
      expect(
        () =>
          new PerfRetention({
            dir,
            runUuid: '00000000-0000-4000-8000-000000000020',
            diagRateLimitMs: -1,
          }),
      ).toThrow(RangeError);
      expect(
        () =>
          new PerfRetention({
            dir,
            runUuid: '00000000-0000-4000-8000-000000000020',
            diagRateLimitMs: NaN,
          }),
      ).toThrow(RangeError);

      expect(
        () =>
          new PerfRetention({
            dir,
            runUuid: '00000000-0000-4000-8000-000000000020',
            diagRateLimitMs: 0,
          }),
      ).not.toThrow();
    });

    it('accepts the defaults (no tuning options)', () => {
      expect(
        () =>
          new PerfRetention({
            dir,
            runUuid: '00000000-0000-4000-8000-000000000021',
          }),
      ).not.toThrow();
    });

    it('accepts sensible positive finite values', () => {
      expect(
        () =>
          new PerfRetention({
            dir,
            runUuid: '00000000-0000-4000-8000-000000000022',
            maxBytes: 1024,
            maxFiles: 10,
            maintenanceIntervalMs: 1000,
            claimLeaseMs: 3000,
            diagRateLimitMs: 5000,
          }),
      ).not.toThrow();
    });

    it('rejects a runUuid with path separators (fail-fast internally)', () => {
      const slash = String.fromCharCode(0x2f); // '/'
      const backslash = String.fromCharCode(0x5c); // '\'
      const backspace = String.fromCharCode(0x08); // control char
      const nullByte = String.fromCharCode(0x00); // null byte (POSIX truncation)
      const del = String.fromCharCode(0x7f); // DEL
      expect(
        () => new PerfRetention({ dir, runUuid: `..${slash}escape` }),
      ).toThrow(TypeError);
      expect(() => new PerfRetention({ dir, runUuid: `a${slash}b` })).toThrow(
        TypeError,
      );
      expect(
        () => new PerfRetention({ dir, runUuid: `a${backslash}b` }),
      ).toThrow(TypeError);
      expect(
        () => new PerfRetention({ dir, runUuid: `a${backspace}b` }),
      ).toThrow(TypeError);
      expect(
        () => new PerfRetention({ dir, runUuid: `a${nullByte}b` }),
      ).toThrow(TypeError);
      expect(() => new PerfRetention({ dir, runUuid: `a${del}b` })).toThrow(
        TypeError,
      );
      expect(() => new PerfRetention({ dir, runUuid: '..' })).toThrow(
        TypeError,
      );
      expect(() => new PerfRetention({ dir, runUuid: '' })).toThrow(TypeError);
    });

    it('accepts a canonical standard runUuid (no path-injection vectors)', () => {
      expect(
        () =>
          new PerfRetention({
            dir,
            runUuid: '00000000-0000-4000-8000-000000000023',
          }),
      ).not.toThrow();
    });
  });
});
