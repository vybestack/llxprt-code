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
 * @plan PLAN-20260211-SESSIONRECORDING.P22
 * @requirement REQ-MGT-001, REQ-MGT-002, REQ-MGT-003, REQ-MGT-004
 *
 * Behavioral and property-based tests for session management (listSessions
 * and deleteSession). Tests use real SessionRecordingService instances to
 * create genuine session JSONL files in real temp directories — no mock
 * theater.
 *
 * Property-based tests use @fast-check/vitest (≥30% of total tests).
 */

import { describe, expect, beforeEach, afterEach } from 'vitest';
import { it } from '@fast-check/vitest';
import * as fc from 'fast-check';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionRecordingService } from './SessionRecordingService.js';
import { SessionLockManager } from './SessionLockManager.js';
import { listSessions, deleteSession } from './sessionManagement.js';
import { type SessionRecordingServiceConfig } from './types.js';
import { type IContent } from '../services/history/IContent.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROJECT_HASH = 'test-project-hash-mgmt';

/** Dead PID that is almost certainly not running. */
const DEAD_PID = 999999999;

function makeConfig(
  chatsDir: string,
  overrides: Partial<SessionRecordingServiceConfig> = {},
): SessionRecordingServiceConfig {
  return {
    sessionId: overrides.sessionId ?? crypto.randomUUID(),
    projectHash: overrides.projectHash ?? PROJECT_HASH,
    chatsDir,
    workspaceDirs: overrides.workspaceDirs ?? ['/test/workspace'],
    provider: overrides.provider ?? 'anthropic',
    model: overrides.model ?? 'claude-4',
  };
}

function makeContent(
  text: string,
  speaker: IContent['speaker'] = 'human',
): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

/**
 * Create a real session file using SessionRecordingService, flush it,
 * and return its file path and sessionId.
 */
