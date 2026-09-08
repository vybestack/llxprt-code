/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Scheduling and rate-limiting behavioral tests for PerfRetention (AC-7, D3).
 *
 * Covers the interval/rate-limit behavior split out of the original
 * retention.behavior.test.ts: the single coarse maintenance interval that
 * both touches the claim and sweeps old files (AC-7, D3) and the
 * maybeMaintain rate-limiting gate.
 *
 * Real files, real filesystem, no mocks. The interval callback is captured
 * via a deterministic TestScheduler.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  PerfRetention,
  type PerfScheduler,
  type PerfTimerHandle,
} from './retention.js';

let dir: string;

describe('PerfRetention scheduling behavior', () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-retention-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writePerfFile(
    name: string,
    recordCount: number,
    recordBytes = 1220,
  ): void {
    const lines: string[] = [];
    for (let i = 0; i < recordCount; i++) {
      const padding = '.'.repeat(
        Math.max(0, recordBytes - 80 - String(i).length),
      );
      lines.push(
        JSON.stringify({
          schema_version: 1,
          record_type: 'operation',
          ts: '2026-08-08T12:00:00.000Z',
          pad: padding,
          idx: i,
        }),
      );
    }
    fs.writeFileSync(path.join(dir, name), lines.join('\n') + '\n');
  }

  function setMtime(name: string, mtimeMs: number): void {
    const p = path.join(dir, name);
    fs.utimesSync(p, new Date(mtimeMs), new Date(mtimeMs));
  }

  function listFiles(): string[] {
    return fs.readdirSync(dir).sort();
  }

  class TestScheduler implements PerfScheduler {
    callback: (() => Promise<void>) | null = null;
    handle: PerfTimerHandle | null = null;

    setInterval(callback: () => Promise<void>, _ms: number): PerfTimerHandle {
      this.callback = callback;
      this.handle = { unref: () => {}, clear: () => {} };
      return this.handle;
    }
  }

  describe('PerfRetention one coarse interval (AC-7, D3)', () => {
    it('the same interval touches the claim and sweeps old files', async () => {
      const scheduler = new TestScheduler();
      const now = Date.now();
      const oldNow = now - 3_600_000;

      writePerfFile('perf-20260101-old.jsonl', 3);
      setMtime('perf-20260101-old.jsonl', oldNow);
      writePerfFile('perf-20260102-older.jsonl', 3);
      setMtime('perf-20260102-older.jsonl', oldNow - 3_600_000);

      const retention = new PerfRetention({
        dir,
        runUuid: '00000000-0000-4000-8000-000000000016',
        scheduler,
        maxFiles: 1,
        maxBytes: 10_000_000,
      });
      await retention.start();

      expect(listFiles()).toContain(
        '00000000-0000-4000-8000-000000000016.claim',
      );

      const beforeMtime = fs.statSync(
        path.join(dir, '00000000-0000-4000-8000-000000000016.claim'),
      ).mtimeMs;

      await new Promise((r) => setTimeout(r, 20));

      await scheduler.callback!();

      expect(fs.existsSync(path.join(dir, 'perf-20260101-old.jsonl'))).toBe(
        false,
      );

      const afterMtime = fs.statSync(
        path.join(dir, '00000000-0000-4000-8000-000000000016.claim'),
      ).mtimeMs;
      expect(afterMtime).toBeGreaterThan(beforeMtime);

      await retention.dispose();
    });

    it('fires via the actual owned interval without restart', async () => {
      const scheduler = new TestScheduler();
      const retention = new PerfRetention({
        dir,
        runUuid: '00000000-0000-4000-8000-000000000017',
        scheduler,
      });
      await retention.start();

      expect(scheduler.callback).not.toBeNull();

      await scheduler.callback!();
      await scheduler.callback!();
      await scheduler.callback!();

      expect(listFiles()).toContain(
        '00000000-0000-4000-8000-000000000017.claim',
      );
      await retention.dispose();
    });
  });

  describe('PerfRetention maybeMaintain rate-limiting', () => {
    it('runs maintain on first call', async () => {
      const now = Date.now();
      const evictableName =
        'perf-20260101-11111111-1111-4111-8111-111111111118.jsonl';
      writePerfFile(evictableName, 3);
      setMtime(evictableName, now - 86_400_000);

      const retention = new PerfRetention({
        dir,
        runUuid: '00000000-0000-4000-8000-000000000018',
        maxFiles: 1,
        maxBytes: 1,
        onDiagnostic: () => {},
      });
      await retention.maybeMaintain(now);

      expect(fs.existsSync(path.join(dir, evictableName))).toBe(false);
    });

    it('skips when called within the maintenance interval', async () => {
      const now = Date.now();
      const evictableName =
        'perf-20260101-11111111-1111-4111-8111-111111111119.jsonl';
      const retention = new PerfRetention({
        dir,
        runUuid: '00000000-0000-4000-8000-000000000019',
        maxFiles: 1,
        maxBytes: 1,
        maintenanceIntervalMs: 60_000,
        onDiagnostic: () => {},
      });

      await retention.maybeMaintain(now);

      writePerfFile(evictableName, 3);
      setMtime(evictableName, now - 86_400_000);
      await retention.maybeMaintain(now + 1_000);

      expect(fs.existsSync(path.join(dir, evictableName))).toBe(true);
      expect(retention.evictionCount).toBe(0);
    });

    it('runs again after the maintenance interval elapses', async () => {
      const now = Date.now();
      const evictableName =
        'perf-20260101-11111111-1111-4111-8111-11111111111a.jsonl';
      const retention = new PerfRetention({
        dir,
        runUuid: '00000000-0000-4000-8000-00000000001a',
        maxFiles: 1,
        maxBytes: 1,
        maintenanceIntervalMs: 60_000,
        onDiagnostic: () => {},
      });
      await retention.maybeMaintain(now);

      writePerfFile(evictableName, 3);
      setMtime(evictableName, now - 86_400_000);

      await retention.maybeMaintain(now + 61_000);
      expect(fs.existsSync(path.join(dir, evictableName))).toBe(false);
    });
  });
});
