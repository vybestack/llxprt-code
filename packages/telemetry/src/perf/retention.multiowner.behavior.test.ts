/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Real multi-owner convergence evidence for PerfRetention (AC-7, D3, §6).
 *
 * Automatic retention protects a JSONL ONLY as a genuinely-live writer:
 * current UTC day-key AND mtime within the maintenance interval. A fresh
 * claim protects the claim FILE itself (and counts toward caps) but does NOT
 * shield that run's historical JSONL — otherwise a long-running process could
 * never evict its own old-day files and converge to the eventual byte/file
 * caps. This deliberately differs from explicit /perf delete, which keeps
 * claim→JSONL protection to avoid unlinking a file another active process may
 * still be appending.
 *
 * No mocks — real files, real filesystem, distinct standard UUIDs per run.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { PerfRetention } from './retention.js';
import { utcDayKey } from './perfArtifacts.js';

const ONE_MIB = 1_048_576;

let dir: string;

describe('PerfRetention multi-owner behavior', () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-multiowner-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeExactFile(name: string, byteLength: number): void {
    fs.writeFileSync(path.join(dir, name), 'x'.repeat(byteLength));
  }

  function createClaimFile(uuid: string, mtimeMs: number): void {
    const p = path.join(dir, `${uuid}.claim`);
    fs.writeFileSync(p, '', { mode: 0o600 });
    fs.utimesSync(p, new Date(mtimeMs), new Date(mtimeMs));
  }

  function setMtime(name: string, mtimeMs: number): void {
    const p = path.join(dir, name);
    fs.utimesSync(p, new Date(mtimeMs), new Date(mtimeMs));
  }

  function listFiles(): string[] {
    return fs.readdirSync(dir).sort();
  }

  function exists(name: string): boolean {
    return fs.existsSync(path.join(dir, name));
  }

  describe('PerfRetention multi-owner convergence (AC-7, D3, §6)', () => {
    it('a 24x7 run evicts its own old-day files until BOTH caps are met while its current live file and fresh claim survive', async () => {
      // Fixed, deterministic "now" — no wall-clock dependence.
      const now = Date.parse('2026-08-10T12:00:00.000Z');
      const todayKey = utcDayKey(now);
      const ownerUuid = '00000000-0000-4000-8000-000000000100';

      // Multiple OLD-DAY JSONL files from the SAME owner run. Each is exactly
      // 1 MiB and belongs to ownerUuid, on a distinct prior UTC day.
      const oldNames: string[] = [];
      for (let i = 0; i < 5; i++) {
        const day = new Date(now - (i + 1) * 86_400_000);
        const dayKey = utcDayKey(day.getTime());
        const name = `perf-${dayKey}-${ownerUuid}.jsonl`;
        writeExactFile(name, ONE_MIB);
        setMtime(name, now - (i + 1) * 86_400_000);
        oldNames.push(name);
      }

      // One CURRENT-DAY live JSONL file from the same owner — recent mtime.
      const liveName = `perf-${todayKey}-${ownerUuid}.jsonl`;
      writeExactFile(liveName, ONE_MIB);
      setMtime(liveName, now - 5_000);

      // Start over BOTH caps: 5 old files + 1 live file + the owner claim = 7
      // artifacts (~6 MiB). maxFiles 2 and maxBytes 2 MiB are both exceeded.
      const retention = new PerfRetention({
        dir,
        runUuid: ownerUuid,
        maxFiles: 2,
        maxBytes: 2 * ONE_MIB,
      });
      await retention.start();
      await retention.maintain(now);

      // The fresh claim survives (non-stale; counts toward caps).
      expect(exists(`${ownerUuid}.claim`)).toBe(true);
      // The current-day live file survives (genuine live writer).
      expect(exists(liveName)).toBe(true);
      // Every old-day file is evicted — the run's own historical files are NOT
      // shielded by the fresh claim or by being the owner run.
      for (const name of oldNames) {
        expect(exists(name)).toBe(false);
      }

      // Exact survivor set: only the protected claim + live writer remain, and
      // BOTH caps are satisfied (2 files ≤ 2, 1 MiB ≤ 2 MiB).
      expect(listFiles()).toStrictEqual([`${ownerUuid}.claim`, liveName]);
      expect(retention.evictionCount).toBe(5);

      await retention.dispose();
    });

    it('a fresh claim does NOT protect its run old-day JSONL from retention eviction', async () => {
      const now = Date.parse('2026-08-10T12:00:00.000Z');
      const ownerUuid = '00000000-0000-4000-8000-000000000110';
      const otherUuid = '00000000-0000-4000-8000-000000000111';
      const yesterdayKey = utcDayKey(now - 86_400_000);

      // Old-day JSONL belonging to otherUuid — would be eligible on its own.
      const otherOldName = `perf-${yesterdayKey}-${otherUuid}.jsonl`;
      writeExactFile(otherOldName, 1024);
      setMtime(otherOldName, now - 86_400_000);

      // Fresh claim for otherUuid. Automatic retention must NOT propagate this
      // to shield otherUuid's old-day JSONL (that is delete-only behavior).
      createClaimFile(otherUuid, now - 10_000);

      const retention = new PerfRetention({
        dir,
        runUuid: ownerUuid,
        maxFiles: 1,
        maxBytes: 10_000_000,
      });
      await retention.start();
      await retention.maintain(now);

      // The fresh claim survives (non-stale; counts toward caps).
      expect(exists(`${otherUuid}.claim`)).toBe(true);
      expect(exists(`${ownerUuid}.claim`)).toBe(true);
      // The old-day JSONL is evicted despite the fresh claim on its run.
      expect(exists(otherOldName)).toBe(false);

      await retention.dispose();
    });

    it('the owner current-day live file survives while its own old-day files converge', async () => {
      const now = Date.parse('2026-08-10T12:00:00.000Z');
      const todayKey = utcDayKey(now);
      const yesterdayKey = utcDayKey(now - 86_400_000);
      const ownerUuid = '00000000-0000-4000-8000-000000000120';

      // Current-day live file — protected (live writer).
      const liveName = `perf-${todayKey}-${ownerUuid}.jsonl`;
      writeExactFile(liveName, 4096);
      setMtime(liveName, now - 5_000);

      // The owner's OWN old-day file — eligible (not a live writer).
      const ownerOldName = `perf-${yesterdayKey}-${ownerUuid}.jsonl`;
      writeExactFile(ownerOldName, 4096);
      setMtime(ownerOldName, now - 86_400_000);

      // An unaffiliated, older file from a run with no claim — eligible.
      const loneName = `perf-${utcDayKey(now - 2 * 86_400_000)}-00000000-0000-4000-8000-000000000121.jsonl`;
      writeExactFile(loneName, 4096);
      setMtime(loneName, now - 2 * 86_400_000);

      const retention = new PerfRetention({
        dir,
        runUuid: ownerUuid,
        maxFiles: 1,
        maxBytes: 10_000_000,
      });
      await retention.start();
      await retention.maintain(now);

      // The lone file and the owner's old-day file are evicted; only the
      // current-day live file and the fresh claim survive.
      expect(exists(loneName)).toBe(false);
      expect(exists(ownerOldName)).toBe(false);
      expect(exists(liveName)).toBe(true);
      expect(exists(`${ownerUuid}.claim`)).toBe(true);
      expect(listFiles()).toStrictEqual([`${ownerUuid}.claim`, liveName]);

      await retention.dispose();
    });
  });
});
