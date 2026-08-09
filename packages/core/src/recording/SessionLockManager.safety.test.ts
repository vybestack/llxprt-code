/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Adversarial safety tests for the hardened SessionLockManager (Items 2 & 3).
 *
 * Tests prove:
 * - Unsafe/path-like session IDs are rejected by getLockPath.
 * - Lock paths are always direct children of chatsDir.
 * - Lock files carry random owner tokens and are published atomically.
 * - Unreadable/recent lock files are treated as busy, not instantly stale.
 * - Lock filename/payload identity is validated.
 * - Stale takeover does not remove a replacement live lock.
 * - Release unlinks only its own current token.
 * - The transition guard serializes pathname mutations so a stale checker
 *   cannot unlink a replacement live lock (genuine subprocess race).
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import {
  SessionLockManager,
  SessionLockedError,
} from './SessionLockManager.js';

const DEAD_PID = 999999999;

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'lock-safety-'));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe('SessionLockManager — safe session ID grammar (Item 2)', () => {
  let tempDir: string;
  let chatsDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    chatsDir = path.join(tempDir, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('rejects path-traversal session IDs in getLockPath', () => {
    expect(() => SessionLockManager.getLockPath(chatsDir, '../evil')).toThrow(
      'Unsafe session ID',
    );
    expect(() =>
      SessionLockManager.getLockPath(chatsDir, '../../etc/passwd'),
    ).toThrow('Unsafe session ID');
  });

  it('rejects session IDs with path separators', () => {
    expect(() => SessionLockManager.getLockPath(chatsDir, 'a/b')).toThrow(
      'Unsafe session ID',
    );
    expect(() => SessionLockManager.getLockPath(chatsDir, 'a\\b')).toThrow(
      'Unsafe session ID',
    );
  });

  it('rejects session IDs with dots', () => {
    expect(() => SessionLockManager.getLockPath(chatsDir, 'a.b')).toThrow(
      'Unsafe session ID',
    );
    expect(() => SessionLockManager.getLockPath(chatsDir, '..')).toThrow(
      'Unsafe session ID',
    );
  });

  it('accepts valid UUID and alphanumeric session IDs', () => {
    expect(() =>
      SessionLockManager.getLockPath(
        chatsDir,
        '550e8400-e29b-41d4-a716-446655440000',
      ),
    ).not.toThrow();
    expect(() =>
      SessionLockManager.getLockPath(chatsDir, 'session-abc_123'),
    ).not.toThrow();
  });

  it('guarantees lock path is a direct child of chatsDir', () => {
    const lockPath = SessionLockManager.getLockPath(
      chatsDir,
      'valid-session-id',
    );
    expect(path.dirname(lockPath)).toBe(chatsDir);
    expect(path.basename(lockPath)).toBe('valid-session-id.lock');
  });

  it('accepts a chatsDir with a trailing path separator', () => {
    const chatsDirWithSep = chatsDir + path.sep;
    const lockPath = SessionLockManager.getLockPath(
      chatsDirWithSep,
      'trailing-sep-test',
    );
    expect(path.basename(lockPath)).toBe('trailing-sep-test.lock');
    expect(path.dirname(lockPath)).toBe(chatsDir);
  });

  it('refuses to acquire a lock with an unsafe session ID', async () => {
    // An unsafe/path-like session ID is a validation failure, distinct from a
    // busy session. The rejection must surface the "Unsafe session ID" reason.
    await expect(
      SessionLockManager.acquire(chatsDir, '../evil'),
    ).rejects.toThrow('Unsafe session ID');
    // No lock file should have been created outside the chats dir.
    expect(await fileExists(path.join(tempDir, 'evil.lock'))).toBe(false);
  });
});

describe('SessionLockManager — owner tokens and atomic publication (Item 3)', () => {
  let tempDir: string;
  let chatsDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    chatsDir = path.join(tempDir, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('writes a random ownerToken in the lock file', async () => {
    const handle = await SessionLockManager.acquire(chatsDir, 'token-test');
    const lockPath = SessionLockManager.getLockPath(chatsDir, 'token-test');
    const raw = await fs.readFile(lockPath, 'utf-8');
    const data = JSON.parse(raw);
    expect(typeof data.ownerToken).toBe('string');
    expect(data.ownerToken.length).toBeGreaterThan(0);
    await handle.release();
  });

  it('does not leave partial/temp lock artifacts after successful acquire', async () => {
    const handle = await SessionLockManager.acquire(chatsDir, 'artifact-test');
    // The only .lock file should be the real lock path.
    const entries = await fs.readdir(chatsDir);
    const lockFiles = entries.filter((f) => f.endsWith('.lock'));
    expect(lockFiles).toEqual(['artifact-test.lock']);
    // No .locktmp temp files should remain.
    const tempFiles = entries.filter((f) => f.endsWith('.locktmp'));
    expect(tempFiles).toEqual([]);
    await handle.release();
  });

  it('exposes ownsLock() that returns true while held', async () => {
    const handle = await SessionLockManager.acquire(chatsDir, 'owns-test');
    expect(await handle.ownsLock()).toBe(true);
    await handle.release();
    expect(await handle.ownsLock()).toBe(false);
  });
});

describe('SessionLockManager — unreadable/recent locks treated as busy (Item 3)', () => {
  let tempDir: string;
  let chatsDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    chatsDir = path.join(tempDir, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('checkStale returns false for a corrupt (unreadable) recent lock', async () => {
    const lockPath = SessionLockManager.getLockPath(chatsDir, 'corrupt-recent');
    await fs.writeFile(lockPath, 'this is garbage', 'utf-8');
    const stale = await SessionLockManager.checkStale(lockPath);
    expect(stale).toBe(false);
  });

  it('checkStaleWithPidReuse returns false for a corrupt recent lock', async () => {
    const lockPath = SessionLockManager.getLockPath(
      chatsDir,
      'corrupt-pidreuse-recent',
    );
    await fs.writeFile(lockPath, 'garbage!!!', 'utf-8');
    const stale = await SessionLockManager.checkStaleWithPidReuse(lockPath);
    expect(stale).toBe(false);
  });

  it('checkStaleWithPidReuse returns true for a corrupt lock older than 48h', async () => {
    const lockPath = SessionLockManager.getLockPath(
      chatsDir,
      'corrupt-pidreuse-old',
    );
    await fs.writeFile(lockPath, 'garbage!!!', 'utf-8');
    const oldTime = new Date(Date.now() - 49 * 60 * 60 * 1000);
    await fs.utimes(lockPath, oldTime, oldTime);
    const stale = await SessionLockManager.checkStaleWithPidReuse(lockPath);
    expect(stale).toBe(true);
  });

  it('refuses to acquire over a corrupt recent lock (busy, not stale)', async () => {
    const lockPath = SessionLockManager.getLockPath(chatsDir, 'corrupt-busy');
    await fs.writeFile(lockPath, 'garbage', 'utf-8');
    await expect(
      SessionLockManager.acquire(chatsDir, 'corrupt-busy'),
    ).rejects.toBeInstanceOf(SessionLockedError);
    // The corrupt lock should survive.
    expect(await fileExists(lockPath)).toBe(true);
  });
});

describe('SessionLockManager — owner-checked release (Item 3)', () => {
  let tempDir: string;
  let chatsDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    chatsDir = path.join(tempDir, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("release does not remove another owner's lock (token mismatch)", async () => {
    const handle = await SessionLockManager.acquire(
      chatsDir,
      'release-mismatch',
    );
    const lockPath = SessionLockManager.getLockPath(
      chatsDir,
      'release-mismatch',
    );

    // Simulate another process replacing the lock with a different token.
    await fs.writeFile(
      lockPath,
      JSON.stringify({
        pid: process.pid + 1,
        timestamp: new Date().toISOString(),
        sessionId: 'release-mismatch',
        ownerToken: 'different-owner-token-xyz',
      }),
      'utf-8',
    );

    // Release our handle — should NOT remove the replacement lock.
    await handle.release();
    expect(await fileExists(lockPath)).toBe(true);

    // Clean up manually.
    await fs.unlink(lockPath);
  });

  it('release removes the lock when we still own it', async () => {
    const handle = await SessionLockManager.acquire(chatsDir, 'release-own');
    const lockPath = SessionLockManager.getLockPath(chatsDir, 'release-own');
    await handle.release();
    expect(await fileExists(lockPath)).toBe(false);
  });
});

describe('SessionLockManager — stale takeover does not remove replacement live lock (Item 3)', () => {
  let tempDir: string;
  let chatsDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    chatsDir = path.join(tempDir, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('cleanupOrphanedLocks does not remove a live (non-stale) replacement lock', async () => {
    const sessionId = 'replacement-takeover';
    const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);

    // A live lock (alive PID, recent timestamp) is never stale.
    await fs.writeFile(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        timestamp: new Date().toISOString(),
        sessionId,
        ownerToken: 'live-replacement',
      }),
      'utf-8',
    );

    const removed = await SessionLockManager.cleanupOrphanedLocks(chatsDir);
    expect(removed).toBe(0);
    expect(await fileExists(lockPath)).toBe(true);

    // Clean up.
    await fs.unlink(lockPath);
  });

  it('removeStaleLock routes through the hardened re-read-and-compare path', async () => {
    // A genuinely stale lock (dead PID) is removed via the hardened path.
    const sessionId = 'remove-stale-route';
    const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
    await fs.writeFile(
      lockPath,
      JSON.stringify({
        pid: DEAD_PID,
        timestamp: new Date().toISOString(),
        sessionId,
        ownerToken: 'dead-route',
      }),
      'utf-8',
    );

    await SessionLockManager.removeStaleLock(chatsDir, sessionId);
    expect(await fileExists(lockPath)).toBe(false);
  });

  it('cleanupOrphanedLocks removes a genuinely stale lock (dead PID)', async () => {
    const sessionId = 'genuinely-stale';
    const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
    await fs.writeFile(
      lockPath,
      JSON.stringify({
        pid: DEAD_PID,
        timestamp: new Date().toISOString(),
        sessionId,
        ownerToken: 'dead-token',
      }),
      'utf-8',
    );

    const removed = await SessionLockManager.cleanupOrphanedLocks(chatsDir);
    expect(removed).toBe(1);
    expect(await fileExists(lockPath)).toBe(false);
  });

  it('cleanupOrphanedLocks validates lock filename identity', async () => {
    // Create one with an unsafe name (contains a dot) inside the dir.
    const unsafeName = 'a.b.lock';
    await fs.writeFile(
      path.join(chatsDir, unsafeName),
      JSON.stringify({ pid: DEAD_PID, timestamp: new Date().toISOString() }),
      'utf-8',
    );

    const removed = await SessionLockManager.cleanupOrphanedLocks(chatsDir);
    // The unsafe-named lock should NOT be removed (filename identity validation).
    expect(removed).toBe(0);
    expect(await fileExists(path.join(chatsDir, unsafeName))).toBe(true);
  });
});

/**
 * Helper: run a Bun subprocess script and return stdout, capturing stderr.
 *
 * Manages the child lifecycle explicitly so timeout, error, or rejection
 * always terminates only this exact child and awaits its exit — no orphaned
 * processes can survive a failed test.  Dynamic values are passed via
 * environment variables (env) to avoid interpolating untrusted strings into
 * JS literals.
 */
function runBunScript(
  code: string,
  env?: Record<string, string>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('bun', ['-e', code], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, 20000);

    const cleanup = () => {
      clearTimeout(timer);
    };

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));

    child.on('close', (code) => {
      cleanup();
      if (settled) return;
      settled = true;
      if (code === 0) resolve(stdout);
      else
        reject(
          new Error(`Process exited with code ${code}\nstderr: ${stderr}`),
        );
    });

    child.on('error', (err) => {
      cleanup();
      // Ensure the child is terminated on spawn failure (e.g. bun not found).
      try {
        child.kill('SIGTERM');
      } catch {
        // Already exited — ignore.
      }
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

/**
 * Run N identical subprocess scripts with an explicit readiness barrier so
 * all children start their lock-acquire work simultaneously, reducing race
 * flakiness from staggered process startup.
 *
 * Each child writes a unique ready file, then polls for a shared go file.
 * The parent waits for all ready files, creates the go file, then collects
 * results.
 */
async function runBunScriptsWithBarrier(
  script: string,
  baseEnv: Record<string, string>,
  count: number,
  barrierDir: string,
): Promise<string[]> {
  const goFile = path.join(barrierDir, 'barrier-go');
  const readyFiles = Array.from({ length: count }, (_, i) =>
    path.join(barrierDir, `barrier-ready-${i}`),
  );

  // Spawn all children — each will write its ready file and wait.
  const promises = readyFiles.map((readyFile) =>
    runBunScript(script, {
      ...baseEnv,
      TEST_READY_FILE: readyFile,
      TEST_GO_FILE: goFile,
    }),
  );

  // Wait for every child to signal readiness.
  for (const readyFile of readyFiles) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try {
        await fs.access(readyFile);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 5));
      }
    }
  }

  // Release the barrier — all children proceed simultaneously.
  await fs.writeFile(goFile, 'go');

  return Promise.all(promises);
}

