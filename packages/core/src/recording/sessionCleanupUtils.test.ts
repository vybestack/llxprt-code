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
 * @plan PLAN-20260211-SESSIONRECORDING.P16
 * @requirement REQ-CLN-001, REQ-CLN-002, REQ-CLN-003, REQ-CLN-004
 *
 * Behavioral tests for session cleanup utility functions that operate on
 * .jsonl session files. Tests verify actual file system state using real
 * temp directories — no mock theater.
 *
 * Property-based tests use @fast-check/vitest (≥30% of total tests).
 * All tests expect real behavior from the cleanup utilities. They will fail
 * against the Phase 15 stubs — that is correct TDD.
 */

import { describe, expect, beforeEach, afterEach } from 'vitest';
import { it } from '@fast-check/vitest';
import * as fc from 'fast-check';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  getAllJsonlSessionFiles,
  shouldDeleteSession,
  cleanupStaleLocks,
  type JsonlSessionFileEntry,
} from './sessionCleanupUtils.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Dead PID that is almost certainly not running. */
const DEAD_PID = 999999999;

/**
 * Write a valid .jsonl session file with a session_start event header.
 * Returns the absolute path to the created file.
 */
function writeSessionFile(
  dir: string,
  sessionId: string,
  startTime?: string,
): string {
  const ts = startTime || new Date().toISOString();
  const fileName = `session-${ts.replace(/[:.]/g, '-')}-${sessionId.slice(0, 8)}.jsonl`;
  const filePath = path.join(dir, fileName);
  const event = JSON.stringify({
    v: 1,
    seq: 1,
    ts,
    type: 'session_start',
    payload: {
      sessionId,
      projectHash: 'test-hash',
      workspaceDirs: ['/test'],
      provider: 'test',
      model: 'test-model',
      startTime: ts,
    },
  });
  fs.writeFileSync(filePath, event + '\n');
  return filePath;
}

/**
 * Write a .lock sidecar file with PID JSON content.
 * Returns the absolute path to the created lock file.
 */
function writeLockFile(sessionFilePath: string, pid: number): string {
  const lockPath = sessionFilePath + '.lock';
  fs.writeFileSync(
    lockPath,
    JSON.stringify({
      pid,
      timestamp: new Date().toISOString(),
      sessionId: 'test',
    }),
  );
  return lockPath;
}

/**
 * Create a JsonlSessionFileEntry for use with shouldDeleteSession.
 */
function makeEntry(
  filePath: string,
  sessionId: string,
  overrides: Partial<JsonlSessionFileEntry> = {},
): JsonlSessionFileEntry {
  const stat = fs.statSync(filePath);
  return {
    fileName: path.basename(filePath),
    filePath,
    stat: { mtime: stat.mtime, size: stat.size },
    sessionInfo: {
      id: sessionId,
      lastUpdated: stat.mtime.toISOString(),
      isCurrentSession: false,
    },
    ...overrides,
  };
}

/**
 * Generate a filesystem-safe session ID for property-based tests.
 */
