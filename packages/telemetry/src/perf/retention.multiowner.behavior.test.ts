/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Real multi-owner protection evidence for PerfRetention (AC-7, D3).
 *
 * Fresh/future claims protect matching JSONL regardless of age; the current
 * owner's own run is always protected during its active retention lifetime;
 * stale claims and stale-run JSONL are eligible for eviction. A run protected
 * by a fresh claim must NOT become permanently non-evictable once that claim
 * goes stale.
 *
 * No mocks — real files, real filesystem, distinct standard UUIDs per run.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { PerfRetention, PERF_CLAIM_LEASE_MS } from './retention.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-multiowner-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writePerfFile(name: string, recordCount: number): void {
  const lines: string[] = [];
  for (let i = 0; i < recordCount; i++) {
    lines.push(
      JSON.stringify({
        schema_version: 1,
        record_type: 'operation',
        ts: '2026-01-01T00:00:00.000Z',
        pad: '.'.repeat(1100),
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

describe('PerfRetention multi-owner protection (AC-7, D3)', () => {
  it('fresh/future claims protect matching JSONL; owner run protected; stale claims and stale-run JSONL eligible', async () => {
    const now = Date.now();
    const ownerUuid = '00000000-0000-4000-8000-000000000050';
    const freshUuid = '00000000-0000-4000-8000-000000000051';
    const staleUuid = '00000000-0000-4000-8000-000000000052';
    const noclaimUuid = '00000000-0000-4000-8000-000000000053';

    // Old-day JSONL for four distinct runs (all would be eligible without
    // claim/owner protection).
    for (const uuid of [freshUuid, staleUuid, noclaimUuid, ownerUuid]) {
      const name = `perf-20260101-${uuid}.jsonl`;
      writePerfFile(name, 1);
      setMtime(name, now - 86_400_000);
    }

    // Fresh claim for freshUuid → protects freshUuid's JSONL regardless of age.
    createClaimFile(freshUuid, now - 10_000);
    // Stale claim for staleUuid → does NOT protect staleUuid's JSONL.
    createClaimFile(staleUuid, now - PERF_CLAIM_LEASE_MS - 1);

    const retention = new PerfRetention({
      dir,
      runUuid: ownerUuid,
      maxFiles: 1,
      maxBytes: 10_000_000,
    });
    await retention.start();
    await retention.maintain(now);

    // Fresh claim protects its run's JSONL.
    expect(
      fs.existsSync(path.join(dir, `perf-20260101-${freshUuid}.jsonl`)),
    ).toBe(true);
    // Owner's own run is always protected.
    expect(
      fs.existsSync(path.join(dir, `perf-20260101-${ownerUuid}.jsonl`)),
    ).toBe(true);
    // Stale claim → its JSONL eligible and evicted.
    expect(
      fs.existsSync(path.join(dir, `perf-20260101-${staleUuid}.jsonl`)),
    ).toBe(false);
    // No claim at all → eligible and evicted.
    expect(
      fs.existsSync(path.join(dir, `perf-20260101-${noclaimUuid}.jsonl`)),
    ).toBe(false);
    // The stale claim artifact itself is eligible and evicted.
    expect(fs.existsSync(path.join(dir, `${staleUuid}.claim`))).toBe(false);

    await retention.dispose();
  });

  it('a run protected by a fresh claim becomes eligible once that claim goes stale (not permanently non-evictable)', async () => {
    const now = Date.now();
    const ownerUuid = '00000000-0000-4000-8000-000000000060';
    const otherUuid = '00000000-0000-4000-8000-000000000061';

    const otherName = `perf-20260101-${otherUuid}.jsonl`;
    writePerfFile(otherName, 1);
    setMtime(otherName, now - 86_400_000);

    const retention = new PerfRetention({
      dir,
      runUuid: ownerUuid,
      maxFiles: 1,
      maxBytes: 10_000_000,
    });

    // Phase 1: fresh claim for otherUuid protects its JSONL from eviction.
    createClaimFile(otherUuid, now - 10_000);
    await retention.maintain(now);
    expect(fs.existsSync(path.join(dir, otherName))).toBe(true);

    // Phase 2: enough time elapses that the claim is now stale. otherUuid's
    // JSONL is no longer protected and is eligible for eviction. The stale
    // claim itself is also eligible (shown in the first multi-owner test);
    // here we assert the previously-protected JSONL is now reaped.
    const laterNow = now + PERF_CLAIM_LEASE_MS + 1;
    await retention.maintain(laterNow);
    expect(fs.existsSync(path.join(dir, otherName))).toBe(false);
  });

  it('the current owner run remains protected across sweeps during its active retention lifetime', async () => {
    const now = Date.now();
    const ownerUuid = '00000000-0000-4000-8000-000000000070';
    const ownerName = `perf-20260101-${ownerUuid}.jsonl`;
    writePerfFile(ownerName, 1);
    setMtime(ownerName, now - 86_400_000);

    // A second, unaffiliated old file from a run with no claim — eligible.
    const loneName = 'perf-20260101-00000000-0000-4000-8000-000000000071.jsonl';
    writePerfFile(loneName, 1);
    setMtime(loneName, now - 86_400_000);

    const retention = new PerfRetention({
      dir,
      runUuid: ownerUuid,
      maxFiles: 1,
      maxBytes: 10_000_000,
    });
    await retention.start();
    await retention.maintain(now);

    // The lone file is evicted; the owner's own run is protected.
    expect(fs.existsSync(path.join(dir, loneName))).toBe(false);
    expect(fs.existsSync(path.join(dir, ownerName))).toBe(true);

    await retention.dispose();
  });
});