describe('SessionLockManager — genuine transition race (subprocess, Item 3)', () => {
  let tempDir: string;
  let chatsDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    chatsDir = path.join(tempDir, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('exactly one of several competing stale-takeover subprocesses wins', async () => {
    const sessionId = 'race-takeover';
    const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);

    // Pre-create a genuinely stale lock (dead PID, old timestamp).
    const oldTime = new Date(Date.now() - 49 * 60 * 60 * 1000);
    await fs.writeFile(
      lockPath,
      JSON.stringify({
        pid: DEAD_PID,
        timestamp: oldTime.toISOString(),
        sessionId,
        ownerToken: 'stale-original',
      }),
    );
    await fs.utimes(lockPath, oldTime, oldTime);

    const script = `
      const { SessionLockManager } = require(${JSON.stringify(path.resolve(__dirname, 'SessionLockManager.js'))});
      const chatsDir = process.env.TEST_CHATS_DIR;
      const sessionId = process.env.TEST_SESSION_ID;
      const readyFile = process.env.TEST_READY_FILE;
      const goFile = process.env.TEST_GO_FILE;
      (async () => {
        require('fs').writeFileSync(readyFile, 'ready');
        while (!require('fs').existsSync(goFile)) {
          await new Promise(r => setTimeout(r, 5));
        }
        try {
          const handle = await SessionLockManager.acquire(chatsDir, sessionId);
          await new Promise(r => setTimeout(r, 300));
          await handle.release();
          process.stdout.write('WON');
        } catch (e) {
          process.stdout.write('SKIP');
        }
      })();
    `;

    const results = await runBunScriptsWithBarrier(
      script,
      { TEST_CHATS_DIR: chatsDir, TEST_SESSION_ID: sessionId },
      3,
      tempDir,
    );

    const winners = results.filter((r) => r === 'WON');
    expect(winners.length).toBe(1);
  }, 30000);

  it('transition guard prevents removal of a replacement lock during release', async () => {
    // Acquire a lock, then simulate a replacement and verify release does not
    // delete the replacement (guarded ownership check + transition guard).
    const sessionId = 'release-guard';
    const handle = await SessionLockManager.acquire(chatsDir, sessionId);
    const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);

    // Replace the lock content with a different owner (live PID).
    await fs.writeFile(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        timestamp: new Date().toISOString(),
        sessionId,
        ownerToken: 'replacement-owner',
      }),
      'utf-8',
    );

    // Release our handle — must NOT remove the replacement.
    await handle.release();

    const content = await fs.readFile(lockPath, 'utf-8');
    expect(JSON.parse(content).ownerToken).toBe('replacement-owner');

    await fs.unlink(lockPath);
  });

  /**
   * Deterministic real child-process contention test that would FAIL under
   * the old separate-owner stale-guard replacement sequence.
   *
   * Under the old code, `reclaimStaleGuard()` was check-stale-then-unlink:
   * two contenders could both classify the old guard as stale, one installs a
   * new live guard, and the other unlinks it — allowing a loser to remove the
   * winner's lock.  Under the hard-link claim, the guard IS the lock inode,
   * and {@link verifyTransitionClaim} catches any inode mismatch before
   * unlinking lockPath.
   *
   * Each child process acquires a stale lock, holds it briefly, then verifies
   * it STILL owns the lock (`ownsLock()`).  Under the old code, a loser could
   * unlink the winner's lock, causing `ownsLock()` to return false → the
   * winner reports 'LOST'.  Under the hard-link claim, no process ever
   * reports 'LOST'.
   */
  it('winner lock cannot be removed by concurrent stale-takeover contender (hard-link claim)', async () => {
    const sessionId = 'winner-survives';
    const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);

    // Pre-create a genuinely stale lock (dead PID, old timestamp).
    const oldTime = new Date(Date.now() - 49 * 60 * 60 * 1000);
    await fs.writeFile(
      lockPath,
      JSON.stringify({
        pid: DEAD_PID,
        timestamp: oldTime.toISOString(),
        sessionId,
        ownerToken: 'stale-original',
      }),
    );
    await fs.utimes(lockPath, oldTime, oldTime);

    const script = `
      const { SessionLockManager } = require(${JSON.stringify(path.resolve(__dirname, 'SessionLockManager.js'))});
      const chatsDir = process.env.TEST_CHATS_DIR;
      const sessionId = process.env.TEST_SESSION_ID;
      const readyFile = process.env.TEST_READY_FILE;
      const goFile = process.env.TEST_GO_FILE;
      (async () => {
        require('fs').writeFileSync(readyFile, 'ready');
        while (!require('fs').existsSync(goFile)) {
          await new Promise(r => setTimeout(r, 5));
        }
        try {
          const handle = await SessionLockManager.acquire(chatsDir, sessionId);
          // Hold the lock briefly so contenders see a LIVE lock.
          await new Promise(r => setTimeout(r, 500));
          // Verify we still own it before releasing.  Under the old
          // stale-guard race, a loser could have unlinked our lock.
          const owns = await handle.ownsLock();
          process.stdout.write(owns ? 'WON' : 'LOST');
          await handle.release();
        } catch (e) {
          process.stdout.write('SKIP');
        }
      })();
    `;

    const results = await runBunScriptsWithBarrier(
      script,
      { TEST_CHATS_DIR: chatsDir, TEST_SESSION_ID: sessionId },
      3,
      tempDir,
    );

    const winners = results.filter((r) => r === 'WON');
    const lost = results.filter((r) => r === 'LOST');
    expect(winners.length).toBe(1);
    // No process should report LOST — the winner's lock is never removed.
    expect(lost.length).toBe(0);

    // All temp/transition artifacts should have converged — no leftovers.
    const entries = await fs.readdir(chatsDir);
    const guardFiles = entries.filter((f) => f.endsWith('.tguard'));
    const tmpFiles = entries.filter((f) => f.endsWith('.locktmp'));
    expect(guardFiles).toEqual([]);
    expect(tmpFiles).toEqual([]);
  }, 30000);
});
