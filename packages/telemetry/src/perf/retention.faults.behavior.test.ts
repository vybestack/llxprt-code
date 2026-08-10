/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Fault-tolerance and diagnostics behavioral tests for PerfRetention
 * (AC-7, D6, D-LC-4).
 *
 * Covers the error-path behavior split out of the original
 * retention.behavior.test.ts: failed-unlink accounting that stays intact
 * (AC-7, D6) and fail-open diagnostics emitted on filesystem failures
 * (D-LC-4).
 *
 * Real files, real filesystem. Faults are injected through the package-private
 * FaultInjectingRetentionFilesystem port (no monkeypatching of node:fs).
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  PerfRetention,
  FaultInjectingRetentionFilesystem,
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

describe('PerfRetention failed unlink — accounting intact (AC-7, D6)', () => {
  it('does NOT decrement file/byte count when unlink fails', async () => {
    const now = Date.now();
    const firstName =
      'perf-20260101-00000000-0000-4000-8000-0000000000ee.jsonl';
    const secondName =
      'perf-20260102-00000000-0000-4000-8000-0000000000ee.jsonl';
    writePerfFile(firstName, 5);
    setMtime(firstName, now - 86_400_000);
    writePerfFile(secondName, 5);
    setMtime(secondName, now - 43_200_000);

    const diagnostics: string[] = [];
    const faultFs = new FaultInjectingRetentionFilesystem({
      failMethod: 'unlink',
      code: 'EACCES',
    });

    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000014',
      fs: faultFs,
      maxFiles: 1,
      maxBytes: 10_000_000,
      onDiagnostic: (m) => diagnostics.push(m),
    });
    await retention.maintain(now);

    expect(retention.evictionCount).toBe(0);
    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(diagnostics[0]).toContain('EACCES');
    expect(fs.existsSync(path.join(dir, firstName))).toBe(true);
    expect(fs.existsSync(path.join(dir, secondName))).toBe(true);
  });

  it('diagnostics are rate-limited for repeated unlink failures', async () => {
    const now = Date.now();

    for (let i = 0; i < 5; i++) {
      writePerfFile(`perf-2026010${i}-fail.jsonl`, 1);
      setMtime(`perf-2026010${i}-fail.jsonl`, now - (5 - i) * 86_400_000);
    }

    const diagnostics: string[] = [];
    const faultFs = new FaultInjectingRetentionFilesystem({
      failMethod: 'unlink',
      code: 'EACCES',
    });

    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000015',
      fs: faultFs,
      maxFiles: 1,
      maxBytes: 10_000_000,
      diagRateLimitMs: 60_000,
      onDiagnostic: (msg) => diagnostics.push(msg),
    });
    await retention.maintain(now);

    expect(diagnostics).toHaveLength(1);
  });
});

describe('PerfRetention fail-open diagnostics (D-LC-4)', () => {
  it('emits a rate-limited diagnostic when stat fails during maintain', async () => {
    const now = Date.now();
    writePerfFile('perf-20260101-a.jsonl', 1);
    setMtime('perf-20260101-a.jsonl', now - 86_400_000);

    const diagnostics: string[] = [];
    const faultFs = new FaultInjectingRetentionFilesystem({
      failMethod: 'stat',
      code: 'EACCES',
    });
    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-00000000001c',
      fs: faultFs,
      maxFiles: 1,
      maxBytes: 1,
      onDiagnostic: (m) => diagnostics.push(m),
    });
    await retention.maintain(now);

    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(diagnostics[0]).toContain('EACCES');

    expect(fs.existsSync(path.join(dir, 'perf-20260101-a.jsonl'))).toBe(true);
  });

  it('emits a diagnostic when readdir fails in countNonStaleClaims', async () => {
    const diagnostics: string[] = [];
    const faultFs = new FaultInjectingRetentionFilesystem({
      failMethod: 'readdir',
      code: 'EACCES',
    });
    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-00000000001d',
      fs: faultFs,
      onDiagnostic: (m) => diagnostics.push(m),
    });
    const count = await retention.countNonStaleClaims(Date.now());

    expect(count).toBe(0);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]).toContain('EACCES');
  });

  it('emits a diagnostic when a claim stat fails in countNonStaleClaims', async () => {
    const now = Date.now();
    createClaimFile('fresh', now - 10_000);

    const diagnostics: string[] = [];
    const faultFs = new FaultInjectingRetentionFilesystem({
      failMethod: 'stat',
      code: 'EACCES',
    });
    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-00000000001e',
      fs: faultFs,
      onDiagnostic: (m) => diagnostics.push(m),
    });
    const count = await retention.countNonStaleClaims(now);

    expect(count).toBe(0);
    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(diagnostics[0]).toContain('EACCES');
  });

  it('emits a diagnostic for an ENOENT race in countNonStaleClaims', async () => {
    const now = Date.now();
    createClaimFile('racy', now - 10_000);

    const diagnostics: string[] = [];
    const faultFs = new FaultInjectingRetentionFilesystem({
      failMethod: 'stat',
      code: 'ENOENT',
    });
    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-00000000001f',
      fs: faultFs,
      onDiagnostic: (m) => diagnostics.push(m),
    });
    const count = await retention.countNonStaleClaims(now);

    expect(count).toBe(0);
    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(diagnostics[0]).toContain('ENOENT');
  });
});

