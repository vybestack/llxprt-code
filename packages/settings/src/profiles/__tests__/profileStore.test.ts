/**
 * Behavioral tests for the shared profile persistence utility (#2477).
 * Uses real temp directories and the actual filesystem — no mocking.
 *
 * The lock is backed by a fixed-path O_EXCL file artifact (`.profiles.lock`),
 * providing real cross-process mutual exclusion with NO stale takeover. A
 * lock left by a SIGKILL'd process requires explicit/manual recovery.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  acquireProfilesLock,
  acquireProfilesLockSync,
  lockPathForProfilesDir,
  readProfileFileSync,
  atomicWriteFile,
  writeProfileFile,
  deleteProfileFile,
  withProfilesLockSync,
  withProfilesLock,
  hasErrnoCode,
  LockBusyError,
} from '../profileStore.js';

async function makeTempDir(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'llxprt-profilestore-test-'));
}

describe('profileStore — lockPathForProfilesDir', () => {
  it('returns a deterministic lock file path in the profiles dir', () => {
    expect(lockPathForProfilesDir('/foo/profiles')).toBe(
      path.join('/foo/profiles', '.profiles.lock'),
    );
  });
});

describe('profileStore — hasErrnoCode guard', () => {
  it('narrows for an object with matching string code', () => {
    const error: unknown = { code: 'ENOENT', message: 'no such file' };
    expect(hasErrnoCode(error, 'ENOENT')).toBe(true);
  });

  it('accepts a matching errno code when message is absent', () => {
    const error: unknown = { code: 'ENOENT' };
    expect(hasErrnoCode(error, 'ENOENT')).toBe(true);
  });

  it('rejects when code does not match', () => {
    const error: unknown = { code: 'EACCES', message: 'permission denied' };
    expect(hasErrnoCode(error, 'ENOENT')).toBe(false);
  });

  it('rejects non-object values', () => {
    expect(hasErrnoCode('ENOENT', 'ENOENT')).toBe(false);
    expect(hasErrnoCode(42, 'ENOENT')).toBe(false);
    expect(hasErrnoCode(null, 'ENOENT')).toBe(false);
    expect(hasErrnoCode(undefined, 'ENOENT')).toBe(false);
  });

  it('rejects objects whose code is not a string (e.g. number)', () => {
    const error: unknown = { code: 2, message: 'no such file' };
    // A numeric code must NOT match even if the number coerces to a
    // different string — type-safety requires typeof string.
    expect(hasErrnoCode(error, '2')).toBe(false);
  });

  it('rejects objects without a code property', () => {
    const error: unknown = { message: 'something went wrong' };
    expect(hasErrnoCode(error, 'ENOENT')).toBe(false);
  });
});

describe('profileStore — readProfileFileSync discriminated result', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  it('returns absent for a missing file', () => {
    const result = readProfileFileSync(path.join(tempDir, 'missing.json'));
    expect(result.kind).toBe('absent');
  });

  it('returns content for an existing file', () => {
    const filePath = path.join(tempDir, 'exists.json');
    fs.writeFileSync(filePath, '{"a":1}', 'utf-8');
    const result = readProfileFileSync(filePath);
    expect(result.kind).toBe('content');
    expect(result.kind === 'content' ? result.content : null).toBe('{"a":1}');
  });

  it('returns error when the path is a directory', () => {
    const result = readProfileFileSync(tempDir);
    expect(result.kind).toBe('error');
    expect(result.kind === 'error' ? result.error : null).toBeInstanceOf(Error);
  });
});

describe('profileStore — async lock acquisition', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  it('acquires and releases the lock', async () => {
    const lock = await acquireProfilesLock(tempDir);
    expect(fs.existsSync(lock.path)).toBe(true);
    await lock.release();
    expect(fs.existsSync(lock.path)).toBe(false);
  });

  it('can re-acquire after release', async () => {
    const lock1 = await acquireProfilesLock(tempDir);
    await lock1.release();
    const lock2 = await acquireProfilesLock(tempDir);
    expect(fs.existsSync(lock2.path)).toBe(true);
    await lock2.release();
  });

  it('blocks a second concurrent async acquisition in-process', async () => {
    const lock1 = await acquireProfilesLock(tempDir);
    let secondAcquired = false;
    const acquisition = acquireProfilesLock(tempDir).then((lock) => {
      secondAcquired = true;
      return lock;
    });

    // Give the second acquisition a chance to fail/wait.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(secondAcquired).toBe(false);

    await lock1.release();
    const lock2 = await acquisition;
    expect(fs.existsSync(lock2.path)).toBe(true);
    await lock2.release();
  });

  it('writes owner metadata (pid, token) into the lock file', async () => {
    const lock = await acquireProfilesLock(tempDir);
    const content = fs.readFileSync(lock.path, 'utf-8');
    const meta = JSON.parse(content);
    expect(meta.pid).toBe(process.pid);
    expect(typeof meta.token).toBe('string');
    expect(meta.token).toBe(lock.ownerToken);
    await lock.release();
  });

  it('release refuses to unlink if the token on disk does not match (#3)', async () => {
    const lock = await acquireProfilesLock(tempDir);
    // Overwrite the lock file with a different token to simulate another
    // process (or manual recovery + re-acquire) owning it.
    const otherMeta = JSON.stringify({
      pid: 88888,
      token: 'other-process-token',
      created: new Date().toISOString(),
    });
    fs.writeFileSync(lock.path, otherMeta, { mode: 0o600 });

    // Release must fail and must NOT remove another owner's file.
    await expect(lock.release()).rejects.toThrow('ownership changed');
    expect(fs.existsSync(lock.path)).toBe(true);

    // Manual cleanup for teardown.
    fs.unlinkSync(lock.path);
  });

  it('sync release refuses to unlink if the token on disk does not match (#3)', () => {
    const lock = acquireProfilesLockSync(tempDir);
    // Overwrite with a different token.
    const otherMeta = JSON.stringify({
      pid: 77777,
      token: 'other-sync-token',
      created: new Date().toISOString(),
    });
    fs.writeFileSync(lock.path, otherMeta, { mode: 0o600 });

    expect(() => lock.release()).toThrow('ownership changed');
    expect(fs.existsSync(lock.path)).toBe(true);

    // Manual cleanup for teardown.
    fs.unlinkSync(lock.path);
  });
});

describe('profileStore — sync lock acquisition', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  it('acquires and releases the lock synchronously', () => {
    const lock = acquireProfilesLockSync(tempDir);
    expect(fs.existsSync(lock.path)).toBe(true);
    lock.release();
    expect(fs.existsSync(lock.path)).toBe(false);
  });

  it('throws LockBusyError when the lock is already held (sync after sync)', () => {
    const lock = acquireProfilesLockSync(tempDir);
    let caught: unknown = undefined;
    try {
      acquireProfilesLockSync(tempDir);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LockBusyError);
    expect(caught instanceof LockBusyError).toBe(true);
    const lbe = caught instanceof LockBusyError ? caught : null;
    expect(lbe).not.toBeNull();
    expect(lbe?.lockPath).toBe(lockPathForProfilesDir(tempDir));
    expect(lbe?.ownerMetadata).not.toBeNull();
    lock.release();
  });

  it('throws LockBusyError when sync acquisition is attempted while async holds', async () => {
    const asyncLock = await acquireProfilesLock(tempDir);
    let caught: unknown = undefined;
    try {
      acquireProfilesLockSync(tempDir);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LockBusyError);
    await asyncLock.release();
  });
});

// ─── NO stale takeover (safety over availability) ───────────────────────────

describe('profileStore — no automatic stale takeover', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  it('leftover lock file (simulating SIGKILL) is NOT auto-reclaimed by sync', () => {
    const lockPath = lockPathForProfilesDir(tempDir);
    // Simulate a crashed prior process: write a stale lock file.
    const staleMeta = JSON.stringify({
      pid: 99999,
      token: 'stale-token',
      created: new Date(Date.now() - 60000).toISOString(),
    });
    fs.writeFileSync(lockPath, staleMeta, { mode: 0o600 });

    let caught: unknown = undefined;
    try {
      acquireProfilesLockSync(tempDir);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LockBusyError);
    expect(caught instanceof LockBusyError).toBe(true);
    const lbe = caught instanceof LockBusyError ? caught : null;
    expect(lbe).not.toBeNull();
    // Error surfaces exact path and owner metadata for manual recovery.
    expect(lbe?.lockPath).toBe(lockPath);
    expect(lbe?.ownerMetadata).toContain('stale-token');
    expect(lbe?.message).toContain(lockPath);

    // Lock file still on disk — NOT removed.
    expect(fs.existsSync(lockPath)).toBe(true);

    // Manual recovery: remove the file, then acquisition works.
    fs.unlinkSync(lockPath);
    const lock = acquireProfilesLockSync(tempDir);
    expect(fs.existsSync(lock.path)).toBe(true);
    lock.release();
  });

  it('leftover lock file is NOT auto-reclaimed by async (waits then throws) — injectable deadline (#1)', async () => {
    const lockPath = lockPathForProfilesDir(tempDir);
    const staleMeta = JSON.stringify({
      pid: 99999,
      token: 'stale-token-2',
      created: new Date(Date.now() - 60000).toISOString(),
    });
    fs.writeFileSync(lockPath, staleMeta, { mode: 0o600 });

    let caught: unknown = undefined;
    try {
      // Injectable deadline: use 100ms so the test is deterministic without
      // waiting the production 10s default (#1).
      await acquireProfilesLock(tempDir, 100);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LockBusyError);
    // Lock file still on disk — NOT removed.
    expect(fs.existsSync(lockPath)).toBe(true);
  });
});

describe('profileStore — atomicWriteFile (async)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  it('writes content atomically with mode', async () => {
    const filePath = path.join(tempDir, 'profile.json');
    await atomicWriteFile(filePath, '{"provider":"async"}', 0o600);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('{"provider":"async"}');
  });

  it('writes content atomically without mode', async () => {
    const filePath = path.join(tempDir, 'profile.json');
    await atomicWriteFile(filePath, '{"provider":"nomode"}');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('{"provider":"nomode"}');
  });

  it('does not leave temp files behind', async () => {
    const filePath = path.join(tempDir, 'profile.json');
    await atomicWriteFile(filePath, '{"provider":"x"}');
    const temps = fs.readdirSync(tempDir).filter((f) => f.endsWith('.tmp'));
    expect(temps).toStrictEqual([]);
  });
});

describe('profileStore — writeProfileFile create mode', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  it('writes a new profile under the lock in create mode', async () => {
    const result = await writeProfileFile(
      tempDir,
      'myprof',
      '{"provider":"y"}',
      'create',
    );
    expect(result.kind).toBe('written');
    expect(fs.readFileSync(path.join(tempDir, 'myprof.json'), 'utf-8')).toBe(
      '{"provider":"y"}',
    );
  });

  it('returns exists when create collides with an existing file', async () => {
    const existing = '{"provider":"old"}';
    await writeProfileFile(tempDir, 'myprof', existing, 'create');
    const result = await writeProfileFile(
      tempDir,
      'myprof',
      '{"provider":"new"}',
      'create',
    );
    expect(result.kind).toBe('exists');
    // Original content preserved.
    expect(fs.readFileSync(path.join(tempDir, 'myprof.json'), 'utf-8')).toBe(
      existing,
    );
  });

  it('applies 0600 mode to new files', async () => {
    await writeProfileFile(tempDir, 'secure', '{"a":1}', 'create');
    const stat = fs.statSync(path.join(tempDir, 'secure.json'));
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('creates a new profiles directory with owner-only permissions', async () => {
    const profilesDir = path.join(tempDir, 'profiles');
    await writeProfileFile(profilesDir, 'secure', '{"a":1}', 'create');
    expect(fs.statSync(profilesDir).mode & 0o777).toBe(0o700);
  });

  it.each([
    '',
    '   ',
    '.',
    '..',
    '../outside',
    'nested/profile',
    'nested\\profile',
  ])(
    'rejects unsafe profile name %j without writing outside the directory',
    async (profileName) => {
      await expect(
        writeProfileFile(tempDir, profileName, '{}', 'create'),
      ).rejects.toThrow('Invalid profile name');
      expect(fs.existsSync(path.join(tempDir, '..', 'outside.json'))).toBe(
        false,
      );
    },
  );

  it('releases the lock after writing', async () => {
    await writeProfileFile(tempDir, 'myprof', '{"provider":"y"}', 'create');
    expect(fs.existsSync(lockPathForProfilesDir(tempDir))).toBe(false);
  });
});

describe('profileStore — writeProfileFile overwrite mode', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  it('overwrites an existing profile', async () => {
    await writeProfileFile(tempDir, 'myprof', '{"provider":"old"}', 'create');
    const result = await writeProfileFile(
      tempDir,
      'myprof',
      '{"provider":"new"}',
      'overwrite',
    );
    expect(result.kind).toBe('written');
    expect(fs.readFileSync(path.join(tempDir, 'myprof.json'), 'utf-8')).toBe(
      '{"provider":"new"}',
    );
  });

  it('defaults to overwrite mode', async () => {
    await writeProfileFile(tempDir, 'myprof', '{"v":1}', 'create');
    await writeProfileFile(tempDir, 'myprof', '{"v":2}');
    expect(fs.readFileSync(path.join(tempDir, 'myprof.json'), 'utf-8')).toBe(
      '{"v":2}',
    );
  });

  it('releases the lock after overwriting', async () => {
    await writeProfileFile(tempDir, 'myprof', '{"provider":"y"}', 'overwrite');
    expect(fs.existsSync(lockPathForProfilesDir(tempDir))).toBe(false);
  });
});

describe('profileStore — deleteProfileFile', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  it('deletes a profile under the lock', async () => {
    const filePath = path.join(tempDir, 'myprof.json');
    fs.writeFileSync(filePath, '{}', 'utf-8');
    await deleteProfileFile(tempDir, 'myprof');
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('releases the lock after deleting', async () => {
    const filePath = path.join(tempDir, 'myprof.json');
    fs.writeFileSync(filePath, '{}', 'utf-8');
    await deleteProfileFile(tempDir, 'myprof');
    expect(fs.existsSync(lockPathForProfilesDir(tempDir))).toBe(false);
  });

  it('rejects traversal without deleting outside the profiles directory', async () => {
    const outsidePath = path.join(tempDir, '..', 'outside.json');
    fs.writeFileSync(outsidePath, '{}', 'utf-8');
    try {
      await expect(deleteProfileFile(tempDir, '../outside')).rejects.toThrow(
        'Invalid profile name',
      );
      expect(fs.existsSync(outsidePath)).toBe(true);
    } finally {
      await fsp.rm(outsidePath, { force: true });
    }
  });
});

// ─── Dual failure normalization (toError) ──────────────────────────────────

/**
 * Assert that the caught value is an AggregateError and return it narrowed.
 * Lives outside test bodies so it does not trigger no-conditional-in-test.
 */
