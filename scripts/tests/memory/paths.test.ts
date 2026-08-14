/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for run/samples path resolution (scripts/memory/paths.ts),
 * including Windows (win32) path semantics via an injected join.
 */

import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import {
  type PathDeps,
  RunResolutionError,
  defaultPathDeps,
  resolveActiveRunDir,
  resolveRunDir,
  resolveSamplesPath,
} from '../../memory/paths.ts';
import { LEASE_FILE_NAME } from '../../memory/lease.ts';

const realishDeps = (overrides: Partial<PathDeps> = {}): PathDeps => ({
  // The REAL production dependency (statSync().isDirectory()), not an
  // existsSync stand-in that would treat a regular file as a directory.
  ...defaultPathDeps,
  ...overrides,
});

describe('resolveRunDir', () => {
  it('uses an explicit run directory when it exists', () => {
    const run = mkdtempSync(join(tmpdir(), 'explicit-run-'));
    try {
      const dir = resolveRunDir({
        explicit: run,
        memprofileRoot: '/ignored',
        deps: realishDeps(),
      });
      expect(dir).toBe(run);
    } finally {
      rmSync(run, { recursive: true, force: true });
    }
  });

  it('fails fast on an explicit run directory that does not exist', () => {
    expect(() =>
      resolveRunDir({
        explicit: join(tmpdir(), 'no-such-run-xyz'),
        memprofileRoot: '/ignored',
        deps: realishDeps(),
      }),
    ).toThrow(/does not exist/);
  });

  it('reads the latest pointer when no explicit directory is given', () => {
    const root = mkdtempSync(join(tmpdir(), 'memprofile-root-'));
    const target = mkdtempSync(join(tmpdir(), 'memprofile-latest-'));
    try {
      writeFileSync(join(root, 'latest'), target);
      const dir = resolveRunDir({
        memprofileRoot: root,
        deps: realishDeps(),
      });
      expect(dir).toBe(target);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('rejects an empty latest pointer', () => {
    const root = mkdtempSync(join(tmpdir(), 'memprofile-empty-ptr-'));
    try {
      writeFileSync(join(root, 'latest'), '   ');
      expect(() =>
        resolveRunDir({ memprofileRoot: root, deps: realishDeps() }),
      ).toThrow(/empty/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a latest pointer to a missing run directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'memprofile-dangling-'));
    try {
      writeFileSync(join(root, 'latest'), join(root, 'deleted-run'));
      expect(() =>
        resolveRunDir({ memprofileRoot: root, deps: realishDeps() }),
      ).toThrow(/missing directory/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('throws an actionable error when no run can be resolved', () => {
    const root = mkdtempSync(join(tmpdir(), 'memprofile-empty-'));
    try {
      expect(() =>
        resolveRunDir({ memprofileRoot: root, deps: realishDeps() }),
      ).toThrow(/No profiling run found/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('converts external filesystem failures into RunResolutionError', () => {
    // An injected dependency throwing an OS-level error (EACCES etc.) must
    // surface as an actionable RunResolutionError, not a raw ENOENT-style
    // crash trace.
    const throwing: PathDeps = {
      exists: () => true,
      isDirectory: () => {
        throw Object.assign(new Error('EACCES: permission denied'), {
          code: 'EACCES',
        });
      },
      readFile: (p) => readFileSync(p, 'utf8'),
      join,
    };
    expect(() =>
      resolveRunDir({
        explicit: join(tmpdir(), 'some-run'),
        memprofileRoot: '/ignored',
        deps: throwing,
      }),
    ).toThrow(RunResolutionError);
  });

  it('rejects an explicit path that is a regular file, not a directory', () => {
    // Guards the isDirectory dependency being real: a file named like a run
    // directory must not be accepted.
    const notADir = join(tmpdir(), 'memprofile-not-a-dir-file');
    writeFileSync(notADir, 'x');
    try {
      expect(() =>
        resolveRunDir({
          explicit: notADir,
          memprofileRoot: '/ignored',
          deps: realishDeps(),
        }),
      ).toThrow(/does not exist/);
    } finally {
      rmSync(notADir, { force: true });
    }
  });
});

describe('resolveActiveRunDir — lease-gated resolution', () => {
  const NOW = 1_700_000_000_000;

  /** Writes a lease record into the run directory with a given heartbeat. */
  function writeLease(
    runDir: string,
    lease: { owner: string; pid: number; heartbeatAt: number },
  ): void {
    writeFileSync(join(runDir, LEASE_FILE_NAME), JSON.stringify(lease));
  }

  it('accepts a run whose lease heartbeat is fresh', () => {
    const run = mkdtempSync(join(tmpdir(), 'active-run-'));
    try {
      writeLease(run, {
        owner: 'pabc-000001',
        pid: 123,
        heartbeatAt: NOW - 1_000,
      });
      expect(
        resolveActiveRunDir({
          explicit: run,
          memprofileRoot: '/x',
          now: () => NOW,
        }),
      ).toBe(run);
    } finally {
      rmSync(run, { recursive: true, force: true });
    }
  });

  it('rejects a run with no lease (a dead or finished run)', () => {
    const run = mkdtempSync(join(tmpdir(), 'dead-run-'));
    try {
      expect(() =>
        resolveActiveRunDir({
          explicit: run,
          memprofileRoot: '/x',
          now: () => NOW,
        }),
      ).toThrow(/not active.*no lease|not active/s);
    } finally {
      rmSync(run, { recursive: true, force: true });
    }
  });

  it('rejects a run whose lease heartbeat is stale', () => {
    const run = mkdtempSync(join(tmpdir(), 'stale-run-'));
    try {
      writeLease(run, {
        owner: 'pabc-000001',
        pid: 123,
        heartbeatAt: NOW - 60 * 60_000,
      });
      expect(() =>
        resolveActiveRunDir({
          explicit: run,
          memprofileRoot: '/x',
          now: () => NOW,
        }),
      ).toThrow(/not active.*stale/s);
    } finally {
      rmSync(run, { recursive: true, force: true });
    }
  });

  it('rejects a run whose lease file is malformed', () => {
    const run = mkdtempSync(join(tmpdir(), 'malformed-lease-run-'));
    try {
      writeFileSync(join(run, LEASE_FILE_NAME), 'not-json{');
      expect(() =>
        resolveActiveRunDir({
          explicit: run,
          memprofileRoot: '/x',
          now: () => NOW,
        }),
      ).toThrow(/not active.*malformed/s);
    } finally {
      rmSync(run, { recursive: true, force: true });
    }
  });
});

describe('resolveSamplesPath — Windows path semantics', () => {
  const win32Deps = (latestTarget: string): PathDeps => ({
    exists: () => true,
    isDirectory: (p) => !p.endsWith('.jsonl'),
    readFile: () => latestTarget,
    join: win32.join,
  });

  it('joins a run directory with samples.jsonl using win32 separators', () => {
    const path = resolveSamplesPath({
      explicit: 'C:\\runs\\run-1',
      memprofileRoot: 'C:\\memprofile',
      deps: win32Deps('C:\\runs\\run-1'),
    });
    expect(path).toBe('C:\\runs\\run-1\\samples.jsonl');
  });

  it('returns an explicit samples file path untouched', () => {
    const path = resolveSamplesPath({
      explicit: 'C:\\runs\\run-1\\custom.jsonl',
      memprofileRoot: 'C:\\memprofile',
      deps: win32Deps('C:\\runs\\run-1'),
    });
    expect(path).toBe('C:\\runs\\run-1\\custom.jsonl');
  });

  it('resolves the latest run and joins with win32 separators', () => {
    const path = resolveSamplesPath({
      memprofileRoot: 'C:\\memprofile',
      deps: win32Deps('C:\\runs\\latest'),
    });
    expect(path).toBe('C:\\runs\\latest\\samples.jsonl');
  });
});
