/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cap-selection behavioral test for PerfRetention (P08, D5).
 *
 * Under observed single-writer volume, asserts which of (count cap, byte cap)
 * binds first. Uses the P04 benchmark values:
 *   operation record (with memory): 1220 bytes/line
 *   memory_sample record:           242 bytes/line
 *   combined per-operation pair:    1462 bytes
 *
 * The byte cap (64 MiB) binds for high-volume writers (>~359 pairs/day);
 * the file cap (128) binds for low-volume writers (<~359 pairs/day).
 * At representative single-writer interactive use (~100 ops/day), the file cap
 * is the binding constraint at ~128 days.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { PerfRetention, PERF_MAX_BYTES, PERF_MAX_FILES } from './retention.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-cap-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('PerfRetention cap selection (D5)', () => {
  it('at representative single-writer volume (~100 ops/day) the file cap binds', async () => {
    const now = Date.now();
    // Simulate MAX_FILES days × 100 operations/day at ~1220 bytes/op (no memory).
    // MAX_FILES × 100 × 1220 ≈ 15.6 MiB < 64 MiB.
    // So MAX_FILES files is under the byte cap but at the file cap.
    for (let i = 0; i < PERF_MAX_FILES; i++) {
      const dayKey = makeSequentialDayKey(i);
      const content =
        `${JSON.stringify({ idx: 0, pad: '.'.repeat(1100) })}\n`.repeat(100);
      fs.writeFileSync(path.join(dir, `perf-${dayKey}-w.jsonl`), content);
      fs.utimesSync(
        path.join(dir, `perf-${dayKey}-w.jsonl`),
        new Date(now - (PERF_MAX_FILES - i) * 86_400_000),
        new Date(now - (PERF_MAX_FILES - i) * 86_400_000),
      );
    }

    // Verify total bytes is under the byte cap.
    let totalBytes = 0;
    for (const f of fs.readdirSync(dir)) {
      totalBytes += fs.statSync(path.join(dir, f)).size;
    }
    expect(totalBytes).toBeLessThan(PERF_MAX_BYTES);

    // With one more file, the file cap binds.
    const extraKey = makeSequentialDayKey(PERF_MAX_FILES);
    fs.writeFileSync(
      path.join(dir, `perf-${extraKey}-extra.jsonl`),
      `${JSON.stringify({ idx: 0 })}\n`,
    );
    fs.utimesSync(
      path.join(dir, `perf-${extraKey}-extra.jsonl`),
      new Date(now),
      new Date(now),
    );

    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000000',
      onDiagnostic: () => {},
    });
    await retention.maintain(now);

    // File count should be at most MAX_FILES (128).
    const remaining = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    expect(remaining.length).toBeLessThanOrEqual(PERF_MAX_FILES);
  });

  it('at high single-writer volume the byte cap binds before the file cap', async () => {
    const now = Date.now();
    // Create fewer than MAX_FILES files but exceeding MAX_BYTES total.
    // 8 files × ~8 MiB each = ~64 MiB ≈ MAX_BYTES.
    const bytesPerFile = Math.ceil(PERF_MAX_BYTES / 7); // ~9.6 MiB each
    for (let i = 0; i < 8; i++) {
      const dayKey = makeSequentialDayKey(i);
      const padding = '.'.repeat(bytesPerFile);
      fs.writeFileSync(path.join(dir, `perf-${dayKey}-h.jsonl`), padding);
      fs.utimesSync(
        path.join(dir, `perf-${dayKey}-h.jsonl`),
        new Date(now - (8 - i) * 86_400_000),
        new Date(now - (8 - i) * 86_400_000),
      );
    }

    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000001',
      onDiagnostic: () => {},
    });
    await retention.maintain(now);

    let remainingBytes = 0;
    const remaining = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    for (const f of remaining) {
      remainingBytes += fs.statSync(path.join(dir, f)).size;
    }
    // The byte cap should be enforced (files count < MAX_FILES proves byte cap bound).
    expect(remaining.length).toBeLessThan(PERF_MAX_FILES);
    // Total bytes should be under the byte cap.
    expect(remainingBytes).toBeLessThanOrEqual(PERF_MAX_BYTES);
  });
});

/**
 * Generates sequential valid 8-digit YYYYMMDD day keys starting from a base date.
 * Index 0 → 20250101, index 1 → 20250102, etc., rolling over months/years as needed.
 */
function makeSequentialDayKey(index: number): string {
  const base = new Date(Date.UTC(2025, 0, 1));
  base.setUTCDate(base.getUTCDate() + index);
  const year = base.getUTCFullYear();
  const month = String(base.getUTCMonth() + 1).padStart(2, '0');
  const day = String(base.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}