async function createTestSession(
  chatsDir: string,
  opts: {
    sessionId?: string;
    projectHash?: string;
    provider?: string;
    model?: string;
  } = {},
): Promise<{ filePath: string; sessionId: string }> {
  const sessionId = opts.sessionId ?? crypto.randomUUID();
  const config = makeConfig(chatsDir, {
    sessionId,
    projectHash: opts.projectHash,
    provider: opts.provider,
    model: opts.model,
  });
  const svc = new SessionRecordingService(config);
  svc.recordContent(makeContent('hello'));
  await svc.flush();
  const filePath = svc.getFilePath()!;
  svc.dispose();
  return { filePath, sessionId };
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
 * Write a fake lock file with the given PID.
 */
async function writeFakeLock(
  lockPath: string,
  pid: number,
  sessionId = 'fake-session',
): Promise<void> {
  const content = JSON.stringify({
    pid,
    timestamp: new Date().toISOString(),
    sessionId,
  });
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(lockPath, content, 'utf-8');
}

/**
 * Small delay to ensure distinct mtime values between file creations.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('sessionManagement @plan:PLAN-20260211-SESSIONRECORDING.P22', () => {
  let tempDir: string;
  let chatsDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-mgmt-test-'));
    chatsDir = path.join(tempDir, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // =========================================================================
  // listSessions — Behavioral Tests
  // =========================================================================

  describe('listSessions @requirement:REQ-MGT-001 @plan:PLAN-20260211-SESSIONRECORDING.P22', () => {
    /**
     * Test 1: listSessions returns session data for all matching sessions
     * GIVEN: 3 session files for the current project
     * WHEN: listSessions() is called
     * THEN: Result contains 3 SessionSummary objects
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P22
     * @requirement REQ-MGT-001
     */
    it('returns session data for all matching sessions', async () => {
      await createTestSession(chatsDir);
      await delay(50);
      await createTestSession(chatsDir);
      await delay(50);
      await createTestSession(chatsDir);

      const result = await listSessions(chatsDir, PROJECT_HASH);
      expect(result.sessions).toHaveLength(3);
      for (const session of result.sessions) {
        expect(session.projectHash).toBe(PROJECT_HASH);
      }
    });

    /**
     * Test 2: List sessions sorted newest-first
     * GIVEN: Sessions created with different timestamps
     * WHEN: listSessions() is called
     * THEN: Output order matches newest-first
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P22
     * @requirement REQ-MGT-001
     */
    it('returns sessions sorted newest-first by mtime', async () => {
      await createTestSession(chatsDir, { sessionId: 'oldest-session' });
      await delay(100);
      await createTestSession(chatsDir, { sessionId: 'middle-session' });
      await delay(100);
      await createTestSession(chatsDir, { sessionId: 'newest-session' });

      const result = await listSessions(chatsDir, PROJECT_HASH);
      expect(result.sessions).toHaveLength(3);
      expect(result.sessions[0].sessionId).toBe('newest-session');
      expect(result.sessions[1].sessionId).toBe('middle-session');
      expect(result.sessions[2].sessionId).toBe('oldest-session');
    });

    /**
     * Test 3: List sessions with correct metadata
     * GIVEN: A session with known provider, model, sessionId
     * WHEN: listSessions() is called
     * THEN: Returned SessionSummary has correct provider, model, sessionId, size
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P22
     * @requirement REQ-MGT-001
     */
    it('returns sessions with correct metadata fields', async () => {
      const sessionId = 'metadata-test-session';
      await createTestSession(chatsDir, {
        sessionId,
        provider: 'google',
        model: 'gemini-3',
      });

      const result = await listSessions(chatsDir, PROJECT_HASH);
      expect(result.sessions).toHaveLength(1);

      const session = result.sessions[0];
      expect(session.sessionId).toBe(sessionId);
      expect(session.provider).toBe('google');
      expect(session.model).toBe('gemini-3');
      expect(session.projectHash).toBe(PROJECT_HASH);
      expect(session.fileSize).toBeGreaterThan(0);
      expect(session.lastModified).toBeInstanceOf(Date);
      expect(typeof session.startTime).toBe('string');
      expect(session.filePath).toContain('session-');
    });

    /**
     * Test 4: List sessions empty returns appropriate result
     * GIVEN: No session files exist
     * WHEN: listSessions() is called
     * THEN: Returns empty sessions array
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P22
     * @requirement REQ-MGT-001
     */
    it('returns empty sessions array when no sessions exist', async () => {
      const result = await listSessions(chatsDir, PROJECT_HASH);
      expect(result.sessions).toEqual([]);
    });

    /**
     * Test 5: listSessions wraps SessionDiscovery result in ListSessionsResult
     * GIVEN: Sessions exist
     * WHEN: listSessions() is called
     * THEN: Returns object with .sessions property containing SessionSummary[]
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P22
     * @requirement REQ-MGT-001
     */
    it('wraps discovery result in ListSessionsResult with sessions property', async () => {
      await createTestSession(chatsDir);
      await createTestSession(chatsDir, {
        projectHash: 'other-project',
      });

      const result = await listSessions(chatsDir, PROJECT_HASH);
      expect(result).toHaveProperty('sessions');
      expect(Array.isArray(result.sessions)).toBe(true);
      // Only the matching-project session
      expect(result.sessions).toHaveLength(1);
    });
  });

  // =========================================================================
  // deleteSession — Behavioral Tests
  // =========================================================================

  describe('deleteSession @requirement:REQ-MGT-002 @plan:PLAN-20260211-SESSIONRECORDING.P22', () => {
    /**
     * Test 6: deleteSession by exact ID removes file from disk
     * GIVEN: Session "a1b2c3d4" exists on disk
     * WHEN: deleteSession("a1b2c3d4") is called
     * THEN: Session file is deleted, result is ok with deletedSessionId
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P22
     * @requirement REQ-MGT-002
     */
    it('deletes session by exact ID and removes file from disk', async () => {
      const sessionId = 'a1b2c3d4-test-session';
      const { filePath } = await createTestSession(chatsDir, { sessionId });
      expect(await fileExists(filePath)).toBe(true);

      const result = await deleteSession(sessionId, chatsDir, PROJECT_HASH);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.deletedSessionId).toBe(sessionId);
      }
      expect(await fileExists(filePath)).toBe(false);
    });

    /**
     * Test 7: deleteSession by prefix
     * GIVEN: Session with ID "abcdef12-3456-7890" exists
     * WHEN: deleteSession("abcdef12") is called
     * THEN: Correct file removed
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P22
     * @requirement REQ-MGT-002
     */
    it('deletes session by unique prefix', async () => {
      const sessionId = 'abcdef12-3456-7890-unique';
      const { filePath } = await createTestSession(chatsDir, { sessionId });
      // Create another with different prefix so there's no ambiguity
      await createTestSession(chatsDir, {
        sessionId: 'xyz98765-other-session',
      });

      const result = await deleteSession('abcdef12', chatsDir, PROJECT_HASH);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.deletedSessionId).toBe(sessionId);
      }
      expect(await fileExists(filePath)).toBe(false);
    });

    /**
     * Test 8: deleteSession by numeric index
     * GIVEN: 3 sessions (newest-first sorted)
     * WHEN: deleteSession("1") is called
     * THEN: Removes the first (newest) session
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P22
     * @requirement REQ-MGT-002
     */
    it('deletes session by numeric index (1 = newest)', async () => {
      await createTestSession(chatsDir, { sessionId: 'oldest-del' });
      await delay(100);
      await createTestSession(chatsDir, { sessionId: 'middle-del' });
      await delay(100);
      const { filePath: newestPath } = await createTestSession(chatsDir, {
        sessionId: 'newest-del',
      });

      const result = await deleteSession('1', chatsDir, PROJECT_HASH);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.deletedSessionId).toBe('newest-del');
      }
      expect(await fileExists(newestPath)).toBe(false);
    });

    /**
     * Test 9: Delete removes .lock sidecar too
     * GIVEN: Session file and a .lock sidecar both exist
     * WHEN: deleteSession() is called
     * THEN: Both .jsonl and .lock files are removed
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P22
     * @requirement REQ-MGT-002
     */
    it('removes lock sidecar file alongside session file', async () => {
      const sessionId = 'sidecar-lock-test';
      const { filePath } = await createTestSession(chatsDir, { sessionId });

      // Create a stale lock file (dead PID so deletion can proceed)
      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
      await writeFakeLock(lockPath, DEAD_PID, sessionId);
      expect(await fileExists(lockPath)).toBe(true);

      const result = await deleteSession(sessionId, chatsDir, PROJECT_HASH);

      expect(result.ok).toBe(true);
      expect(await fileExists(filePath)).toBe(false);
      expect(await fileExists(lockPath)).toBe(false);
    });

    /**
     * Test 14: Delete result includes the session ID that was deleted
     * GIVEN: A session exists
     * WHEN: deleteSession() succeeds
     * THEN: Result contains the deletedSessionId matching the target
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P22
     * @requirement REQ-MGT-002
     */
    it('returns the deleted session ID in the result', async () => {
      const sessionId = 'confirmation-id-test';
      await createTestSession(chatsDir, { sessionId });

      const result = await deleteSession(sessionId, chatsDir, PROJECT_HASH);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.deletedSessionId).toBe(sessionId);
      }
    });
  });

  // =========================================================================
  // deleteSession — Lock & Error Cases
  // =========================================================================

  describe('deleteSession lock checking @requirement:REQ-MGT-003 @plan:PLAN-20260211-SESSIONRECORDING.P22', () => {
    /**
     * Test 10: Delete locked session fails
     * GIVEN: Session is locked by the current process
     * WHEN: deleteSession() attempts deletion
     * THEN: Returns error "Cannot delete: session is in use by another process"
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P22
     * @requirement REQ-MGT-003
     */
    it('refuses to delete a session locked by a live process', async () => {
      const sessionId = 'locked-session-test';
      const { filePath } = await createTestSession(chatsDir, { sessionId });

      // Acquire a real lock (current process PID)
      const lockHandle = await SessionLockManager.acquire(chatsDir, sessionId);

      try {
        const result = await deleteSession(sessionId, chatsDir, PROJECT_HASH);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toContain('in use');
        }
        // File should still exist
        expect(await fileExists(filePath)).toBe(true);
      } finally {
        await lockHandle.release();
      }
    });

    /**
     * Test 11: Delete stale-locked session succeeds
     * GIVEN: Session has a .lock with a dead PID (stale lock)
     * WHEN: deleteSession() is called
     * THEN: Stale lock removed, session deleted successfully
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P22
     * @requirement REQ-MGT-004
     */
    it('deletes a session with a stale lock (dead PID)', async () => {
      const sessionId = 'stale-lock-test';
      const { filePath } = await createTestSession(chatsDir, { sessionId });

      // Create stale lock with dead PID
      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
      await writeFakeLock(lockPath, DEAD_PID, sessionId);
      expect(await fileExists(lockPath)).toBe(true);

      const result = await deleteSession(sessionId, chatsDir, PROJECT_HASH);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.deletedSessionId).toBe(sessionId);
      }
      expect(await fileExists(filePath)).toBe(false);
      expect(await fileExists(lockPath)).toBe(false);
    });

    /**
     * Test 12: Delete non-existent session fails
     * GIVEN: No session matches the given ID
     * WHEN: deleteSession("nonexistent-id") is called
     * THEN: Returns error with "not found" message
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P22
     * @requirement REQ-MGT-002
     */
    it('returns error when session ID does not exist', async () => {
      // Create a session so the directory isn't empty
      await createTestSession(chatsDir);

      const result = await deleteSession(
        'nonexistent-id',
        chatsDir,
        PROJECT_HASH,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('not found');
      }
    });

    /**
     * Test 13: Delete from empty directory fails
     * GIVEN: No session files in the chats directory
     * WHEN: deleteSession() is called
     * THEN: Returns error about no sessions found
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P22
     * @requirement REQ-MGT-002
     */
    it('returns error when no sessions exist for the project', async () => {
      const result = await deleteSession('any-ref', chatsDir, PROJECT_HASH);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('No sessions found');
      }
    });
  });

  // =========================================================================
  // Property-Based Tests (≥30% of total — 7 property tests)
  // =========================================================================

  describe('Property-Based Tests @plan:PLAN-20260211-SESSIONRECORDING.P22', () => {
    /**
     * Test 15: listSessions returns correct count for any number of sessions
     * fc.nat(0-10) sessions, verify result has correct count
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P22
     * @requirement REQ-MGT-001
     */
    it.prop([fc.integer({ min: 0, max: 8 })])(
      'listSessions returns correct session count for any N @requirement:REQ-MGT-001',
      async (sessionCount) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-mgmt-count-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const hash = crypto.randomUUID();
          for (let i = 0; i < sessionCount; i++) {
            await createTestSession(localChatsDir, { projectHash: hash });
            if (i < sessionCount - 1) await delay(20);
          }

          const result = await listSessions(localChatsDir, hash);
          expect(result.sessions).toHaveLength(sessionCount);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 16: Delete always removes both .jsonl and .lock
     * fc.boolean for lock file existence, create files, delete → verify both gone
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P22
     * @requirement REQ-MGT-002
     */
    it.prop([fc.boolean()])(
      'delete always removes session file and any lock sidecar @requirement:REQ-MGT-002',
      async (hasLock) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-mgmt-delete-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const sessionId = crypto.randomUUID();
          const { filePath } = await createTestSession(localChatsDir, {
            sessionId,
            projectHash: PROJECT_HASH,
          });

          const lockPath = SessionLockManager.getLockPath(
            localChatsDir,
            sessionId,
          );
          if (hasLock) {
            // Stale lock so deletion proceeds
            await writeFakeLock(lockPath, DEAD_PID, sessionId);
          }

          const result = await deleteSession(
            sessionId,
            localChatsDir,
            PROJECT_HASH,
          );

          expect(result.ok).toBe(true);
          expect(await fileExists(filePath)).toBe(false);
          expect(await fileExists(lockPath)).toBe(false);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 17: List always returns sessions sorted by mtime (newest first)
     * fc.integer(2-6) sessions with staggered creation, verify sorted
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P22
     * @requirement REQ-MGT-001
     */
    it.prop([fc.integer({ min: 2, max: 6 })])(
      'listSessions always returns sessions sorted newest-first @requirement:REQ-MGT-001',
      async (sessionCount) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-mgmt-sort-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          for (let i = 0; i < sessionCount; i++) {
            await createTestSession(localChatsDir);
            if (i < sessionCount - 1) await delay(50);
          }

          const result = await listSessions(localChatsDir, PROJECT_HASH);
          expect(result.sessions).toHaveLength(sessionCount);

          // Verify descending mtime order
          for (let i = 1; i < result.sessions.length; i++) {
            const prev = result.sessions[i - 1].lastModified.getTime();
            const curr = result.sessions[i].lastModified.getTime();
            expect(prev).toBeGreaterThanOrEqual(curr);
          }
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 18: resolveSessionRef via any valid index always works
     * fc.nat within range, verify correct session is deleted
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P22
     * @requirement REQ-MGT-002
     */
    it.prop([fc.integer({ min: 1, max: 5 })])(
      'deleteSession by any valid numeric index removes correct session @requirement:REQ-MGT-002',
      async (sessionCount) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-mgmt-index-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const createdSessions: Array<{
            sessionId: string;
            filePath: string;
          }> = [];
          for (let i = 0; i < sessionCount; i++) {
            const session = await createTestSession(localChatsDir);
            createdSessions.push(session);
            if (i < sessionCount - 1) await delay(50);
          }

          // List to get sorted order
          const listed = await listSessions(localChatsDir, PROJECT_HASH);
          expect(listed.sessions).toHaveLength(sessionCount);

          // Pick a random valid index (1-based)
          const targetIndex = ((sessionCount - 1) % sessionCount) + 1;
          const targetSession = listed.sessions[targetIndex - 1];

          const result = await deleteSession(
            String(targetIndex),
            localChatsDir,
            PROJECT_HASH,
          );

          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.deletedSessionId).toBe(targetSession.sessionId);
          }
          expect(await fileExists(targetSession.filePath)).toBe(false);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 19: Any valid session can be listed then deleted
     * fc.uuid for sessionIds, create, list, delete each by ID → all removed
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P22
     * @requirement REQ-MGT-001, REQ-MGT-002
     */
    it.prop([fc.uuid()])(
      'any session created with a UUID can be listed then deleted @requirement:REQ-MGT-002',
      async (sessionId) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-mgmt-lifecycle-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const { filePath } = await createTestSession(localChatsDir, {
            sessionId,
          });

          // Verify listed
          const listed = await listSessions(localChatsDir, PROJECT_HASH);
          expect(listed.sessions).toHaveLength(1);
          expect(listed.sessions[0].sessionId).toBe(sessionId);

          // Verify deleted
          const result = await deleteSession(
            sessionId,
            localChatsDir,
            PROJECT_HASH,
          );
          expect(result.ok).toBe(true);
          expect(await fileExists(filePath)).toBe(false);

          // Verify no longer listed
          const afterDelete = await listSessions(localChatsDir, PROJECT_HASH);
          expect(afterDelete.sessions).toHaveLength(0);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 20: listSessions returns fileSize > 0 for any session
     * fc.integer(1-5) sessions, verify all have positive fileSize
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P22
     * @requirement REQ-MGT-001
     */
    it.prop([fc.integer({ min: 1, max: 5 })])(
      'every listed session has a positive file size @requirement:REQ-MGT-001',
      async (sessionCount) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-mgmt-size-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          for (let i = 0; i < sessionCount; i++) {
            await createTestSession(localChatsDir);
            if (i < sessionCount - 1) await delay(20);
          }

          const result = await listSessions(localChatsDir, PROJECT_HASH);
          expect(result.sessions).toHaveLength(sessionCount);

          for (const session of result.sessions) {
            expect(session.fileSize).toBeGreaterThan(0);
          }
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 21: Delete non-existent session always fails for any invalid ref
     * fc.string for random refs that don't match any session, verify error
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P22
     * @requirement REQ-MGT-002
     */
    it.prop([
      fc.stringMatching(/^[a-z]{5,20}$/).filter((s) => !/^\d+$/.test(s)),
    ])(
      'delete always returns error for any non-matching ref @requirement:REQ-MGT-002',
      async (badRef) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-mgmt-notfound-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          // Create one session so dir isn't empty
          await createTestSession(localChatsDir, {
            sessionId: 'real-session-zzz999',
          });

          const result = await deleteSession(
            badRef,
            localChatsDir,
            PROJECT_HASH,
          );

          expect(result.ok).toBe(false);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );
  });
});
