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
import * as childProcess from 'node:child_process';
import {
  acquireProfilesLock,
  acquireProfilesLockSync,
  lockPathForProfilesDir,
  readProfileFileSync,
  atomicWriteFile,
  writeProfileFile,
  deleteProfileFile,
  LockBusyError,
} from '../profileStore.js';
import { ProfileManager } from '../ProfileManager.js';

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

// ─── Real cross-process lock contention (deterministic) ─────────────────────

describe('profileStore — real cross-process lock contention', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  it('child process cannot acquire the lock while parent holds it', async () => {
    const lock = await acquireProfilesLock(tempDir);

    const childResult = await runChildLockAttempt(tempDir);
    // Child should fail with EEXIST (non-zero exit).
    expect(childResult.exitCode).not.toBe(0);
    expect(childResult.stderr).toContain('EEXIST');

    await lock.release();
  });

  it('child process acquires the lock after parent releases it', async () => {
    const lock = await acquireProfilesLock(tempDir);
    await lock.release();

    const childResult = await runChildLockAttempt(tempDir);
    expect(childResult.exitCode).toBe(0);
  });
});

// ─── Deterministic process test: READY/RELEASE protocol ─────────────────────
// Replaces fixed sleep/elapsed assertions with explicit synchronization.

describe('profileStore — deterministic cross-process serialization', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  it('ProfileManager save waits for child-process lock to release (READY/RELEASE)', async () => {
    const profilesDir = tempDir;
    const profilePath = path.join(profilesDir, 'concurrent-test.json');

    // Spawn a child that acquires the lock, emits READY, waits for RELEASE,
    // then releases and exits. Uses stdin/stdout for synchronization.
    const child = childProcess.spawn(
      process.execPath,
      ['-e', buildReadyReleaseChildScript(profilesDir)],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );

    // Set up exit listener early so we don't miss the event.
    const exitPromise = waitForExit(child, 10000);

    // Wait for child to signal READY (lock acquired).
    await waitForStdout(child, 'READY', 5000);

    // Verify the lock file exists while child holds it.
    expect(fs.existsSync(lockPathForProfilesDir(profilesDir))).toBe(true);

    // Verify the profile does NOT exist yet.
    expect(fs.existsSync(profilePath)).toBe(false);

    // Start a real ProfileManager write — it should block waiting for the lock.
    const pm = new ProfileManager(profilesDir);
    const writePromise = pm.saveProfile('concurrent-test', {
      version: 1,
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: {},
    });

    // Give the write a moment to start waiting.
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Profile should still NOT exist (write is blocked).
    expect(fs.existsSync(profilePath)).toBe(false);

    // Signal child to RELEASE the lock.
    child.stdin.write('RELEASE\n');

    // Wait for the write to complete.
    await writePromise;

    // Now the profile exists with the correct content.
    expect(fs.existsSync(profilePath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
    expect(content.provider).toBe('openai');

    // Lock released after ProfileManager save.
    expect(fs.existsSync(lockPathForProfilesDir(profilesDir))).toBe(false);

    // Child exited cleanly.
    const exitCode = await exitPromise;
    expect(exitCode).toBe(0);
  });

  it('repair-vs-writer: sync lock holder blocks async writer, then releases', async () => {
    const profilesDir = tempDir;
    const profilePath = path.join(profilesDir, 'repair-test.json');

    // Child holds the sync lock using READY/RELEASE protocol.
    const child = childProcess.spawn(
      process.execPath,
      ['-e', buildReadyReleaseChildScript(profilesDir)],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );

    const exitPromise = waitForExit(child, 10000);
    await waitForStdout(child, 'READY', 5000);

    // While child holds lock, a ProfileManager write must be blocked.
    const pm = new ProfileManager(profilesDir);
    const writePromise = pm.saveProfile('repair-test', {
      version: 1,
      provider: 'anthropic',
      model: 'glm-5.2',
      modelParams: {},
      ephemeralSettings: {},
    });

    // Not done yet.
    let writeDone = false;
    void writePromise.then(() => {
      writeDone = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(writeDone).toBe(false);

    // Release child lock.
    child.stdin.write('RELEASE\n');
    await writePromise;
    await exitPromise;

    // Final bytes are correct.
    const content = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
    expect(content.provider).toBe('anthropic');
    expect(content.model).toBe('glm-5.2');
  });
});

// ─── Helpers for child-process contention tests ─────────────────────────────

interface ChildResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run a child process that attempts to acquire the sync lock on tempDir and
 * exits immediately. Returns non-zero if the lock was held (LockBusyError).
 */
async function runChildLockAttempt(tempDir: string): Promise<ChildResult> {
  const lockPath = lockPathForProfilesDir(tempDir);
  const script = `
    const fs = require('node:fs');
    const path = require('node:path');
    const lockPath = ${JSON.stringify(lockPath)};
    try {
      fs.openSync(lockPath, 'wx', 0o600);
      fs.unlinkSync(lockPath);
      process.exit(0);
    } catch (e) {
      process.stderr.write(e.message + ' ' + (e.code || ''));
      process.exit(1);
    }
  `;
  return runChildScript(script);
}

/**
 * Build a child-process script that uses the READY/RELEASE synchronization
 * protocol. The child:
 * 1. Acquires the lock via O_EXCL (open wx).
 * 2. Writes READY to stdout.
 * 3. Waits for RELEASE on stdin (line-based).
 * 4. Removes the lock file and exits 0.
 */
function buildReadyReleaseChildScript(profilesDir: string): string {
  const lockPath = lockPathForProfilesDir(profilesDir);
  return `
    const fs = require('node:fs');
    const readline = require('node:readline');
    const lockPath = ${JSON.stringify(lockPath)};
    let fd;
    try {
      fd = fs.openSync(lockPath, 'wx', 0o600);
      const meta = JSON.stringify({ pid: process.pid, token: 'child-' + process.pid, created: new Date().toISOString() });
      fs.writeSync(fd, meta);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
    } catch (e) {
      process.stderr.write('LockBusyError: ' + e.message + '\\n');
      process.exit(1);
    }
    process.stdout.write('READY\\n');
    const rl = readline.createInterface({ input: process.stdin });
    rl.on('line', (line) => {
      if (line.trim() === 'RELEASE') {
        try { fs.unlinkSync(lockPath); } catch {}
        process.exit(0);
      }
    });
  `;
}

function waitForStdout(
  child: childProcess.ChildProcess,
  expected: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for stdout "${expected}"`));
    }, timeoutMs);

    child.stdout?.on('data', (data: Buffer) => {
      if (data.toString().includes(expected)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(`Child exited with code ${code} before "${expected}"`),
        );
      }
    });
  });
}

function waitForExit(
  child: childProcess.ChildProcess,
  timeoutMs: number,
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timeout waiting for child exit'));
    }, timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function runChildScript(script: string): Promise<ChildResult> {
  return new Promise((resolve) => {
    const child = childProcess.execFile(
      process.execPath,
      ['-e', script],
      {
        cwd: process.cwd(),
        timeout: 10000,
      },
      (error, stdout, stderr) => {
        let exitCode = 0;
        if (error !== null) {
          exitCode = typeof error.code === 'number' ? error.code : 1;
        }
        resolve({
          exitCode,
          stdout,
          stderr,
        });
      },
    );
    void child;
  });
}
