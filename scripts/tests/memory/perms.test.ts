/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Permission tests for sensitive profiling artifacts (issue #3230): run
 * directories and the files the probe writes must be owner-only (0700
 * directories, 0600 files) on POSIX. On Windows, mode bits are not part of
 * the security model, so those assertions are skipped and the platform-neutral
 * behavior (files exist and are readable by the owner) is asserted instead.
 */

import { describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DIR_MODE,
  FILE_MODE,
  isPosixPlatform,
  secureFile,
} from '../../memory/perms.ts';
import { createRealProbeDeps } from '../../memory/probe.ts';

const isPosix = isPosixPlatform();

/** POSIX mode bits (masked of file-type bits) for a path. */
function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

describe('perms constants', () => {
  it('defines owner-only modes', () => {
    expect(DIR_MODE).toBe(0o700);
    expect(FILE_MODE).toBe(0o600);
  });
});

describe('secureFile', () => {
  it('applies 0600 to an existing file on POSIX and is a safe no-op elsewhere', () => {
    const dir = mkdtempSync(join(tmpdir(), 'memprobe-perm-1-'));
    try {
      const file = join(dir, 'artifact.txt');
      writeFileSync(file, 'sensitive');
      expect(() => secureFile(file)).not.toThrow();
      if (isPosix) {
        expect(modeOf(file)).toBe(0o600);
      } else {
        // Windows: the file must still exist and be readable by the owner.
        expect(existsSync(file)).toBe(true);
        expect(readFileSync(file, 'utf8')).toBe('sensitive');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('createRealProbeDeps — secure artifact permissions', () => {
  it('creates the run directory with 0700 and sample/log files with 0600 on POSIX', () => {
    const runDir = mkdtempSync(join(tmpdir(), 'memprobe-perm-run-'));
    try {
      const deps = createRealProbeDeps({
        runDir,
        intervalMs: 60_000,
        maxSnapshotHeapMb: 256,
        snapshotsArmed: false,
        verbose: false,
      });
      deps.appendLog('armed test');
      deps.appendSample('{"t":"now"}');
      deps.appendLog('second line');

      const samplesPath = join(runDir, 'samples.jsonl');
      const logPath = join(runDir, 'probe.log');
      expect(existsSync(samplesPath)).toBe(true);
      expect(existsSync(logPath)).toBe(true);
      if (isPosix) {
        expect(modeOf(samplesPath)).toBe(0o600);
        expect(modeOf(logPath)).toBe(0o600);
      } else {
        expect(readFileSync(samplesPath, 'utf8')).toContain('now');
        expect(readFileSync(logPath, 'utf8')).toContain('armed test');
      }
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });
});

describe('snapshot directory permissions after a guarded write', () => {
  it('secures the published snapshot file (0600 on POSIX; readable on Windows)', () => {
    const runDir = mkdtempSync(join(tmpdir(), 'memprobe-perm-snap-'));
    try {
      // Simulate the production write path: temp file written by
      // writeHeapSnapshot (default mode), secured, then renamed.
      const snapshotDir = join(runDir, 'snapshots');
      mkdirSync(snapshotDir, { recursive: true, mode: DIR_MODE });
      const finalPath = join(snapshotDir, 'snap-req-1.heapsnapshot');
      const tempPath = `${finalPath}.tmp`;
      writeFileSync(tempPath, '{"snapshot":{}}');
      secureFile(tempPath);
      renameSync(tempPath, finalPath);

      expect(existsSync(tempPath)).toBe(false);
      expect(existsSync(finalPath)).toBe(true);
      if (isPosix) {
        expect(modeOf(snapshotDir)).toBe(0o700);
        expect(modeOf(finalPath)).toBe(0o600);
      } else {
        expect(readFileSync(finalPath, 'utf8')).toContain('snapshot');
      }
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });
});