// ---------------------------------------------------------------------------
// Claim start failure: truthful retryable state + recovered start (D3, D6)
// ---------------------------------------------------------------------------

describe('PerfRetention claim start failure — truthful retryable state (D3, D6)', () => {
  it('EACCES on openExclusive leaves truthful retryable state; a recovered start creates one claim', async () => {
    const runUuid = '00000000-0000-4000-8000-000000000030';
    const faultFs = new FaultInjectingRetentionFilesystem({
      failMethod: 'openExclusive',
      code: 'EACCES',
    });
    const diagnostics: string[] = [];
    const retention = new PerfRetention({
      dir,
      runUuid,
      fs: faultFs,
      onDiagnostic: (m) => diagnostics.push(m),
    });

    // start() must fail-open (no throw) on the errno error.
    await retention.start();

    // Truthful state: no claim file was created, and a diagnostic was emitted.
    expect(fs.existsSync(path.join(dir, `${runUuid}.claim`))).toBe(false);
    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(diagnostics[0]).toContain('EACCES');

    // Disposing a failed-start instance is safe (no timer, no claim).
    await retention.dispose();

    // Recovered start: a new instance with a working filesystem creates
    // exactly one claim in the same directory.
    const recovered = new PerfRetention({
      dir,
      runUuid,
      onDiagnostic: () => {},
    });
    await recovered.start();

    const files = fs.readdirSync(dir).sort();
    expect(files).toEqual([`${runUuid}.claim`]);

    await recovered.dispose();
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it('EEXIST (pre-existing claim) leaves truthful retryable state; removing the stale claim allows recovered start', async () => {
    const runUuid = '00000000-0000-4000-8000-000000000031';
    const claimPath = path.join(dir, `${runUuid}.claim`);

    // Pre-create the claim file so openExclusive throws EEXIST on the real fs.
    fs.writeFileSync(claimPath, '', { mode: 0o600 });

    const diagnostics: string[] = [];
    const retention = new PerfRetention({
      dir,
      runUuid,
      onDiagnostic: (m) => diagnostics.push(m),
    });

    // start() must fail-open on EEXIST.
    await retention.start();

    expect(diagnostics.length).toBeGreaterThanOrEqual(1);

    // No timer was created; disposing the failed-start instance is safe.
    await retention.dispose();

    // The pre-existing file remains (not a phantom from our failed start).
    expect(fs.existsSync(claimPath)).toBe(true);

    // Remove the stale claim → recovered start creates exactly one claim.
    fs.unlinkSync(claimPath);
    const recovered = new PerfRetention({
      dir,
      runUuid,
      onDiagnostic: () => {},
    });
    await recovered.start();

    expect(fs.existsSync(claimPath)).toBe(true);
    const files = fs.readdirSync(dir).sort();
    expect(files).toEqual([`${runUuid}.claim`]);

    await recovered.dispose();
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });
});
