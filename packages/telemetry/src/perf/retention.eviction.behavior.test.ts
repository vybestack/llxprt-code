/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Eviction-policy behavioral tests for PerfRetention (AC-7, D3).
 *
 * Covers the eviction decisions split out of the original
 * retention.behavior.test.ts: live-writer safety (AC-7), claim handling during
 * retention (AC-7, D3), oldest-first cap convergence (AC-7), and future-mtime
 * boundary protection (AC-7 boundary).
 *
 * Real files, real filesystem, no mocks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  PerfRetention,
  PERF_CLAIM_LEASE_MS,
  PERF_MAINTENANCE_INTERVAL_MS,
} from './retention.js';

let dir: string;

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

describe('PerfRetention live-writer safety (AC-7)', () => {
  it('does NOT evict a today file with mtime within the maintenance window', async () => {
    const now = Date.now();

    writePerfFile('perf-20260101-old.jsonl', 5);
    setMtime('perf-20260101-old.jsonl', now - 86_400_000);

    const todayKey = utcDayKey(now);
    writePerfFile(`perf-${todayKey}-live.jsonl`, 5);
    setMtime(`perf-${todayKey}-live.jsonl`, now - 5_000);

    createClaimFile('stalestale', now - PERF_CLAIM_LEASE_MS - 1);

    const retention = new PerfRetention({
      dir,
      runUuid: 'stale',
      maxFiles: 2,
      maxBytes: 10_000,
    });
    await retention.maintain(now);

    expect(fs.existsSync(path.join(dir, 'perf-20260101-old.jsonl'))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(dir, `perf-${todayKey}-live.jsonl`))).toBe(
      true,
    );
  });

  it('evicts a today file whose mtime is older than the maintenance window', async () => {
    const now = Date.now();
    const todayKey = utcDayKey(now);

    writePerfFile(`perf-${todayKey}-stale.jsonl`, 5);
    setMtime(
      `perf-${todayKey}-stale.jsonl`,
      now - PERF_MAINTENANCE_INTERVAL_MS - 1,
    );

    writePerfFile('perf-20260101-older.jsonl', 5);
    setMtime('perf-20260101-older.jsonl', now - 86_400_000 * 2);

    // With maxBytes: 1 the byte cap forces every eligible file to be evicted,
    // proving the stale-mtime today file is NOT protected by live-writer safety.
    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-0000000000aa',
      maxFiles: 10_000_000,
      maxBytes: 1,
    });
    await retention.maintain(now);

    expect(fs.existsSync(path.join(dir, 'perf-20260101-older.jsonl'))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(dir, `perf-${todayKey}-stale.jsonl`))).toBe(
      false,
    );
  });
});

describe('PerfRetention claim handling in retention (AC-7, D3)', () => {
  it('claims count toward artifact count and bytes but are never JSONL parsed', async () => {
    const now = Date.now();

    writePerfFile('perf-20260101-a.jsonl', 3);
    setMtime('perf-20260101-a.jsonl', now - 86_400_000);
    createClaimFile(
      '00000000-0000-4000-8000-00000000000f',
      now - PERF_CLAIM_LEASE_MS - 1,
    );

    const retention = new PerfRetention({
      dir,
      runUuid: 'a',
      maxFiles: 1,
      maxBytes: 10_000_000,
    });
    await retention.maintain(now);

    const remaining = listFiles();
    expect(remaining).toEqual(['perf-20260101-a.jsonl']);
  });

  it('a fresh claim is never evicted', async () => {
    const now = Date.now();
    createClaimFile('00000000-0000-4000-8000-00000000000e', now - 10_000);

    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-00000000000d',
      maxFiles: 1,
      maxBytes: 1,
    });
    await retention.maintain(now);

    expect(
      fs.existsSync(
        path.join(dir, '00000000-0000-4000-8000-00000000000e.claim'),
      ),
    ).toBe(true);
  });

  it('a stale claim IS eligible for eviction', async () => {
    const now = Date.now();
    // A stale claim for a DIFFERENT run (past the lease) — eligible.
    createClaimFile(
      '00000000-0000-4000-8000-00000000000a',
      now - PERF_CLAIM_LEASE_MS - 1,
    );
    // The owner's own claim, kept fresh — protected (and own-run).
    createClaimFile('00000000-0000-4000-8000-00000000000f', now - 10_000);

    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-00000000000f',
      maxFiles: 1,
      maxBytes: 1,
    });
    await retention.maintain(now);

    expect(
      fs.existsSync(
        path.join(dir, '00000000-0000-4000-8000-00000000000a.claim'),
      ),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(dir, '00000000-0000-4000-8000-00000000000f.claim'),
      ),
    ).toBe(true);
  });

  it('a future-mtime claim is protected until it becomes eligible', async () => {
    const now = Date.now();

    createClaimFile('00000000-0000-4000-8000-000000000010', now + 3_600_000);

    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000011',
      maxFiles: 1,
      maxBytes: 1,
    });
    await retention.maintain(now);

    expect(
      fs.existsSync(
        path.join(dir, '00000000-0000-4000-8000-000000000010.claim'),
      ),
    ).toBe(true);
  });
});