function _safeSessionIdArb(): fc.Arbitrary<string> {
  return fc.stringMatching(/^[a-z0-9]{8,16}$/);
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('sessionCleanupUtils @plan:PLAN-20260211-SESSIONRECORDING.P16', () => {
  let tempDir: string;
  let chatsDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-test-'));
    chatsDir = path.join(tempDir, 'chats');
    fs.mkdirSync(chatsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // getAllJsonlSessionFiles — Behavioral Tests
  // -------------------------------------------------------------------------

  describe('getAllJsonlSessionFiles @requirement:REQ-CLN-001 @plan:PLAN-20260211-SESSIONRECORDING.P16', () => {
    /**
     * Test 1: getAllJsonlSessionFiles finds .jsonl files
     * @plan PLAN-20260211-SESSIONRECORDING.P16
     * @requirement REQ-CLN-001
     */
    it('finds .jsonl session files in the chats directory', async () => {
      const file1 = writeSessionFile(
        chatsDir,
        'aaa11111-0000-0000-0000-000000000001',
      );
      const file2 = writeSessionFile(
        chatsDir,
        'bbb22222-0000-0000-0000-000000000002',
      );
      const file3 = writeSessionFile(
        chatsDir,
        'ccc33333-0000-0000-0000-000000000003',
      );

      const entries = await getAllJsonlSessionFiles(chatsDir);

      expect(entries).toHaveLength(3);
      const fileNames = entries.map((e) => e.fileName);
      expect(fileNames).toContain(path.basename(file1));
      expect(fileNames).toContain(path.basename(file2));
      expect(fileNames).toContain(path.basename(file3));
    });

    /**
     * Test 2: getAllJsonlSessionFiles skips non-session files
     * @plan PLAN-20260211-SESSIONRECORDING.P16
     * @requirement REQ-CLN-001
     */
    it('skips non-session files (.txt, random names)', async () => {
      writeSessionFile(chatsDir, 'session-valid001');
      fs.writeFileSync(path.join(chatsDir, 'notes.txt'), 'some notes');
      fs.writeFileSync(path.join(chatsDir, 'data.jsonl'), '{"not":"session"}');
      fs.writeFileSync(path.join(chatsDir, 'readme.md'), '# readme');

      const entries = await getAllJsonlSessionFiles(chatsDir);

      expect(entries).toHaveLength(1);
      expect(entries[0].fileName).toMatch(/^session-.*\.jsonl$/);
    });

    /**
     * Test 3: getAllJsonlSessionFiles ignores old .json files
     * @plan PLAN-20260211-SESSIONRECORDING.P16
     * @requirement REQ-CLN-001
     */
    it('ignores old .json session files (only targets .jsonl)', async () => {
      writeSessionFile(chatsDir, 'session-newformat');
      fs.writeFileSync(
        path.join(
          chatsDir,
          'persisted-session-2025-01-01T00-00-00-old12345.json',
        ),
        JSON.stringify({ sessionId: 'old', messages: [] }),
      );
      fs.writeFileSync(
        path.join(chatsDir, 'session-2025-01-01T00-00-00-legacy12.json'),
        JSON.stringify({ sessionId: 'legacy', messages: [] }),
      );

      const entries = await getAllJsonlSessionFiles(chatsDir);

      expect(entries).toHaveLength(1);
      const fileNames = entries.map((e) => e.fileName);
      expect(fileNames.every((f) => f.endsWith('.jsonl'))).toBe(true);
    });

    /**
     * Test 11: Empty chats directory returns empty list
     * @plan PLAN-20260211-SESSIONRECORDING.P16
     * @requirement REQ-CLN-001
     */
    it('returns empty list for empty chats directory', async () => {
      const entries = await getAllJsonlSessionFiles(chatsDir);
      expect(entries).toHaveLength(0);
    });

    /**
     * Test 12: Non-existent chats directory returns empty list
     * @plan PLAN-20260211-SESSIONRECORDING.P16
     * @requirement REQ-CLN-001
     */
    it('returns empty list for non-existent chats directory', async () => {
      const nonExistent = path.join(tempDir, 'does-not-exist');
      const entries = await getAllJsonlSessionFiles(nonExistent);
      expect(entries).toHaveLength(0);
    });

    /**
     * Test 13: Header reading for .jsonl extracts session info
     * @plan PLAN-20260211-SESSIONRECORDING.P16
     * @requirement REQ-CLN-001
     */
    it('extracts session info from .jsonl header (session_start event)', async () => {
      const sessionId = 'abc12345-6789-0000-aaaa-bbbbccccdddd';
      const startTime = '2025-06-15T10:30:00.000Z';
      writeSessionFile(chatsDir, sessionId, startTime);

      const entries = await getAllJsonlSessionFiles(chatsDir);

      expect(entries).toHaveLength(1);
      expect(entries[0].sessionInfo).not.toBeNull();
      expect(entries[0].sessionInfo!.id).toBe(sessionId);
    });
  });

  // -------------------------------------------------------------------------
  // shouldDeleteSession — Behavioral Tests
  // -------------------------------------------------------------------------

  describe('shouldDeleteSession @requirement:REQ-CLN-002 @plan:PLAN-20260211-SESSIONRECORDING.P16', () => {
    /**
     * Test 4: shouldDeleteSession skips locked .jsonl (active lock with current PID)
     * @plan PLAN-20260211-SESSIONRECORDING.P16
     * @requirement REQ-CLN-002
     */
    it('returns skip for a .jsonl with an active lock (current PID)', async () => {
      const sessionPath = writeSessionFile(chatsDir, 'locked-session');
      writeLockFile(sessionPath, process.pid);
      const entry = makeEntry(sessionPath, 'locked-session');

      const result = await shouldDeleteSession(entry);

      expect(result).toBe('skip');
    });

    /**
     * Test 5: shouldDeleteSession allows unlocked .jsonl (no .lock file)
     * @plan PLAN-20260211-SESSIONRECORDING.P16
     * @requirement REQ-CLN-002
     */
    it('returns delete for a .jsonl with no .lock file', async () => {
      const sessionPath = writeSessionFile(chatsDir, 'unlocked-session');
      const entry = makeEntry(sessionPath, 'unlocked-session');

      const result = await shouldDeleteSession(entry);

      expect(result).toBe('delete');
    });

    /**
     * Test 6: shouldDeleteSession detects stale lock (dead PID like 999999999)
     * @plan PLAN-20260211-SESSIONRECORDING.P16
     * @requirement REQ-CLN-002, REQ-CLN-003
     */
    it('returns stale-lock-only for a .jsonl with a stale lock (dead PID)', async () => {
      const sessionPath = writeSessionFile(chatsDir, 'stale-session1');
      writeLockFile(sessionPath, DEAD_PID);
      const entry = makeEntry(sessionPath, 'stale-session1');

      const result = await shouldDeleteSession(entry);

      expect(result).toBe('stale-lock-only');
    });
  });

  // -------------------------------------------------------------------------
  // cleanupStaleLocks — Behavioral Tests
  // -------------------------------------------------------------------------

  describe('cleanupStaleLocks @requirement:REQ-CLN-004 @plan:PLAN-20260211-SESSIONRECORDING.P16', () => {
    /**
     * Test 7: cleanupStaleLocks removes orphaned .lock (no matching .jsonl)
     * @plan PLAN-20260211-SESSIONRECORDING.P16
     * @requirement REQ-CLN-004
     */
    it('removes orphaned .lock file with no matching .jsonl', async () => {
      const orphanedLockPath = path.join(chatsDir, 'session-orphan.jsonl.lock');
      fs.writeFileSync(
        orphanedLockPath,
        JSON.stringify({
          pid: DEAD_PID,
          timestamp: new Date().toISOString(),
          sessionId: 'orphan',
        }),
      );

      const count = await cleanupStaleLocks(chatsDir);

      expect(fs.existsSync(orphanedLockPath)).toBe(false);
      expect(count).toBeGreaterThanOrEqual(1);
    });

    /**
     * Test 8: cleanupStaleLocks keeps non-orphaned .lock (active lock with live PID)
     * @plan PLAN-20260211-SESSIONRECORDING.P16
     * @requirement REQ-CLN-004
     */
    it('keeps .lock file that has matching .jsonl and live PID', async () => {
      const sessionPath = writeSessionFile(chatsDir, 'active-sess1');
      const lockPath = writeLockFile(sessionPath, process.pid);

      await cleanupStaleLocks(chatsDir);

      expect(fs.existsSync(lockPath)).toBe(true);
      expect(fs.existsSync(sessionPath)).toBe(true);
    });

    /**
     * Test 9: cleanupStaleLocks removes stale .lock (dead PID) but preserves .jsonl
     * @plan PLAN-20260211-SESSIONRECORDING.P16
     * @requirement REQ-CLN-004
     */
    it('removes stale .lock (dead PID) but preserves the .jsonl file', async () => {
      const sessionPath = writeSessionFile(chatsDir, 'stale-lock01');
      const lockPath = writeLockFile(sessionPath, DEAD_PID);

      await cleanupStaleLocks(chatsDir);

      expect(fs.existsSync(lockPath)).toBe(false);
      expect(fs.existsSync(sessionPath)).toBe(true);
    });

    /**
     * Test 10: cleanupStaleLocks returns count
     * @plan PLAN-20260211-SESSIONRECORDING.P16
     * @requirement REQ-CLN-004
     */
    it('returns the count of lock files cleaned up', async () => {
      // Create 3 orphaned locks
      for (let i = 0; i < 3; i++) {
        const orphanLock = path.join(chatsDir, `session-orphan${i}.jsonl.lock`);
        fs.writeFileSync(
          orphanLock,
          JSON.stringify({
            pid: DEAD_PID,
            timestamp: new Date().toISOString(),
            sessionId: `orphan${i}`,
          }),
        );
      }

      const count = await cleanupStaleLocks(chatsDir);

      expect(count).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // Addendum Tests — Stale Lock with Retention Policy
  // -------------------------------------------------------------------------

  describe('Stale lock + retention policy interaction @requirement:REQ-CLN-003 @plan:PLAN-20260211-SESSIONRECORDING.P16', () => {
    /**
     * Test 23: Stale lock with recent session → lock removed, session preserved
     * @plan PLAN-20260211-SESSIONRECORDING.P16
     * @requirement REQ-CLN-003
     */
    it('stale lock with recent session: shouldDeleteSession returns stale-lock-only (not delete)', async () => {
      const recentTime = new Date(
        Date.now() - 1 * 60 * 60 * 1000,
      ).toISOString(); // 1 hour ago
      const sessionPath = writeSessionFile(
        chatsDir,
        'recent-stale1',
        recentTime,
      );
      writeLockFile(sessionPath, DEAD_PID);
      const entry = makeEntry(sessionPath, 'recent-stale1');

      const result = await shouldDeleteSession(entry);

      // Stale lock should result in 'stale-lock-only' — the data file
      // is NOT deleted just because the lock is stale. Retention policy
      // (not exercised here) decides deletion of the data file.
      expect(result).toBe('stale-lock-only');

      // The .jsonl file must still exist on disk
      expect(fs.existsSync(sessionPath)).toBe(true);
    });

    /**
     * Test 24: Stale lock with OLD session → lock removed, session deleted by retention (not stale status)
     * @plan PLAN-20260211-SESSIONRECORDING.P16
     * @requirement REQ-CLN-003
     *
     * This test verifies the disposition is still 'stale-lock-only', NOT 'delete'.
     * The actual deletion of old sessions is the responsibility of the retention
     * policy layer, not shouldDeleteSession. shouldDeleteSession only evaluates
     * lock status.
     */
    it('stale lock with old session: shouldDeleteSession still returns stale-lock-only', async () => {
      const oldTime = new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000,
      ).toISOString(); // 30 days ago
      const sessionPath = writeSessionFile(chatsDir, 'old-stale-001', oldTime);
      writeLockFile(sessionPath, DEAD_PID);
      const entry = makeEntry(sessionPath, 'old-stale-001');

      const result = await shouldDeleteSession(entry);

      // shouldDeleteSession only evaluates lock status, not age.
      // 'stale-lock-only' means: remove the lock, let retention policy
      // independently decide whether to delete the data file.
      expect(result).toBe('stale-lock-only');
    });
  });

  // -------------------------------------------------------------------------
  // Property-Based Tests (30%+ of total — 12 out of 25)
  // -------------------------------------------------------------------------

  describe('Property-based tests @plan:PLAN-20260211-SESSIONRECORDING.P16', () => {
    /**
     * Test 14: Any number of .jsonl files are all discovered
     * @plan PLAN-20260211-SESSIONRECORDING.P16
     * @requirement REQ-CLN-001
     */
    it.prop([fc.nat({ max: 8 })], { numRuns: 15 })(
      'all N .jsonl session files are discovered for any N @requirement:REQ-CLN-001',
      async (count) => {
        const localTemp = fs.mkdtempSync(
          path.join(os.tmpdir(), 'prop-discover-'),
        );
        const localChats = path.join(localTemp, 'chats');
        fs.mkdirSync(localChats, { recursive: true });

        try {
          const created: string[] = [];
          for (let i = 0; i < count; i++) {
            const id = `prop-sess-${i.toString().padStart(4, '0')}-${Date.now()}`;
            const ts = new Date(Date.now() - i * 1000).toISOString();
            const filePath = writeSessionFile(localChats, id, ts);
            created.push(path.basename(filePath));
          }

          const entries = await getAllJsonlSessionFiles(localChats);

          expect(entries).toHaveLength(count);
          const foundNames = entries.map((e) => e.fileName);
          for (const name of created) {
            expect(foundNames).toContain(name);
          }
        } finally {
          fs.rmSync(localTemp, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 15: Orphaned lock cleanup is safe for any file count
     * @plan PLAN-20260211-SESSIONRECORDING.P16
     * @requirement REQ-CLN-004
     */
    it.prop([fc.nat({ max: 5 }), fc.nat({ max: 5 })], { numRuns: 15 })(
      'orphaned lock cleanup is safe: only orphans removed for any counts @requirement:REQ-CLN-004',
      async (orphanCount, pairedCount) => {
        const localTemp = fs.mkdtempSync(
          path.join(os.tmpdir(), 'prop-orphan-'),
        );
        const localChats = path.join(localTemp, 'chats');
        fs.mkdirSync(localChats, { recursive: true });

        try {
          const orphanLockPaths: string[] = [];
          const pairedLockPaths: string[] = [];
          const pairedSessionPaths: string[] = [];

          // Create orphaned locks (no matching .jsonl)
          for (let i = 0; i < orphanCount; i++) {
            const lockPath = path.join(
              localChats,
              `session-orphan-${i}-${Date.now()}.jsonl.lock`,
            );
            fs.writeFileSync(
              lockPath,
              JSON.stringify({
                pid: DEAD_PID,
                timestamp: new Date().toISOString(),
                sessionId: `orphan-${i}`,
              }),
            );
            orphanLockPaths.push(lockPath);
          }

          // Create paired session+lock (live PID — should be preserved)
          for (let i = 0; i < pairedCount; i++) {
            const id = `paired-${i}-${Date.now()}`;
            const ts = new Date(Date.now() - i * 1000).toISOString();
            const sessionPath = writeSessionFile(localChats, id, ts);
            const lockPath = writeLockFile(sessionPath, process.pid);
            pairedLockPaths.push(lockPath);
            pairedSessionPaths.push(sessionPath);
          }

          await cleanupStaleLocks(localChats);

          // All orphaned locks should be removed
          for (const lockPath of orphanLockPaths) {
            expect(fs.existsSync(lockPath)).toBe(false);
          }

          // All paired locks (live PID) should remain
          for (const lockPath of pairedLockPaths) {
            expect(fs.existsSync(lockPath)).toBe(true);
          }

          // All paired session files should remain
          for (const sessionPath of pairedSessionPaths) {
            expect(fs.existsSync(sessionPath)).toBe(true);
          }
        } finally {
          fs.rmSync(localTemp, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 16: Lock-aware protection never deletes active sessions
     * @plan PLAN-20260211-SESSIONRECORDING.P16
     * @requirement REQ-CLN-002
     */
    it.prop([fc.nat({ max: 6 })], { numRuns: 15 })(
      'shouldDeleteSession never returns delete for active-locked sessions @requirement:REQ-CLN-002',
      async (count) => {
        const localTemp = fs.mkdtempSync(
          path.join(os.tmpdir(), 'prop-active-'),
        );
        const localChats = path.join(localTemp, 'chats');
        fs.mkdirSync(localChats, { recursive: true });

        try {
          for (let i = 0; i < count; i++) {
            const id = `active-${i}-${Date.now()}`;
            const ts = new Date(Date.now() - i * 1000).toISOString();
            const sessionPath = writeSessionFile(localChats, id, ts);
            writeLockFile(sessionPath, process.pid);
            const entry = makeEntry(sessionPath, id);

            const result = await shouldDeleteSession(entry);

            // Active sessions (current PID lock) must NEVER return 'delete'
            expect(result).toBe('skip');
          }
        } finally {
          fs.rmSync(localTemp, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 17: Stale lock detection is consistent with PID liveness
     * @plan PLAN-20260211-SESSIONRECORDING.P16
     * @requirement REQ-CLN-002, REQ-CLN-003
     */
    it.prop([fc.boolean()], { numRuns: 20 })(
      'shouldDeleteSession result is consistent with PID liveness @requirement:REQ-CLN-002',
      async (useAlivePid) => {
        const localTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'prop-pid-'));
        const localChats = path.join(localTemp, 'chats');
        fs.mkdirSync(localChats, { recursive: true });

        try {
          const id = `pid-test-${Date.now()}`;
          const sessionPath = writeSessionFile(localChats, id);
          const pid = useAlivePid ? process.pid : DEAD_PID;
          writeLockFile(sessionPath, pid);
          const entry = makeEntry(sessionPath, id);

          const result = await shouldDeleteSession(entry);

          if (useAlivePid) {
            expect(result).toBe('skip');
          } else {
            expect(result).toBe('stale-lock-only');
          }
        } finally {
          fs.rmSync(localTemp, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 18: Non-session files are never included regardless of count
     * @plan PLAN-20260211-SESSIONRECORDING.P16
     * @requirement REQ-CLN-001
     */
    it.prop([fc.nat({ max: 8 })], { numRuns: 15 })(
      'non-session files are never included in scan results @requirement:REQ-CLN-001',
      async (count) => {
        const localTemp = fs.mkdtempSync(
          path.join(os.tmpdir(), 'prop-nonsess-'),
        );
        const localChats = path.join(localTemp, 'chats');
        fs.mkdirSync(localChats, { recursive: true });

        try {
          // Create random non-session files
          const nonSessionNames = [
            'notes.txt',
            'config.json',
            'data.csv',
            'readme.md',
            'log.jsonl',
            'backup.jsonl',
            'temp.lock',
            'index.html',
          ];
          for (let i = 0; i < count && i < nonSessionNames.length; i++) {
            fs.writeFileSync(
              path.join(localChats, nonSessionNames[i]),
              'content',
            );
          }

          const entries = await getAllJsonlSessionFiles(localChats);

          // No non-session files should appear
          expect(entries).toHaveLength(0);
        } finally {
          fs.rmSync(localTemp, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 19: Cleanup returns correct count for any combination
     * @plan PLAN-20260211-SESSIONRECORDING.P16
     * @requirement REQ-CLN-004
     */
    it.prop([fc.nat({ max: 4 }), fc.nat({ max: 4 }), fc.nat({ max: 4 })], {
      numRuns: 10,
    })(
      'cleanupStaleLocks returns correct count for any combo of orphan/stale/active @requirement:REQ-CLN-004',
      async (orphanCount, staleCount, activeCount) => {
        const localTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'prop-count-'));
        const localChats = path.join(localTemp, 'chats');
        fs.mkdirSync(localChats, { recursive: true });

        try {
          // Orphaned locks (no .jsonl) — should be cleaned
          for (let i = 0; i < orphanCount; i++) {
            const lockPath = path.join(
              localChats,
              `session-orph-${i}-${Date.now()}.jsonl.lock`,
            );
            fs.writeFileSync(
              lockPath,
              JSON.stringify({
                pid: DEAD_PID,
                timestamp: new Date().toISOString(),
                sessionId: `orph-${i}`,
              }),
            );
          }

          // Stale locks (dead PID with .jsonl) — should be cleaned
          for (let i = 0; i < staleCount; i++) {
            const id = `stale-${i}-${Date.now()}`;
            const ts = new Date(Date.now() - i * 1000).toISOString();
            const sessionPath = writeSessionFile(localChats, id, ts);
            writeLockFile(sessionPath, DEAD_PID);
          }

          // Active locks (live PID with .jsonl) — should NOT be cleaned
          for (let i = 0; i < activeCount; i++) {
            const id = `active-${i}-${Date.now()}`;
            const ts = new Date(Date.now() - i * 1000).toISOString();
            const sessionPath = writeSessionFile(localChats, id, ts);
            writeLockFile(sessionPath, process.pid);
          }

          const count = await cleanupStaleLocks(localChats);

          // Orphaned + stale should be cleaned; active should remain
          expect(count).toBe(orphanCount + staleCount);
        } finally {
          fs.rmSync(localTemp, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 20: Stale lock with recent session → lock removed, session preserved (property)
     * @plan PLAN-20260211-SESSIONRECORDING.P16
     * @requirement REQ-CLN-003
     */
    it.prop([fc.nat({ max: 5 })], { numRuns: 10 })(
      'stale lock on recent sessions: lock removed, session preserved @requirement:REQ-CLN-003',
      async (count) => {
        const localTemp = fs.mkdtempSync(
          path.join(os.tmpdir(), 'prop-stalerecent-'),
        );
        const localChats = path.join(localTemp, 'chats');
        fs.mkdirSync(localChats, { recursive: true });

        try {
          const sessionPaths: string[] = [];
          const lockPaths: string[] = [];

          for (let i = 0; i < count; i++) {
            const id = `recent-stale-${i}-${Date.now()}`;
            const recentTime = new Date(
              Date.now() - (i + 1) * 60 * 60 * 1000,
            ).toISOString(); // hours ago
            const sessionPath = writeSessionFile(localChats, id, recentTime);
            const lockPath = writeLockFile(sessionPath, DEAD_PID);
            sessionPaths.push(sessionPath);
            lockPaths.push(lockPath);
          }

          await cleanupStaleLocks(localChats);

          // All stale locks should be removed
          for (const lockPath of lockPaths) {
            expect(fs.existsSync(lockPath)).toBe(false);
          }

          // All session files should be preserved (recent, within retention)
          for (const sessionPath of sessionPaths) {
            expect(fs.existsSync(sessionPath)).toBe(true);
          }
        } finally {
          fs.rmSync(localTemp, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 21: Stale lock with old session → both removed (property: retention handles data, cleanup handles lock)
     * @plan PLAN-20260211-SESSIONRECORDING.P16
     * @requirement REQ-CLN-003
     *
     * This property test verifies that cleanupStaleLocks removes the stale
     * locks regardless of session age — and that the session files are left
     * for the retention policy to handle (cleanupStaleLocks does NOT delete
     * session files).
     */
    it.prop([fc.nat({ max: 5 })], { numRuns: 10 })(
      'stale lock cleanup removes locks but never deletes session files @requirement:REQ-CLN-003',
      async (count) => {
        const localTemp = fs.mkdtempSync(
          path.join(os.tmpdir(), 'prop-staleold-'),
        );
        const localChats = path.join(localTemp, 'chats');
        fs.mkdirSync(localChats, { recursive: true });

        try {
          const sessionPaths: string[] = [];
          const lockPaths: string[] = [];

          for (let i = 0; i < count; i++) {
            const id = `old-stale-${i}-${Date.now()}`;
            const oldTime = new Date(
              Date.now() - (30 + i) * 24 * 60 * 60 * 1000,
            ).toISOString(); // 30+ days ago
            const sessionPath = writeSessionFile(localChats, id, oldTime);
            const lockPath = writeLockFile(sessionPath, DEAD_PID);
            sessionPaths.push(sessionPath);
            lockPaths.push(lockPath);
          }

          await cleanupStaleLocks(localChats);

          // All stale locks removed
          for (const lockPath of lockPaths) {
            expect(fs.existsSync(lockPath)).toBe(false);
          }

          // Session files are NOT deleted by cleanupStaleLocks — that's
          // the retention policy's job
          for (const sessionPath of sessionPaths) {
            expect(fs.existsSync(sessionPath)).toBe(true);
          }
        } finally {
          fs.rmSync(localTemp, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 22: Stale lock status never causes deletion within retention window (property)
     * @plan PLAN-20260211-SESSIONRECORDING.P16
     * @requirement REQ-CLN-003
     */
    it.prop([fc.nat({ max: 3 }), fc.nat({ max: 3 })], { numRuns: 10 })(
      'stale lock status never causes deletion of sessions within retention window @requirement:REQ-CLN-003',
      async (staleWithinRetention, staleOutsideRetention) => {
        const localTemp = fs.mkdtempSync(
          path.join(os.tmpdir(), 'prop-retention-'),
        );
        const localChats = path.join(localTemp, 'chats');
        fs.mkdirSync(localChats, { recursive: true });

        try {
          const withinRetentionPaths: string[] = [];
          const outsideRetentionPaths: string[] = [];

          // Create N files within retention (e.g. < 7 days) with stale locks
          for (let i = 0; i < staleWithinRetention; i++) {
            const id = `within-${i}-${Date.now()}`;
            const recentTime = new Date(
              Date.now() - (i + 1) * 60 * 60 * 1000,
            ).toISOString(); // hours ago
            const sessionPath = writeSessionFile(localChats, id, recentTime);
            writeLockFile(sessionPath, DEAD_PID);
            withinRetentionPaths.push(sessionPath);
          }

          // Create M files outside retention (e.g. > 30 days) with stale locks
          for (let i = 0; i < staleOutsideRetention; i++) {
            const id = `outside-${i}-${Date.now()}`;
            const oldTime = new Date(
              Date.now() - (31 + i) * 24 * 60 * 60 * 1000,
            ).toISOString();
            const sessionPath = writeSessionFile(localChats, id, oldTime);
            writeLockFile(sessionPath, DEAD_PID);
            outsideRetentionPaths.push(sessionPath);
          }

          // shouldDeleteSession should return 'stale-lock-only' for ALL of these
          // because lock staleness alone does NOT justify data file deletion.
          for (const sessionPath of [
            ...withinRetentionPaths,
            ...outsideRetentionPaths,
          ]) {
            const entry = makeEntry(sessionPath, path.basename(sessionPath));
            const result = await shouldDeleteSession(entry);
            // stale-lock-only — not 'delete'. The retention policy decides deletion.
            expect(result).toBe('stale-lock-only');
          }

          // All session files must still exist — shouldDeleteSession doesn't delete
          for (const sessionPath of withinRetentionPaths) {
            expect(fs.existsSync(sessionPath)).toBe(true);
          }
          for (const sessionPath of outsideRetentionPaths) {
            expect(fs.existsSync(sessionPath)).toBe(true);
          }
        } finally {
          fs.rmSync(localTemp, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 23 (property): getAllJsonlSessionFiles returns entries with valid structure
     * @plan PLAN-20260211-SESSIONRECORDING.P16
     * @requirement REQ-CLN-001
     */
    it.prop([fc.nat({ max: 5 })], { numRuns: 10 })(
      'getAllJsonlSessionFiles always returns entries with correct structure @requirement:REQ-CLN-001',
      async (count) => {
        const localTemp = fs.mkdtempSync(
          path.join(os.tmpdir(), 'prop-struct-'),
        );
        const localChats = path.join(localTemp, 'chats');
        fs.mkdirSync(localChats, { recursive: true });

        try {
          for (let i = 0; i < count; i++) {
            const id = `struct-${i}-${Date.now()}`;
            const ts = new Date(Date.now() - i * 1000).toISOString();
            writeSessionFile(localChats, id, ts);
          }

          const entries = await getAllJsonlSessionFiles(localChats);

          expect(entries).toHaveLength(count);
          for (const entry of entries) {
            expect(entry.fileName).toMatch(/^session-.*\.jsonl$/);
            expect(entry.filePath).toBe(path.join(localChats, entry.fileName));
            expect(entry.stat.size).toBeGreaterThan(0);
            expect(entry.stat.mtime).toBeInstanceOf(Date);
          }
        } finally {
          fs.rmSync(localTemp, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 24 (property): shouldDeleteSession without lock always returns 'delete'
     * @plan PLAN-20260211-SESSIONRECORDING.P16
     * @requirement REQ-CLN-002
     */
    it.prop([fc.nat({ max: 6 })], { numRuns: 10 })(
      'shouldDeleteSession returns delete for all unlocked sessions @requirement:REQ-CLN-002',
      async (count) => {
        const localTemp = fs.mkdtempSync(
          path.join(os.tmpdir(), 'prop-unlocked-'),
        );
        const localChats = path.join(localTemp, 'chats');
        fs.mkdirSync(localChats, { recursive: true });

        try {
          for (let i = 0; i < count; i++) {
            const id = `unlocked-${i}-${Date.now()}`;
            const ts = new Date(Date.now() - i * 1000).toISOString();
            const sessionPath = writeSessionFile(localChats, id, ts);
            const entry = makeEntry(sessionPath, id);

            const result = await shouldDeleteSession(entry);
            expect(result).toBe('delete');
          }
        } finally {
          fs.rmSync(localTemp, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 25 (property): cleanupStaleLocks on empty directory returns 0
     * @plan PLAN-20260211-SESSIONRECORDING.P16
     * @requirement REQ-CLN-004
     */
    it.prop([fc.nat({ max: 3 })], { numRuns: 10 })(
      'cleanupStaleLocks on directory with only session files (no locks) returns 0 @requirement:REQ-CLN-004',
      async (count) => {
        const localTemp = fs.mkdtempSync(
          path.join(os.tmpdir(), 'prop-nolocks-'),
        );
        const localChats = path.join(localTemp, 'chats');
        fs.mkdirSync(localChats, { recursive: true });

        try {
          for (let i = 0; i < count; i++) {
            const id = `nolocks-${i}-${Date.now()}`;
            const ts = new Date(Date.now() - i * 1000).toISOString();
            writeSessionFile(localChats, id, ts);
          }

          const cleaned = await cleanupStaleLocks(localChats);
          expect(cleaned).toBe(0);
        } finally {
          fs.rmSync(localTemp, { recursive: true, force: true });
        }
      },
    );
  });
});
