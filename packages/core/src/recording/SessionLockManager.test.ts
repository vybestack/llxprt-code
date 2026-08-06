/**
 * Copyright 2025 Vybestack LLC
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
 * @plan PLAN-20260211-SESSIONRECORDING.P10
 * @requirement REQ-CON-001, REQ-CON-002, REQ-CON-003, REQ-CON-004, REQ-CON-005
 *
 * Behavioral tests for SessionLockManager. Tests verify actual file system
 * state (lock files exist/don't exist) using real temp directories — no mock
 * theater.
 *
 * All tests are example-based; this file has no property-based coverage.
 * All tests expect real behavior from the lock manager. They will fail against
 * the Phase 09 stub — that is correct TDD.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import * as path from 'path';
import * as os from 'os';
import {
  SessionLockManager,
  SessionLockedError,
} from './SessionLockManager.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: vi.fn(actual.writeFile),
  };
});

const fs = await import('node:fs/promises');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Dead PID that is almost certainly not running. */
const DEAD_PID = 999999999;

/**
 * Write a fake lock file with the given PID and optional timestamp.
 */
async function writeFakeLock(
  lockPath: string,
  pid: number,
  sessionId = 'fake-session',
  timestamp?: string,
): Promise<void> {
  const content = JSON.stringify({
    pid,
    timestamp: timestamp ?? new Date().toISOString(),
    sessionId,
  });
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(lockPath, content, 'utf-8');
}

/**
 * Check whether a file exists on disk.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify an ISO-8601 timestamp string is valid.
 */
