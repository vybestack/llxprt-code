/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { perfDelete } from './perfDelete.js';
import type { PerfDeleteFilesystem } from './perfDelete.js';

async function makeTempDir(): Promise<string> {
  const dir = join(
    tmpdir(),
    `perf-delete-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function utcDayKey(now: number): string {
  const d = new Date(now);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

async function writeFile(
  dir: string,
  name: string,
  content: string,
  mtimeMs?: number,
): Promise<void> {
  await fs.writeFile(join(dir, name), content, 'utf8');
  if (mtimeMs !== undefined) {
    const d = new Date(mtimeMs);
    await fs.utimes(join(dir, name), d, d);
  }
}

async function statWithReadOnlyFailure(
  filePath: string,
): Promise<{ readonly size: number; readonly mtimeMs: number }> {
  if (filePath.endsWith('perf-20260101-old.jsonl')) {
    const error = new Error('read-only file system') as NodeJS.ErrnoException;
    error.code = 'EROFS';
    throw error;
  }
  const stat = await fs.stat(filePath);
  return { size: stat.size, mtimeMs: stat.mtimeMs };
}

describe('PerfDelete (P11, AC-9, D3)', () => {
  let dir: string;
  const now = Date.parse('2026-01-15T12:00:00.000Z');
  const dayKey = utcDayKey(now);
  const maintenanceIntervalMs = 60_000;
  const claimLeaseMs = 180_000;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('deletes stale perf JSONL files and stale claims', async () => {
    // Old file (past day) — eligible
    await writeFile(dir, `perf-20260101-old.jsonl`, '{"schema_version":1}\n');
    // Stale claim (mtime is old, past lease)
    await writeFile(dir, 'stale-uuid.claim', '', now - claimLeaseMs - 10_000);

    const result = await perfDelete({
      dir,
      now,
      maintenanceIntervalMs,
      claimLeaseMs,
    });

    expect(result.deleted).toBe(2);
    expect(result.protected).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.deletedFiles).toContain('perf-20260101-old.jsonl');
    expect(result.deletedFiles).toContain('stale-uuid.claim');

    // Verify files are actually gone
    const remaining = await fs.readdir(dir);
    expect(remaining).toHaveLength(0);
  });

  it('protects current UTC-day file with recent mtime (active writer)', async () => {
    // Today's file with recent mtime
    await writeFile(
      dir,
      `perf-${dayKey}-active.jsonl`,
      '{"schema_version":1}\n',
      now - 10_000, // 10s ago, within maintenance window
    );

    const result = await perfDelete({
      dir,
      now,
      maintenanceIntervalMs,
      claimLeaseMs,
    });

    expect(result.deleted).toBe(0);
    expect(result.protected).toBe(1);
    expect(result.protectedFiles).toContain(`perf-${dayKey}-active.jsonl`);

    // File still exists
    const remaining = await fs.readdir(dir);
    expect(remaining).toContain(`perf-${dayKey}-active.jsonl`);
  });

  it('protects perf JSONL whose run UUID has a non-stale claim', async () => {
    // Old-day perf file (would normally be eligible)
    await writeFile(
      dir,
      'perf-20260101-protected.jsonl',
      '{"schema_version":1}\n',
    );
    // Fresh claim for the same run UUID
    await writeFile(
      dir,
      'protected.claim',
      '',
      now - 10_000, // fresh, within lease
    );

    const result = await perfDelete({
      dir,
      now,
      maintenanceIntervalMs,
      claimLeaseMs,
    });

    // The perf JSONL is protected by the fresh claim
    expect(result.protectedFiles).toContain('perf-20260101-protected.jsonl');
    expect(result.protectedFiles).toContain('protected.claim');
    expect(result.deleted).toBe(0);
  });

  it('protects non-stale/future-dated claims (lease)', async () => {
    // Fresh claim
    await writeFile(dir, 'fresh.claim', '', now - 1000);
    // Future-dated claim
    await writeFile(dir, 'future.claim', '', now + 60_000);
    // Stale claim
    await writeFile(dir, 'stale.claim', '', now - claimLeaseMs - 10_000);

    const result = await perfDelete({
      dir,
      now,
      maintenanceIntervalMs,
      claimLeaseMs,
    });

    expect(result.protectedFiles).toContain('fresh.claim');
    expect(result.protectedFiles).toContain('future.claim');
    expect(result.deletedFiles).toContain('stale.claim');
  });

  it('deletes old perf JSONL whose claim is stale', async () => {
    // Old-day perf file
    await writeFile(dir, 'perf-20260101-stale-claim.jsonl', '{"v":1}\n');
    // Stale claim for the same run UUID
    await writeFile(dir, 'stale-claim.claim', '', now - claimLeaseMs - 10_000);

    const result = await perfDelete({
      dir,
      now,
      maintenanceIntervalMs,
      claimLeaseMs,
    });

    expect(result.deletedFiles).toContain('perf-20260101-stale-claim.jsonl');
    expect(result.deletedFiles).toContain('stale-claim.claim');
  });

  it('never deletes unrelated files', async () => {
    await writeFile(dir, 'random.txt', 'hello');
    await writeFile(dir, 'other.log', 'world');
    await writeFile(dir, 'config.json', '{}');
    // Also a stale perf file to trigger the delete logic
    await writeFile(dir, 'perf-20260101-old.jsonl', '{"v":1}\n');

    const result = await perfDelete({
      dir,
      now,
      maintenanceIntervalMs,
      claimLeaseMs,
    });

    // Only perf-*.jsonl and *.claim are touched
    expect(result.deletedFiles).not.toContain('random.txt');
    expect(result.deletedFiles).not.toContain('other.log');
    expect(result.deletedFiles).not.toContain('config.json');

    // Unrelated files still exist
    const remaining = await fs.readdir(dir);
    expect(remaining).toContain('random.txt');
    expect(remaining).toContain('other.log');
    expect(remaining).toContain('config.json');
  });

  it('missing directory is a no-op (fail open)', async () => {
    const result = await perfDelete({
      dir: join(dir, 'does-not-exist'),
      now,
      maintenanceIntervalMs,
      claimLeaseMs,
    });

    expect(result.deleted).toBe(0);
    expect(result.protected).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('external fs failures fail open and are counted', async () => {
    await writeFile(dir, 'perf-20260101-old.jsonl', '{"v":1}\n');

    const failingFs: PerfDeleteFilesystem = {
      readdir: async (d: string) => fs.readdir(d),
      stat: async (p: string) => {
        const s = await fs.stat(p);
        return { size: s.size, mtimeMs: s.mtimeMs };
      },
      unlink: async () => {
        const err = new Error('EACCES') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      },
    };

    const result = await perfDelete({
      dir,
      now,
      maintenanceIntervalMs,
      claimLeaseMs,
      fs: failingFs,
    });

    expect(result.failed).toBe(1);
    expect(result.deleted).toBe(0);
    expect(result.failedFiles).toContain('perf-20260101-old.jsonl');
  });

  it('internal invalid options (NaN now) fail fast', async () => {
    await expect(
      perfDelete({
        dir,
        now: NaN,
        maintenanceIntervalMs,
        claimLeaseMs,
      }),
    ).rejects.toThrow(RangeError);
  });

  it('internal invalid options (negative interval) fail fast', async () => {
    await expect(
      perfDelete({
        dir,
        now,
        maintenanceIntervalMs: -1,
        claimLeaseMs,
      }),
    ).rejects.toThrow(RangeError);
  });

  it('deletes stale claims alongside perf JSONL from same run', async () => {
    // Old perf file from run "aaa" with stale claim
    await writeFile(dir, 'perf-20260101-aaa.jsonl', '{"v":1}\n');
    await writeFile(dir, 'aaa.claim', '', now - claimLeaseMs - 10_000);

    // Old perf file from run "bbb" with fresh claim → protected
    await writeFile(dir, 'perf-20260101-bbb.jsonl', '{"v":1}\n');
    await writeFile(dir, 'bbb.claim', '', now - 1000);

    const result = await perfDelete({
      dir,
      now,
      maintenanceIntervalMs,
      claimLeaseMs,
    });

    // aaa's stale perf and claim deleted
    expect(result.deletedFiles).toContain('perf-20260101-aaa.jsonl');
    expect(result.deletedFiles).toContain('aaa.claim');
    // bbb's perf and claim protected (fresh claim)
    expect(result.protectedFiles).toContain('perf-20260101-bbb.jsonl');
    expect(result.protectedFiles).toContain('bbb.claim');
  });

  // --- P11: external errno readdir/stat failures are counted as failures ---

  it('EACCES readdir failure is counted as a failure with a directory sentinel', async () => {
    await writeFile(dir, 'perf-20260101-old.jsonl', '{"v":1}\n');

    const failingFs: PerfDeleteFilesystem = {
      readdir: async () => {
        const err = new Error('permission denied') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      },
      stat: async (p: string) => {
        const s = await fs.stat(p);
        return { size: s.size, mtimeMs: s.mtimeMs };
      },
      unlink: async (p: string) => fs.unlink(p),
    };

    const result = await perfDelete({
      dir,
      now,
      maintenanceIntervalMs,
      claimLeaseMs,
      fs: failingFs,
    });

    // readdir failed entirely: no files enumerated, but the failure is
    // surfaced (not silently zeroed) using a stable directory sentinel.
    expect(result.failed).toBe(1);
    expect(result.deleted).toBe(0);
    expect(result.protected).toBe(0);
    expect(result.failedFiles).toHaveLength(1);
    expect(typeof result.failedFiles[0]).toBe('string');
    expect(result.failedFiles[0].length).toBeGreaterThan(0);
  });

  it('EROFS stat failure is counted as a failure with the file name', async () => {
    await writeFile(dir, 'perf-20260101-old.jsonl', '{"v":1}\n');
    await writeFile(dir, 'perf-20260102-old2.jsonl', '{"v":1}\n');

    const failingFs: PerfDeleteFilesystem = {
      readdir: async (d: string) => fs.readdir(d),
      stat: statWithReadOnlyFailure,
      unlink: async (p: string) => fs.unlink(p),
    };

    const result = await perfDelete({
      dir,
      now,
      maintenanceIntervalMs,
      claimLeaseMs,
      fs: failingFs,
    });

    // The file whose stat failed with EROFS is counted as a failure (named),
    // not silently dropped to null. The other eligible file is deleted.
    expect(result.failed).toBe(1);
    expect(result.failedFiles).toContain('perf-20260101-old.jsonl');
    expect(result.deletedFiles).toContain('perf-20260102-old2.jsonl');
  });

  it('ENOENT readdir (missing dir) remains a no-op, not a failure', async () => {
    const result = await perfDelete({
      dir: join(dir, 'missing-subdir'),
      now,
      maintenanceIntervalMs,
      claimLeaseMs,
    });

    expect(result.failed).toBe(0);
    expect(result.deleted).toBe(0);
    expect(result.protected).toBe(0);
  });

  it('non-errno readdir failure rejects (internal/programming error)', async () => {
    const failingFs: PerfDeleteFilesystem = {
      readdir: async () => {
        throw new TypeError('programmer bug');
      },
      stat: async () => ({ size: 0, mtimeMs: 0 }),
      unlink: async () => {},
    };

    await expect(
      perfDelete({
        dir,
        now,
        maintenanceIntervalMs,
        claimLeaseMs,
        fs: failingFs,
      }),
    ).rejects.toThrow(TypeError);
  });

  it('non-errno stat failure rejects (internal/programming error)', async () => {
    await writeFile(dir, 'perf-20260101-old.jsonl', '{"v":1}\n');

    const failingFs: PerfDeleteFilesystem = {
      readdir: async (d: string) => fs.readdir(d),
      stat: async () => {
        throw new RangeError('internal stat bug');
      },
      unlink: async () => {},
    };

    await expect(
      perfDelete({
        dir,
        now,
        maintenanceIntervalMs,
        claimLeaseMs,
        fs: failingFs,
      }),
    ).rejects.toThrow(RangeError);
  });
});