function asAggregateError(caught: unknown): AggregateError {
  if (!(caught instanceof AggregateError)) {
    throw new Error(`expected AggregateError, got ${typeof caught}`);
  }
  return caught;
}

describe('profileStore — dual failure normalization (#5)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  it('aggregates Error throws from both operation and release as Error elements', () => {
    // Overwrite the lock file with a different token after acquisition so
    // release() throws — combined with the operation throwing, this
    // exercises the dual-failure AggregateError path.
    const lockPath = lockPathForProfilesDir(tempDir);
    let caught: unknown;
    try {
      withProfilesLockSync(tempDir, () => {
        // Simulate a different owner on disk before release.
        fs.writeFileSync(
          lockPath,
          JSON.stringify({
            pid: 1,
            token: 'other',
            created: new Date().toISOString(),
          }),
          { mode: 0o600 },
        );
        throw new Error('operation failed');
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    const aggregate = asAggregateError(caught);
    // Both elements must be Error instances (not raw throws).
    expect(aggregate.errors).toHaveLength(2);
    for (const el of aggregate.errors) {
      expect(el).toBeInstanceOf(Error);
    }
    // The original operation error message is preserved exactly.
    expect(aggregate.errors[0]?.message).toBe('operation failed');
    // The release error message is preserved exactly.
    expect(aggregate.errors[1]?.message).toContain('ownership changed');
  });

  it('normalizes a string throw into an Error inside the aggregate (no crash)', () => {
    const lockPath = lockPathForProfilesDir(tempDir);
    // Assign to a variable so the throw is not a literal (lint), and to
    // exercise the non-Error normalization path.
    const stringError: unknown = 'string error';
    let caught: unknown;
    try {
      withProfilesLockSync(tempDir, () => {
        fs.writeFileSync(
          lockPath,
          JSON.stringify({
            pid: 1,
            token: 'other',
            created: new Date().toISOString(),
          }),
          { mode: 0o600 },
        );
        throw stringError;
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    const aggregate = asAggregateError(caught);
    // Every element must be an Error — the string must have been normalized.
    for (const el of aggregate.errors) {
      expect(el).toBeInstanceOf(Error);
    }
    // The string throw is normalized to an Error with that exact message.
    expect(aggregate.errors[0]).toBeInstanceOf(Error);
    expect(aggregate.errors[0].message).toBe('string error');
  });

  it('does not crash when a thrown value has a hostile toString (dual failure)', () => {
    const lockPath = lockPathForProfilesDir(tempDir);
    const hostile: unknown = {
      toString() {
        throw new Error('hostile toString');
      },
    };
    let caught: unknown;
    try {
      withProfilesLockSync(tempDir, () => {
        fs.writeFileSync(
          lockPath,
          JSON.stringify({
            pid: 1,
            token: 'other',
            created: new Date().toISOString(),
          }),
          { mode: 0o600 },
        );
        throw hostile;
      });
    } catch (error) {
      caught = error;
    }

    // The hostile toString must not crash the normalization — an
    // AggregateError with Error elements is still produced.
    expect(caught).toBeInstanceOf(AggregateError);
    const aggregate = asAggregateError(caught);
    for (const el of aggregate.errors) {
      expect(el).toBeInstanceOf(Error);
    }
    // The hostile object is normalized to the hostile-fallback sentinel,
    // not the result of its throwing toString.
    expect(aggregate.errors[0]).toBeInstanceOf(Error);
    expect(aggregate.errors[0].message).toBe('(unrepresentable value)');
  });
});

// ─── Async dual failure normalization (toError) ────────────────────────────

describe('profileStore — async dual failure normalization (#5 async)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  it('async: aggregates Error throws from both operation and release', async () => {
    const lockPath = lockPathForProfilesDir(tempDir);
    let caught: unknown;
    try {
      await withProfilesLock(tempDir, async () => {
        fs.writeFileSync(
          lockPath,
          JSON.stringify({
            pid: 1,
            token: 'other',
            created: new Date().toISOString(),
          }),
          { mode: 0o600 },
        );
        throw new Error('async operation failed');
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    const aggregate = asAggregateError(caught);
    expect(aggregate.errors).toHaveLength(2);
    for (const el of aggregate.errors) {
      expect(el).toBeInstanceOf(Error);
    }
    expect(aggregate.errors[0]?.message).toBe('async operation failed');
    expect(aggregate.errors[1]?.message).toContain('ownership changed');
  });

  it('async: normalizes a non-Error throw into an Error in the aggregate', async () => {
    const lockPath = lockPathForProfilesDir(tempDir);
    const stringError: unknown = 'async string error';
    let caught: unknown;
    try {
      await withProfilesLock(tempDir, async () => {
        fs.writeFileSync(
          lockPath,
          JSON.stringify({
            pid: 1,
            token: 'other',
            created: new Date().toISOString(),
          }),
          { mode: 0o600 },
        );
        throw stringError;
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    const aggregate = asAggregateError(caught);
    for (const el of aggregate.errors) {
      expect(el).toBeInstanceOf(Error);
    }
    expect(aggregate.errors[0]).toBeInstanceOf(Error);
    expect(aggregate.errors[0].message).toBe('async string error');
  });

  it('async: does not crash when thrown value has hostile toString', async () => {
    const lockPath = lockPathForProfilesDir(tempDir);
    const hostile: unknown = {
      toString() {
        throw new Error('hostile toString');
      },
    };
    let caught: unknown;
    try {
      await withProfilesLock(tempDir, async () => {
        fs.writeFileSync(
          lockPath,
          JSON.stringify({
            pid: 1,
            token: 'other',
            created: new Date().toISOString(),
          }),
          { mode: 0o600 },
        );
        throw hostile;
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    const aggregate = asAggregateError(caught);
    for (const el of aggregate.errors) {
      expect(el).toBeInstanceOf(Error);
    }
    expect(aggregate.errors[0]).toBeInstanceOf(Error);
    expect(aggregate.errors[0].message).toBe('(unrepresentable value)');
  });
});