function isValidIso8601(ts: string): boolean {
  const date = new Date(ts);
  return !isNaN(date.getTime()) && ts === date.toISOString();
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('SessionLockManager @plan:PLAN-20260211-SESSIONRECORDING.P10', () => {
  let tempDir: string;
  let chatsDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lock-mgr-test-'));
    chatsDir = path.join(tempDir, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
  });

  afterEach(async () => {
    const actualFs =
      await vi.importActual<typeof import('node:fs/promises')>(
        'node:fs/promises',
      );
    vi.mocked(fs.writeFile).mockReset();
    vi.mocked(fs.writeFile).mockImplementation(actualFs.writeFile);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Lock Path Convention
  // -------------------------------------------------------------------------

  describe('Lock path convention @requirement:REQ-CON-001 @plan:PLAN-20260211-SESSIONRECORDING.P10', () => {
    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-001
     * Test 3: getLockPath returns path + '.lock'
     */
    it('getLockPath returns <chatsDir>/<sessionId>.lock', () => {
      const result = SessionLockManager.getLockPath(
        '/tmp/chats',
        'session-abc123',
      );
      expect(result).toBe(path.join('/tmp/chats', 'session-abc123.lock'));
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-001
     * Test 29: getLockPathForSession uses session-ID-based path
     */
    it('getLockPath uses session-ID-based path independent of JSONL', () => {
      const result = SessionLockManager.getLockPath(chatsDir, 'abc123');
      expect(result).toBe(path.join(chatsDir, 'abc123.lock'));
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-001
     * getLockPathFromFilePath extracts sessionId correctly
     */
    it('getLockPathFromFilePath derives lock path from JSONL file path', () => {
      const jsonlPath = path.join(chatsDir, 'session-myid.jsonl');
      const result = SessionLockManager.getLockPathFromFilePath(jsonlPath);
      expect(result).toBe(path.join(chatsDir, 'myid.lock'));
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-001
     * getLockPathFromFilePath rejects invalid file names
     */
    it('getLockPathFromFilePath throws for non-session file path', () => {
      expect(() =>
        SessionLockManager.getLockPathFromFilePath('/tmp/random.txt'),
      ).toThrow('Cannot extract session ID from path');
    });
  });

  // -------------------------------------------------------------------------
  // Lock Acquisition
  // -------------------------------------------------------------------------

  describe('Lock acquisition @requirement:REQ-CON-001,REQ-CON-002 @plan:PLAN-20260211-SESSIONRECORDING.P10', () => {
    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-001, REQ-CON-002
     * Test 1: acquire creates .lock file
     */
    it('acquire creates a .lock file on disk', async () => {
      const sessionId = 'test-session-001';
      const handle = await SessionLockManager.acquire(chatsDir, sessionId);

      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
      const exists = await fileExists(lockPath);
      expect(exists).toBe(true);

      await handle.release();
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-001
     * Test 2: Lock file contains PID and timestamp
     */
    it('lock file contains JSON with pid and timestamp', async () => {
      const sessionId = 'test-session-002';
      const handle = await SessionLockManager.acquire(chatsDir, sessionId);

      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
      const raw = await fs.readFile(lockPath, 'utf-8');
      const data = JSON.parse(raw);

      expect(data.pid).toBe(process.pid);
      expect(isValidIso8601(data.timestamp)).toBe(true);

      await handle.release();
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-001
     * Test 28: Lock file contains sessionId field
     */
    it('lock file contains sessionId field matching the requested session', async () => {
      const sessionId = 'test-session-028';
      const handle = await SessionLockManager.acquire(chatsDir, sessionId);

      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
      const raw = await fs.readFile(lockPath, 'utf-8');
      const data = JSON.parse(raw);

      expect(data.sessionId).toBe(sessionId);

      await handle.release();
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-002, REQ-REC-004
     * Test 27: acquireForSession creates lock before JSONL file exists
     */
    it('acquire creates lock before JSONL file exists (deferred materialization)', async () => {
      const sessionId = 'test-session-027';
      const handle = await SessionLockManager.acquire(chatsDir, sessionId);

      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
      const jsonlPath = path.join(chatsDir, `session-${sessionId}.jsonl`);

      expect(await fileExists(lockPath)).toBe(true);
      expect(await fileExists(jsonlPath)).toBe(false);

      await handle.release();
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-002
     * Test 7: Lock with non-existent directory creates parent
     */
    it('acquire creates parent directory if it does not exist', async () => {
      const nestedDir = path.join(tempDir, 'deep', 'nested', 'chats');
      const sessionId = 'test-session-007';

      const handle = await SessionLockManager.acquire(nestedDir, sessionId);

      const lockPath = SessionLockManager.getLockPath(nestedDir, sessionId);
      expect(await fileExists(lockPath)).toBe(true);

      await handle.release();
    });
  });

  // -------------------------------------------------------------------------
  // Lock Release
  // -------------------------------------------------------------------------

  describe('Lock release @requirement:REQ-CON-003 @plan:PLAN-20260211-SESSIONRECORDING.P10', () => {
    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-003
     * Test 4: release deletes lock file
     */
    it('release deletes the lock file from disk', async () => {
      const sessionId = 'test-session-004';
      const handle = await SessionLockManager.acquire(chatsDir, sessionId);
      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);

      expect(await fileExists(lockPath)).toBe(true);

      await handle.release();

      expect(await fileExists(lockPath)).toBe(false);
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-003
     * Test 5: Double release is safe (idempotent)
     */
    it('double release is safe and idempotent', async () => {
      const sessionId = 'test-session-005';
      const handle = await SessionLockManager.acquire(chatsDir, sessionId);

      await handle.release();
      // Second release should not throw
      await handle.release();

      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
      expect(await fileExists(lockPath)).toBe(false);
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-003
     * Test 10: LockHandle.release() followed by acquire succeeds
     */
    it('release allows subsequent acquire on same session', async () => {
      const sessionId = 'test-session-010';
      const handle1 = await SessionLockManager.acquire(chatsDir, sessionId);
      await handle1.release();

      const handle2 = await SessionLockManager.acquire(chatsDir, sessionId);
      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
      expect(await fileExists(lockPath)).toBe(true);

      await handle2.release();
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-003
     * Test 30: Lock transition: pre-materialization to released (no JSONL)
     */
    it('acquire and release with no JSONL created leaves clean state', async () => {
      const sessionId = 'test-session-030';
      const handle = await SessionLockManager.acquire(chatsDir, sessionId);
      await handle.release();

      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
      const jsonlPath = path.join(chatsDir, `session-${sessionId}.jsonl`);

      expect(await fileExists(lockPath)).toBe(false);
      expect(await fileExists(jsonlPath)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Concurrent Lock Rejection
  // -------------------------------------------------------------------------

  describe('Concurrent lock rejection @requirement:REQ-CON-004 @plan:PLAN-20260211-SESSIONRECORDING.P10', () => {
    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-004
     * Test 6: Concurrent acquire fails
     */
    it('second acquire on same session throws "in use" error', async () => {
      const sessionId = 'test-session-006';
      const handle = await SessionLockManager.acquire(chatsDir, sessionId);

      await expect(
        SessionLockManager.acquire(chatsDir, sessionId),
      ).rejects.toBeInstanceOf(SessionLockedError);

      await handle.release();
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-004
     * Test 11: Multiple sessions don't conflict
     */
    it('different sessionIds can be locked independently', async () => {
      const handle1 = await SessionLockManager.acquire(chatsDir, 'session-a');
      const handle2 = await SessionLockManager.acquire(chatsDir, 'session-b');

      const lockA = SessionLockManager.getLockPath(chatsDir, 'session-a');
      const lockB = SessionLockManager.getLockPath(chatsDir, 'session-b');

      expect(await fileExists(lockA)).toBe(true);
      expect(await fileExists(lockB)).toBe(true);

      await handle1.release();
      await handle2.release();
    });
  });

  // -------------------------------------------------------------------------
  // Stale Lock Detection
  // -------------------------------------------------------------------------

  describe('Stale lock detection @requirement:REQ-CON-005 @plan:PLAN-20260211-SESSIONRECORDING.P10', () => {
    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-005
     * Test 8: Stale lock detection: dead PID
     */
    it('checkStale returns true for a lock with dead PID', async () => {
      const sessionId = 'test-session-008';
      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
      await writeFakeLock(lockPath, DEAD_PID, sessionId);

      const stale = await SessionLockManager.checkStale(lockPath);
      expect(stale).toBe(true);
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-005
     * Test 9: Stale lock detection: alive PID
     */
    it('checkStale returns false for a lock with current process PID', async () => {
      const sessionId = 'test-session-009';
      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
      await writeFakeLock(lockPath, process.pid, sessionId);

      const stale = await SessionLockManager.checkStale(lockPath);
      expect(stale).toBe(false);
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-005
     * Test 18: Corrupt lock file treated as stale
     */
    it('checkStale returns true for corrupt (non-JSON) lock file', async () => {
      const sessionId = 'test-session-018';
      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
      await fs.writeFile(lockPath, 'this is not json garbage!!!', 'utf-8');

      const stale = await SessionLockManager.checkStale(lockPath);
      expect(stale).toBe(true);
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-005
     * Test 10 (stale breaking): acquire breaks stale lock transparently
     */
    it('acquire succeeds when stale lock exists (dead PID)', async () => {
      const sessionId = 'test-session-stale';
      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
      await writeFakeLock(lockPath, DEAD_PID, sessionId);

      const handle = await SessionLockManager.acquire(chatsDir, sessionId);

      // New lock should have current PID
      const raw = await fs.readFile(lockPath, 'utf-8');
      const data = JSON.parse(raw);
      expect(data.pid).toBe(process.pid);

      await handle.release();
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-005
     * Test 14: isStale returns true for dead PID
     */
    it('isStale returns true when lock file has dead PID', async () => {
      const sessionId = 'test-session-014';
      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
      await writeFakeLock(lockPath, DEAD_PID, sessionId);

      const stale = await SessionLockManager.isStale(chatsDir, sessionId);
      expect(stale).toBe(true);
    });

    it('checkStale returns false when process.kill throws EPERM', async () => {
      const sessionId = 'test-session-eperm-stale';
      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
      await writeFakeLock(lockPath, 12345, sessionId);

      const killSpy = vi
        .spyOn(process, 'kill')
        .mockImplementation(
          (_pid: number, _signal?: number | NodeJS.Signals) => {
            const error = new Error(
              'operation not permitted',
            ) as NodeJS.ErrnoException;
            error.code = 'EPERM';
            throw error;
          },
        );

      try {
        const stale = await SessionLockManager.checkStale(lockPath);
        expect(stale).toBe(false);
      } finally {
        killSpy.mockRestore();
      }
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-005
     * Test 15: isStale returns false when no lock
     */
    it('isStale returns false when no lock file exists', async () => {
      const stale = await SessionLockManager.isStale(chatsDir, 'nonexistent');
      expect(stale).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // isLocked
  // -------------------------------------------------------------------------

  describe('isLocked @requirement:REQ-CON-001 @plan:PLAN-20260211-SESSIONRECORDING.P10', () => {
    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-001
     * Test 11: isLocked returns true when locked
     */
    it('isLocked returns true when lock is held by live process', async () => {
      const sessionId = 'test-session-locked';
      const handle = await SessionLockManager.acquire(chatsDir, sessionId);

      const locked = await SessionLockManager.isLocked(chatsDir, sessionId);
      expect(locked).toBe(true);

      await handle.release();
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-001
     * Test 12: isLocked returns false when not locked
     */
    it('isLocked returns false when no lock file exists', async () => {
      const locked = await SessionLockManager.isLocked(
        chatsDir,
        'no-such-session',
      );
      expect(locked).toBe(false);
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-001, REQ-CON-005
     * Test 13: isLocked returns false for stale lock
     */
    it('isLocked returns false for stale lock (dead PID)', async () => {
      const sessionId = 'test-session-stale-locked';
      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
      await writeFakeLock(lockPath, DEAD_PID, sessionId);

      const locked = await SessionLockManager.isLocked(chatsDir, sessionId);
      expect(locked).toBe(false);
    });
  });

  it('acquire maps ENOENT then EEXIST race to in-use error', async () => {
    const sessionId = 'test-session-enoent-race';
    const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
    const writeFileMock = vi.mocked(fs.writeFile);

    writeFileMock.mockClear();
    writeFileMock
      .mockRejectedValueOnce(
        Object.assign(new Error('no such file'), { code: 'ENOENT' }),
      )
      .mockRejectedValueOnce(
        Object.assign(new Error('already exists'), { code: 'EEXIST' }),
      );

    await expect(
      SessionLockManager.acquire(chatsDir, sessionId),
    ).rejects.toThrow('Session is in use by another process');

    const lockWriteCalls = writeFileMock.mock.calls.filter(
      ([targetPath, , options]) =>
        isWxLockWriteCall(targetPath, options, lockPath),
    );

    expect(lockWriteCalls).toHaveLength(2);
  });

  /**
   * Helper function to check if a write call is a 'wx' flag lock write.
   */
  function isWxLockWriteCall(
    targetPath: string,
    options: unknown,
    expectedLockPath: string,
  ): boolean {
    if (targetPath !== expectedLockPath) return false;
    if (typeof options !== 'object' || options === null) return false;
    if (!('flag' in options)) return false;
    return (options as { flag?: string }).flag === 'wx';
  }

  // -------------------------------------------------------------------------
  // removeStaleLock
  // -------------------------------------------------------------------------

  describe('removeStaleLock @requirement:REQ-CON-005 @plan:PLAN-20260211-SESSIONRECORDING.P10', () => {
    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-005
     * Test 16: removeStaleLock deletes lock file
     */
    it('removeStaleLock removes the lock file from disk', async () => {
      const sessionId = 'test-session-016';
      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
      await writeFakeLock(lockPath, DEAD_PID, sessionId);

      await SessionLockManager.removeStaleLock(chatsDir, sessionId);

      expect(await fileExists(lockPath)).toBe(false);
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-005
     * Test 17: removeStaleLock is safe when no lock exists
     */
    it('removeStaleLock does not throw when no lock file exists', async () => {
      // Verify removeStaleLock completes without throwing when the lock
      // file does not exist (idempotent cleanup).
      await expect(
        SessionLockManager.removeStaleLock(chatsDir, 'nonexistent-session'),
      ).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Orphan Lock Cleanup
  // -------------------------------------------------------------------------

  describe('Orphan lock cleanup @requirement:REQ-CON-005 @plan:PLAN-20260211-SESSIONRECORDING.P10', () => {
    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-005
     * Test 31: Orphan lock cleanup: stale lock with no JSONL
     */
    it('cleanupOrphanedLocks removes stale lock with no JSONL file', async () => {
      const sessionId = 'orphan-no-jsonl';
      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
      await writeFakeLock(lockPath, DEAD_PID, sessionId);

      await SessionLockManager.cleanupOrphanedLocks(chatsDir);

      expect(await fileExists(lockPath)).toBe(false);
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-005
     * Test 32: Orphan lock cleanup: stale lock with existing JSONL
     */
    it('cleanupOrphanedLocks removes stale lock but preserves JSONL file', async () => {
      const sessionId = 'orphan-with-jsonl';
      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
      const jsonlPath = path.join(chatsDir, `session-${sessionId}.jsonl`);

      await writeFakeLock(lockPath, DEAD_PID, sessionId);
      await fs.writeFile(jsonlPath, '{"type":"session_start"}\n', 'utf-8');

      await SessionLockManager.cleanupOrphanedLocks(chatsDir);

      expect(await fileExists(lockPath)).toBe(false);
      expect(await fileExists(jsonlPath)).toBe(true);
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-004
     * Test 33: Active lock is not removed by cleanup
     */
    it('cleanupOrphanedLocks does not remove active locks', async () => {
      const sessionId = 'active-lock';
      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
      // Write lock with current PID (alive)
      await writeFakeLock(lockPath, process.pid, sessionId);

      await SessionLockManager.cleanupOrphanedLocks(chatsDir);

      expect(await fileExists(lockPath)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // PID Reuse Protection (Timestamp-based heuristic)
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Dual-Process Lock Contention
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Property-Based Tests (30%+)
});