describe('PerfRetention oldest-first cap convergence (AC-7)', () => {
  it('evicts oldest-first until under both caps', async () => {
    const now = Date.now();

    for (let i = 0; i < 5; i++) {
      writePerfFile(`perf-2026010${i}-file.jsonl`, 1);
      setMtime(`perf-2026010${i}-file.jsonl`, now - (5 - i) * 86_400_000);
    }

    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000040',
      maxFiles: 2,
      maxBytes: 10_000_000,
    });
    await retention.maintain(now);

    const remaining = listFiles();
    expect(remaining.length).toBe(2);

    expect(remaining).toContain('perf-20260104-file.jsonl');
    expect(remaining).toContain('perf-20260103-file.jsonl');
  });

  it('stable deterministic tie-break by name when mtimes are equal', async () => {
    const now = Date.now();

    writePerfFile(
      'perf-20260101-00000000-0000-4000-8000-000000000011.jsonl',
      1,
    );
    writePerfFile(
      'perf-20260101-00000000-0000-4000-8000-000000000012.jsonl',
      1,
    );
    setMtime(
      'perf-20260101-00000000-0000-4000-8000-000000000011.jsonl',
      now - 86_400_000,
    );
    setMtime(
      'perf-20260101-00000000-0000-4000-8000-000000000012.jsonl',
      now - 86_400_000,
    );

    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000099',
      maxFiles: 1,
      maxBytes: 10_000_000,
    });
    await retention.maintain(now);

    const remaining = listFiles();
    // Equal mtimes → tie-break by name: ...011 sorts before ...012, so ...011
    // is evicted first and ...012 survives.
    expect(remaining).toContain(
      'perf-20260101-00000000-0000-4000-8000-000000000012.jsonl',
    );
    expect(remaining).not.toContain(
      'perf-20260101-00000000-0000-4000-8000-000000000011.jsonl',
    );
  });

  it('converges after enough sweeps under concurrent append overshoot', async () => {
    const now = Date.now();

    for (let i = 0; i < 10; i++) {
      writePerfFile(`perf-2026010${i}-f.jsonl`, 1);
      setMtime(`perf-2026010${i}-f.jsonl`, now - (10 - i) * 3_600_000);
    }

    const retention = new PerfRetention({
      dir,
      runUuid: 'new',
      maxFiles: 3,
      maxBytes: 10_000_000,
    });

    await retention.maintain(now);

    writePerfFile('perf-20260110-new.jsonl', 1);
    setMtime('perf-20260110-new.jsonl', now);

    await retention.maintain(now);

    const remaining = listFiles();
    expect(remaining.length).toBeLessThanOrEqual(3);
  });
});

describe('PerfRetention future mtime (AC-7 boundary)', () => {
  it('a file with materially-future mtime is protected', async () => {
    const now = Date.now();
    const todayKey = utcDayKey(now);
    writePerfFile(`perf-${todayKey}-future.jsonl`, 3);
    setMtime(`perf-${todayKey}-future.jsonl`, now + 3_600_000);

    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-00000000001b',
      maxFiles: 1,
      maxBytes: 1,
      onDiagnostic: () => {},
    });
    await retention.maintain(now);

    expect(fs.existsSync(path.join(dir, `perf-${todayKey}-future.jsonl`))).toBe(
      true,
    );
  });
});

function utcDayKey(now: number): string {
  const date = new Date(now);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}
