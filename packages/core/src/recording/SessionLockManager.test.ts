/* eslint-disable vitest/no-standalone-expect */
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
 * Property-based tests use @fast-check/vitest (≥30% of total tests).
 * All tests expect real behavior from the lock manager. They will fail against
 * the Phase 09 stub — that is correct TDD.
 */

import { describe, expect, beforeEach, afterEach, vi } from 'vitest';
import { it } from '@fast-check/vitest';
import * as fc from 'fast-check';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { fork, type ChildProcess } from 'child_process';
import { SessionLockManager, type LockHandle } from './SessionLockManager.js';

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

/**
 * Generate a safe session ID arbitrary (filesystem-safe, non-empty).
 */
function safeSessionIdArb(): fc.Arbitrary<string> {
  return fc.stringMatching(/^[a-z0-9_-]{1,32}$/);
}

/**
 * Wait for a specific message from a child process.
 */
function waitForMessage(child: ChildProcess, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timeout waiting for message: ${expected}`)),
      10000,
    );
    child.on('message', (msg) => {
      if (msg === expected) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(`Child exited with code ${code}`));
    });
  });
}

/**
 * Wait for a child process to exit.
 */
function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(child.exitCode);
      return;
    }
    const timeout = setTimeout(() => resolve(null), 5000);
    child.on('exit', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
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
      ).rejects.toThrow(/in use/i);

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
      // Should not throw
      await SessionLockManager.removeStaleLock(chatsDir, 'nonexistent-session');
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

  describe('PID reuse protection @requirement:REQ-CON-005 @plan:PLAN-20260211-SESSIONRECORDING.P10', () => {
    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-005
     * Test 34: Stale detection with PID reuse — old lock treated as stale
     */
    it('checkStaleWithPidReuse returns true for alive PID with timestamp > 48 hours ago', async () => {
      const sessionId = 'test-session-034';
      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
      const oldTimestamp = new Date(
        Date.now() - 49 * 60 * 60 * 1000,
      ).toISOString();
      await writeFakeLock(lockPath, process.pid, sessionId, oldTimestamp);

      const stale = await SessionLockManager.checkStaleWithPidReuse(lockPath);
      expect(stale).toBe(true);
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-005
     * Test 35: Stale detection with PID reuse — recent lock not stale
     */
    it('checkStaleWithPidReuse returns false for alive PID with recent timestamp', async () => {
      const sessionId = 'test-session-035';
      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
      await writeFakeLock(lockPath, process.pid, sessionId);

      const stale = await SessionLockManager.checkStaleWithPidReuse(lockPath);
      expect(stale).toBe(false);
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-005
     * Test 39: PID reuse edge case — alive PID, recent timestamp is trusted;
     * alive PID with old timestamp is stale
     */
    it('checkStaleWithPidReuse trusts alive PID within recent window but overrides for old timestamp', async () => {
      const sessionId = 'test-session-039';
      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);

      // Recent timestamp + alive PID → not stale
      const recentTimestamp = new Date(
        Date.now() - 30 * 60 * 1000,
      ).toISOString();
      await writeFakeLock(lockPath, process.pid, sessionId, recentTimestamp);

      const staleRecent =
        await SessionLockManager.checkStaleWithPidReuse(lockPath);
      expect(staleRecent).toBe(false);

      // Old timestamp + alive PID → stale (timestamp override)
      const oldTimestamp = new Date(
        Date.now() - 49 * 60 * 60 * 1000,
      ).toISOString();
      await fs.writeFile(
        lockPath,
        JSON.stringify({
          pid: process.pid,
          timestamp: oldTimestamp,
          sessionId,
        }),
        'utf-8',
      );

      const staleOld =
        await SessionLockManager.checkStaleWithPidReuse(lockPath);
      expect(staleOld).toBe(true);
    });

    it('checkStaleWithPidReuse returns false when process.kill throws EPERM', async () => {
      const sessionId = 'test-session-eperm-pid-reuse';
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
        const stale = await SessionLockManager.checkStaleWithPidReuse(lockPath);
        expect(stale).toBe(false);
      } finally {
        killSpy.mockRestore();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Dual-Process Lock Contention
  // -------------------------------------------------------------------------

  describe('Dual-process lock contention @requirement:REQ-CON-004,REQ-CON-005 @plan:PLAN-20260211-SESSIONRECORDING.P10', () => {
    let childProcess: ChildProcess | null = null;

    afterEach(async () => {
      if (childProcess && childProcess.exitCode === null) {
        childProcess.kill('SIGKILL');
        await waitForExit(childProcess).catch(() => {});
      }
      childProcess = null;
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-004, REQ-CON-005
     * Test 40: Dual-process lock contention with real process fork
     */
    it('real child process holds lock, parent acquire fails, then succeeds after child exits', async () => {
      const sessionId = 'fork-contention';
      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);

      // Write a lock file with a PID from a real forked process
      // We fork a simple node script that holds a lock and waits
      const helperScript = path.join(tempDir, 'lock-helper.mjs');
      await fs.writeFile(
        helperScript,
        `
import * as fs from 'fs/promises';

const lockPath = process.argv[2];
const lockContent = JSON.stringify({
  pid: process.pid,
  timestamp: new Date().toISOString(),
  sessionId: 'fork-contention',
});

await fs.writeFile(lockPath, lockContent, { flag: 'wx' });
process.send('lock-acquired');

process.on('message', async (msg) => {
  if (msg === 'release') {
    await fs.unlink(lockPath).catch(() => {});
    process.exit(0);
  }
});
`,
        'utf-8',
      );

      childProcess = fork(helperScript, [lockPath], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      });

      await waitForMessage(childProcess, 'lock-acquired');

      // Parent attempts to acquire — should fail (child holds the lock)
      await expect(
        SessionLockManager.acquire(chatsDir, sessionId),
      ).rejects.toThrow(/in use/i);

      // Tell child to release and exit
      childProcess.send('release');
      await waitForExit(childProcess);

      // Now parent can acquire
      const handle = await SessionLockManager.acquire(chatsDir, sessionId);
      expect(handle).toBeDefined();
      expect(handle.lockPath).toBe(lockPath);

      await handle.release();
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-005
     * Test 41: Dual-process lock with child crash (SIGKILL, no clean release)
     */
    it('stale lock from crashed child process is broken by parent acquire', async () => {
      const sessionId = 'fork-crash';
      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);

      const helperScript = path.join(tempDir, 'lock-crash-helper.mjs');
      await fs.writeFile(
        helperScript,
        `
import * as fs from 'fs/promises';

const lockPath = process.argv[2];
const lockContent = JSON.stringify({
  pid: process.pid,
  timestamp: new Date().toISOString(),
  sessionId: 'fork-crash',
});

await fs.writeFile(lockPath, lockContent, { flag: 'wx' });
process.send('lock-acquired');

// Wait forever — will be killed by parent
setInterval(() => {}, 60000);
`,
        'utf-8',
      );

      childProcess = fork(helperScript, [lockPath], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      });

      await waitForMessage(childProcess, 'lock-acquired');

      // Verify lock exists with child PID
      const rawBefore = await fs.readFile(lockPath, 'utf-8');
      const dataBefore = JSON.parse(rawBefore);
      expect(dataBefore.pid).toBe(childProcess.pid);

      // Kill child with SIGKILL (no cleanup handlers)
      childProcess.kill('SIGKILL');
      await waitForExit(childProcess);

      // Parent should acquire successfully (stale detection)
      const handle = await SessionLockManager.acquire(chatsDir, sessionId);
      expect(handle).toBeDefined();

      // Verify new lock has parent PID
      const rawAfter = await fs.readFile(lockPath, 'utf-8');
      const dataAfter = JSON.parse(rawAfter);
      expect(dataAfter.pid).toBe(process.pid);

      await handle.release();
    });
  });

  // -------------------------------------------------------------------------
  // Property-Based Tests (30%+)
  // -------------------------------------------------------------------------

  describe('Property-based tests @plan:PLAN-20260211-SESSIONRECORDING.P10', () => {
    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-001
     * Test 19: Any valid path components produce deterministic lock path
     */
    it.prop([safeSessionIdArb()], { numRuns: 50 })(
      'getLockPath is pure and deterministic for any sessionId @requirement:REQ-CON-001',
      (sessionId) => {
        const result1 = SessionLockManager.getLockPath(chatsDir, sessionId);
        const result2 = SessionLockManager.getLockPath(chatsDir, sessionId);
        expect(result1).toBe(result2);
        expect(result1).toBe(path.join(chatsDir, sessionId + '.lock'));
      },
    );

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-001
     * Test 26: getLockPath always appends exactly '.lock'
     */
    it.prop([safeSessionIdArb()], { numRuns: 50 })(
      'getLockPath always appends exactly .lock to sessionId @requirement:REQ-CON-001',
      (sessionId) => {
        const result = SessionLockManager.getLockPath(chatsDir, sessionId);
        expect(result.endsWith('.lock')).toBe(true);
        expect(path.basename(result)).toBe(sessionId + '.lock');
      },
    );

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-001
     * Test 36: Any sessionId produces deterministic lock path via getLockPath
     */
    it.prop([safeSessionIdArb()], { numRuns: 50 })(
      'getLockPath for any sessionId returns <chatsDir>/<id>.lock @requirement:REQ-CON-001',
      (sessionId) => {
        const result = SessionLockManager.getLockPath(chatsDir, sessionId);
        expect(result).toBe(path.join(chatsDir, `${sessionId}.lock`));
      },
    );

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-003
     * Test 20: Acquire + release cycle leaves no leftover .lock files
     */
    it.prop([safeSessionIdArb()], { numRuns: 20 })(
      'acquire + release cycle leaves no orphaned .lock files @requirement:REQ-CON-003',
      async (sessionId) => {
        const handle = await SessionLockManager.acquire(chatsDir, sessionId);
        await handle.release();

        const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
        expect(await fileExists(lockPath)).toBe(false);
      },
    );

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-001
     * Test 21: Multiple session paths can be locked independently
     */
    it.prop(
      [fc.uniqueArray(safeSessionIdArb(), { minLength: 2, maxLength: 5 })],
      { numRuns: 10 },
    )(
      'multiple unique sessionIds can be locked independently @requirement:REQ-CON-001',
      async (sessionIds) => {
        const handles: LockHandle[] = [];

        for (const sid of sessionIds) {
          const handle = await SessionLockManager.acquire(chatsDir, sid);
          handles.push(handle);
        }

        // Verify all lock files exist
        for (const sid of sessionIds) {
          const lockPath = SessionLockManager.getLockPath(chatsDir, sid);
          expect(await fileExists(lockPath)).toBe(true);
        }

        // Release all
        for (const handle of handles) {
          await handle.release();
        }

        // Verify all lock files are gone
        for (const sid of sessionIds) {
          const lockPath = SessionLockManager.getLockPath(chatsDir, sid);
          expect(await fileExists(lockPath)).toBe(false);
        }
      },
    );

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-001
     * Test 22: Lock file always contains valid JSON with pid field
     */
    it.prop([safeSessionIdArb()], { numRuns: 20 })(
      'lock file always contains valid JSON with pid field @requirement:REQ-CON-001',
      async (sessionId) => {
        const handle = await SessionLockManager.acquire(chatsDir, sessionId);
        const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);

        const raw = await fs.readFile(lockPath, 'utf-8');
        const data = JSON.parse(raw);
        expect(typeof data.pid).toBe('number');
        expect(data.pid).toBe(process.pid);

        await handle.release();
      },
    );

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-003
     * Test 23: Release is always idempotent regardless of call count
     */
    it.prop([fc.nat({ max: 9 }).map((n) => n + 1)], { numRuns: 15 })(
      'release is idempotent regardless of call count @requirement:REQ-CON-003',
      async (releaseCount) => {
        const handle = await SessionLockManager.acquire(
          chatsDir,
          'idempotent-test',
        );

        for (let i = 0; i < releaseCount; i++) {
          await handle.release();
        }

        const lockPath = SessionLockManager.getLockPath(
          chatsDir,
          'idempotent-test',
        );
        expect(await fileExists(lockPath)).toBe(false);
      },
    );

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-005
     * Test 24: Stale detection is consistent for alive/dead PIDs
     */
    it.prop([fc.boolean()], { numRuns: 20 })(
      'checkStale returns correct result for alive vs dead PID @requirement:REQ-CON-005',
      async (useAlivePid) => {
        const sessionId = 'stale-prop-test';
        const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
        const pid = useAlivePid ? process.pid : DEAD_PID;
        await writeFakeLock(lockPath, pid, sessionId);

        const stale = await SessionLockManager.checkStale(lockPath);
        expect(stale).toBe(!useAlivePid);

        // Clean up for next run
        await fs.unlink(lockPath).catch(() => {});
      },
    );

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-001
     * Test 25: Lock file timestamp is always a valid ISO-8601 date
     */
    it.prop([safeSessionIdArb()], { numRuns: 20 })(
      'lock file timestamp is always valid ISO-8601 @requirement:REQ-CON-001',
      async (sessionId) => {
        const handle = await SessionLockManager.acquire(chatsDir, sessionId);
        const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);

        const raw = await fs.readFile(lockPath, 'utf-8');
        const data = JSON.parse(raw);
        expect(isValidIso8601(data.timestamp)).toBe(true);

        await handle.release();
      },
    );

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-003
     * Test 37: acquireForSession + release cycle leaves no artifacts
     */
    it.prop([safeSessionIdArb()], { numRuns: 20 })(
      'acquire + release leaves no lock file and no JSONL file @requirement:REQ-CON-003',
      async (sessionId) => {
        const handle = await SessionLockManager.acquire(chatsDir, sessionId);
        await handle.release();

        const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
        const jsonlPath = path.join(chatsDir, `session-${sessionId}.jsonl`);

        expect(await fileExists(lockPath)).toBe(false);
        expect(await fileExists(jsonlPath)).toBe(false);
      },
    );

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-005
     * Test 38: cleanupOrphanedLocks is idempotent
     */
    it.prop([fc.nat({ max: 2 }).map((n) => n + 1)], { numRuns: 10 })(
      'cleanupOrphanedLocks is idempotent @requirement:REQ-CON-005',
      async (callCount) => {
        // Create a stale lock
        const sessionId = 'orphan-idempotent';
        const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
        await writeFakeLock(lockPath, DEAD_PID, sessionId);

        // Call cleanup N times
        for (let i = 0; i < callCount; i++) {
          await SessionLockManager.cleanupOrphanedLocks(chatsDir);
        }

        // Lock should be gone after first call, and no errors on subsequent calls
        expect(await fileExists(lockPath)).toBe(false);
      },
    );

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-001
     * getLockPathFromFilePath is inverse of the naming convention
     */
    it.prop([safeSessionIdArb()], { numRuns: 50 })(
      'getLockPathFromFilePath extracts sessionId correctly from any valid JSONL path @requirement:REQ-CON-001',
      (sessionId) => {
        const jsonlPath = path.join(chatsDir, `session-${sessionId}.jsonl`);
        const lockPath = SessionLockManager.getLockPathFromFilePath(jsonlPath);
        const expectedLockPath = SessionLockManager.getLockPath(
          chatsDir,
          sessionId,
        );
        expect(lockPath).toBe(expectedLockPath);
      },
    );

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-004
     * Concurrent acquire always fails when lock held
     */
    it.prop([safeSessionIdArb()], { numRuns: 10 })(
      'concurrent acquire on same session always throws @requirement:REQ-CON-004',
      async (sessionId) => {
        const handle = await SessionLockManager.acquire(chatsDir, sessionId);

        await expect(
          SessionLockManager.acquire(chatsDir, sessionId),
        ).rejects.toThrow(/in use/i);

        await handle.release();
      },
    );

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-005
     * Stale lock (dead PID) is always breakable by acquire
     */
    it.prop([safeSessionIdArb()], { numRuns: 10 })(
      'acquire always breaks stale lock with dead PID @requirement:REQ-CON-005',
      async (sessionId) => {
        const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
        await writeFakeLock(lockPath, DEAD_PID, sessionId);

        const handle = await SessionLockManager.acquire(chatsDir, sessionId);
        const raw = await fs.readFile(lockPath, 'utf-8');
        const data = JSON.parse(raw);
        expect(data.pid).toBe(process.pid);

        await handle.release();
      },
    );

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-001
     * Lock file sessionId field always matches requested sessionId
     */
    it.prop([safeSessionIdArb()], { numRuns: 20 })(
      'lock file sessionId field always matches requested sessionId @requirement:REQ-CON-001',
      async (sessionId) => {
        const handle = await SessionLockManager.acquire(chatsDir, sessionId);
        const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);

        const raw = await fs.readFile(lockPath, 'utf-8');
        const data = JSON.parse(raw);
        expect(data.sessionId).toBe(sessionId);

        await handle.release();
      },
    );
  });
});
