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
 * @plan PLAN-20260211-SESSIONRECORDING.P19
 * @requirement REQ-RSM-003
 *
 * Behavioral and property-based tests for SessionDiscovery. Tests use real
 * SessionRecordingService instances to create genuine session JSONL files
 * in real temp directories — no mock theater.
 *
 * Property-based tests use @fast-check/vitest (≥30% of total tests).
 * All tests expect real behavior. They will fail against the Phase 18 stub
 * — that is correct TDD.
 */

import { describe, expect, beforeEach, afterEach } from 'vitest';
import { it } from '@fast-check/vitest';
import * as fc from 'fast-check';
import * as fs from 'node:fs/promises';
import * as fsSyncModule from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionRecordingService } from './SessionRecordingService.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import { type SessionRecordingServiceConfig } from './types.js';
import { type IContent } from '../services/history/IContent.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROJECT_HASH = 'test-project-hash-discovery';

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
    contents?: IContent[];
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

  const contents = opts.contents ?? [makeContent('hello')];
  for (const content of contents) {
    svc.recordContent(content);
  }
  await svc.flush();

  const filePath = svc.getFilePath()!;
  svc.dispose();
  return { filePath, sessionId };
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

describe('SessionDiscovery @plan:PLAN-20260211-SESSIONRECORDING.P19', () => {
  let tempDir: string;
  let chatsDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'session-discovery-test-'),
    );
    chatsDir = path.join(tempDir, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // listSessions — Behavioral Tests
  // -------------------------------------------------------------------------

  describe('listSessions @requirement:REQ-RSM-003 @plan:PLAN-20260211-SESSIONRECORDING.P19', () => {
    /**
     * Test 1: listSessions finds matching project sessions
     * GIVEN: 3 sessions with matching hash, 1 with different hash
     * WHEN: listSessions is called with matching hash
     * THEN: Returns 3 SessionSummary objects
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-003
     */
    it('finds sessions matching the given project hash', async () => {
      // Create 3 sessions with matching hash
      await createTestSession(chatsDir, { projectHash: PROJECT_HASH });
      await delay(50);
      await createTestSession(chatsDir, { projectHash: PROJECT_HASH });
      await delay(50);
      await createTestSession(chatsDir, { projectHash: PROJECT_HASH });
      // Create 1 session with different hash
      await createTestSession(chatsDir, {
        projectHash: 'other-project-hash',
      });

      const sessions = await SessionDiscovery.listSessions(
        chatsDir,
        PROJECT_HASH,
      );
      expect(sessions).toHaveLength(3);
      for (const session of sessions) {
        expect(session.projectHash).toBe(PROJECT_HASH);
      }
    });

    /**
     * Test 2: listSessions sorts newest-first
     * GIVEN: 3 sessions created with staggered times
     * WHEN: listSessions is called
     * THEN: First result is the most recently modified
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-003
     */
    it('returns sessions sorted newest-first by mtime', async () => {
      const _s1 = await createTestSession(chatsDir, {
        sessionId: 'session-oldest',
        projectHash: PROJECT_HASH,
      });
      await delay(100);
      const _s2 = await createTestSession(chatsDir, {
        sessionId: 'session-middle',
        projectHash: PROJECT_HASH,
      });
      await delay(100);
      const _s3 = await createTestSession(chatsDir, {
        sessionId: 'session-newest',
        projectHash: PROJECT_HASH,
      });

      const sessions = await SessionDiscovery.listSessions(
        chatsDir,
        PROJECT_HASH,
      );
      expect(sessions).toHaveLength(3);
      expect(sessions[0].sessionId).toBe('session-newest');
      expect(sessions[1].sessionId).toBe('session-middle');
      expect(sessions[2].sessionId).toBe('session-oldest');
    });

    /**
     * Test 3: listSessions returns empty for no matches
     * GIVEN: Sessions only with a different project hash
     * WHEN: listSessions is called with a non-matching hash
     * THEN: Returns []
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-003
     */
    it('returns empty array when no sessions match the project hash', async () => {
      await createTestSession(chatsDir, {
        projectHash: 'completely-different-hash',
      });

      const sessions = await SessionDiscovery.listSessions(
        chatsDir,
        'non-existent-hash',
      );
      expect(sessions).toEqual([]);
    });

    /**
     * Test 4: listSessions returns empty for non-existent dir
     * GIVEN: A chatsDir that does not exist
     * WHEN: listSessions is called
     * THEN: Returns []
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-003
     */
    it('returns empty array for non-existent directory', async () => {
      const sessions = await SessionDiscovery.listSessions(
        path.join(tempDir, 'nonexistent-dir'),
        PROJECT_HASH,
      );
      expect(sessions).toEqual([]);
    });

    /**
     * Test 5: listSessions reads session metadata from header
     * GIVEN: A session with specific provider, model, and sessionId
     * WHEN: listSessions is called
     * THEN: Returned SessionSummary has correct provider, model, sessionId
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-003
     */
    it('reads session metadata from header event', async () => {
      const sessionId = 'metadata-check-session-id';
      await createTestSession(chatsDir, {
        sessionId,
        projectHash: PROJECT_HASH,
        provider: 'google',
        model: 'gemini-3',
      });

      const sessions = await SessionDiscovery.listSessions(
        chatsDir,
        PROJECT_HASH,
      );
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe(sessionId);
      expect(sessions[0].provider).toBe('google');
      expect(sessions[0].model).toBe('gemini-3');
      expect(sessions[0].projectHash).toBe(PROJECT_HASH);
      expect(sessions[0].filePath).toBeTruthy();
      expect(sessions[0].lastModified).toBeInstanceOf(Date);
      expect(sessions[0].fileSize).toBeGreaterThan(0);
      expect(typeof sessions[0].startTime).toBe('string');
    });

    /**
     * Addendum test: First-line overflow falls back to streaming header reader
     * GIVEN: A valid session file whose first line exceeds the 4096-byte fast-read buffer
     * WHEN: listSessions is called
     * THEN: Session is still discovered and metadata is parsed correctly
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-003
     */
    it('discovers sessions when session_start header exceeds fast-read buffer', async () => {
      const sessionId = 'long-header-session-id';
      const { filePath } = await createTestSession(chatsDir, {
        sessionId,
        projectHash: PROJECT_HASH,
        provider: 'google',
        model: 'gemini-3',
      });

      const raw = await fs.readFile(filePath, 'utf-8');
      const [firstLine, ...restLines] = raw.split('\n');
      const firstEvent = JSON.parse(firstLine) as {
        v: number;
        seq: number;
        ts: string;
        type: string;
        payload: {
          sessionId: string;
          projectHash: string;
          workspaceDirs: string[];
          provider: string;
          model: string;
          startTime: string;
        };
      };

      firstEvent.payload.workspaceDirs = ['/tmp/' + 'x'.repeat(5000)];
      const oversizedFirstLine = JSON.stringify(firstEvent);
      expect(oversizedFirstLine.length).toBeGreaterThan(4096);

      await fs.writeFile(
        filePath,
        [oversizedFirstLine, ...restLines].join('\n'),
      );

      const sessions = await SessionDiscovery.listSessions(
        chatsDir,
        PROJECT_HASH,
      );
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe(sessionId);
      expect(sessions[0].provider).toBe('google');
      expect(sessions[0].model).toBe('gemini-3');
    });

    /**
     * Addendum test: Identical mtime selects lexicographically greater session ID
     * GIVEN: Two sessions with identical mtime
     * WHEN: listSessions is called
     * THEN: First element has lexicographically greater sessionId
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-003
     */
    it('uses session ID descending as tiebreaker when mtime is identical', async () => {
      const s1 = await createTestSession(chatsDir, {
        sessionId: 'aaa11111',
        projectHash: PROJECT_HASH,
      });
      const s2 = await createTestSession(chatsDir, {
        sessionId: 'zzz99999',
        projectHash: PROJECT_HASH,
      });

      // Set identical mtime on both files
      const identicalTime = new Date('2026-02-11T12:00:00.000Z');
      fsSyncModule.utimesSync(s1.filePath, identicalTime, identicalTime);
      fsSyncModule.utimesSync(s2.filePath, identicalTime, identicalTime);

      const sessions = await SessionDiscovery.listSessions(
        chatsDir,
        PROJECT_HASH,
      );
      expect(sessions).toHaveLength(2);
      expect(sessions[0].sessionId).toBe('zzz99999');
      expect(sessions[1].sessionId).toBe('aaa11111');
    });
  });

  // -------------------------------------------------------------------------
  // resolveSessionRef — Behavioral Tests
  // -------------------------------------------------------------------------

  describe('resolveSessionRef @requirement:REQ-RSM-002 @plan:PLAN-20260211-SESSIONRECORDING.P19', () => {
    /**
     * Test 6: resolveSessionRef by exact ID
     * GIVEN: Session with known ID exists
     * WHEN: resolveSessionRef is called with exact ID
     * THEN: Returns the correct session
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-002
     */
    it('resolves a session by exact ID', async () => {
      const targetId = 'exact-match-target-id';
      await createTestSession(chatsDir, {
        sessionId: targetId,
        projectHash: PROJECT_HASH,
      });
      await createTestSession(chatsDir, {
        sessionId: 'other-session-id',
        projectHash: PROJECT_HASH,
      });

      const sessions = await SessionDiscovery.listSessions(
        chatsDir,
        PROJECT_HASH,
      );
      const result = SessionDiscovery.resolveSessionRef(targetId, sessions);

      expect('session' in result).toBe(true);
      if ('session' in result) {
        expect(result.session.sessionId).toBe(targetId);
      }
    });

    /**
     * Test 7: resolveSessionRef by prefix
     * GIVEN: Session with ID "abcdef123456" exists
     * WHEN: resolveSessionRef("abcdef12") is called
     * THEN: Returns the matching session
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-002
     */
    it('resolves a session by unique prefix', async () => {
      const targetId = 'abcdef123456';
      await createTestSession(chatsDir, {
        sessionId: targetId,
        projectHash: PROJECT_HASH,
      });
      await createTestSession(chatsDir, {
        sessionId: 'xyz789-other',
        projectHash: PROJECT_HASH,
      });

      const sessions = await SessionDiscovery.listSessions(
        chatsDir,
        PROJECT_HASH,
      );
      const result = SessionDiscovery.resolveSessionRef('abcdef12', sessions);

      expect('session' in result).toBe(true);
      if ('session' in result) {
        expect(result.session.sessionId).toBe(targetId);
      }
    });

    /**
     * Test 8: resolveSessionRef ambiguous prefix → error
     * GIVEN: Two sessions with IDs "ab12cd" and "ab34ef"
     * WHEN: resolveSessionRef("ab") is called
     * THEN: Error with both matching IDs
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-003
     */
    it('returns error for ambiguous prefix matching multiple sessions', async () => {
      await createTestSession(chatsDir, {
        sessionId: 'ab12cd-session',
        projectHash: PROJECT_HASH,
      });
      await createTestSession(chatsDir, {
        sessionId: 'ab34ef-session',
        projectHash: PROJECT_HASH,
      });

      const sessions = await SessionDiscovery.listSessions(
        chatsDir,
        PROJECT_HASH,
      );
      const result = SessionDiscovery.resolveSessionRef('ab', sessions);

      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toContain('ab12cd');
        expect(result.error).toContain('ab34ef');
      }
    });

    /**
     * Test 9: resolveSessionRef by numeric index
     * GIVEN: 3 sessions sorted newest-first
     * WHEN: resolveSessionRef("1") is called
     * THEN: Returns the first (newest) session
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-002
     */
    it('resolves numeric index "1" to the first (newest) session', async () => {
      await createTestSession(chatsDir, {
        sessionId: 'oldest-session',
        projectHash: PROJECT_HASH,
      });
      await delay(50);
      await createTestSession(chatsDir, {
        sessionId: 'middle-session',
        projectHash: PROJECT_HASH,
      });
      await delay(50);
      await createTestSession(chatsDir, {
        sessionId: 'newest-session',
        projectHash: PROJECT_HASH,
      });

      const sessions = await SessionDiscovery.listSessions(
        chatsDir,
        PROJECT_HASH,
      );
      const result = SessionDiscovery.resolveSessionRef('1', sessions);

      expect('session' in result).toBe(true);
      if ('session' in result) {
        expect(result.session.sessionId).toBe('newest-session');
      }
    });

    /**
     * Test 10: resolveSessionRef not found → error
     * GIVEN: No session matching the provided ref
     * WHEN: resolveSessionRef("nonexistent") is called
     * THEN: Returns error
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-002
     */
    it('returns error when session ref does not match any session', async () => {
      await createTestSession(chatsDir, { projectHash: PROJECT_HASH });

      const sessions = await SessionDiscovery.listSessions(
        chatsDir,
        PROJECT_HASH,
      );
      const result = SessionDiscovery.resolveSessionRef(
        'nonexistent-id',
        sessions,
      );

      expect('error' in result).toBe(true);
    });

    /**
     * Addendum test: Numeric-looking session ID prefix vs. index resolution
     * GIVEN: 3 sessions, one with ID starting with "123"
     * WHEN: resolveSessionRef("1") is called
     * THEN: Resolves as numeric index 1 (newest), NOT prefix match
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-003
     */
    it('treats pure digit strings as numeric indices, not prefix matches', async () => {
      await createTestSession(chatsDir, {
        sessionId: '123abc-session',
        projectHash: PROJECT_HASH,
      });
      await delay(50);
      await createTestSession(chatsDir, {
        sessionId: '456def-session',
        projectHash: PROJECT_HASH,
      });
      await delay(50);
      // This is the most recent (index 1)
      await createTestSession(chatsDir, {
        sessionId: '789ghi-session',
        projectHash: PROJECT_HASH,
      });

      const sessions = await SessionDiscovery.listSessions(
        chatsDir,
        PROJECT_HASH,
      );
      const result = SessionDiscovery.resolveSessionRef('1', sessions);

      expect('session' in result).toBe(true);
      if ('session' in result) {
        // Should be the newest (index 1), not the one starting with "1"
        expect(result.session.sessionId).toBe('789ghi-session');
      }
    });

    /**
     * Addendum test: Exact session ID match takes precedence over prefix
     * GIVEN: Two sessions with IDs "abc" and "abcdef"
     * WHEN: resolveSessionRef("abc") is called
     * THEN: Returns "abc" (exact match), not ambiguous error
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-003
     */
    it('exact match takes precedence over prefix match', async () => {
      await createTestSession(chatsDir, {
        sessionId: 'abc',
        projectHash: PROJECT_HASH,
      });
      await createTestSession(chatsDir, {
        sessionId: 'abcdef',
        projectHash: PROJECT_HASH,
      });

      const sessions = await SessionDiscovery.listSessions(
        chatsDir,
        PROJECT_HASH,
      );
      const result = SessionDiscovery.resolveSessionRef('abc', sessions);

      expect('session' in result).toBe(true);
      if ('session' in result) {
        expect(result.session.sessionId).toBe('abc');
      }
    });
  });

  // -------------------------------------------------------------------------
  // readSessionHeader
  // -------------------------------------------------------------------------

  describe('readSessionHeader @plan:PLAN-20260211-SESSIONRECORDING.P19', () => {
    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-003
     */
    it('reads session_start payload from valid JSONL file', async () => {
      const sessionId = 'header-read-test';
      const { filePath } = await createTestSession(chatsDir, {
        sessionId,
        projectHash: PROJECT_HASH,
        provider: 'openai',
        model: 'gpt-5',
      });

      const header = await SessionDiscovery.readSessionHeader(filePath);
      expect(header).not.toBeNull();
      expect(header!.sessionId).toBe(sessionId);
      expect(header!.projectHash).toBe(PROJECT_HASH);
      expect(header!.provider).toBe('openai');
      expect(header!.model).toBe('gpt-5');
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-003
     */
    it('returns null for non-existent file', async () => {
      const header = await SessionDiscovery.readSessionHeader(
        path.join(chatsDir, 'nonexistent.jsonl'),
      );
      expect(header).toBeNull();
    });
  });

  // =========================================================================
  // Property-Based Tests (≥30% of total)
  // =========================================================================

  describe('Property-Based Tests @plan:PLAN-20260211-SESSIONRECORDING.P19', () => {
    /**
     * Test 24: Discovery finds all sessions matching any valid projectHash
     * fc.uuid for hash, create N sessions, verify count matches
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-003
     */
    it.prop([fc.integer({ min: 1, max: 5 })])(
      'finds all N sessions for a random project hash @requirement:REQ-RSM-003',
      async (sessionCount) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-discovery-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const hash = crypto.randomUUID();
          for (let i = 0; i < sessionCount; i++) {
            await createTestSession(localChatsDir, { projectHash: hash });
            if (i < sessionCount - 1) await delay(20);
          }

          const sessions = await SessionDiscovery.listSessions(
            localChatsDir,
            hash,
          );
          expect(sessions).toHaveLength(sessionCount);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 25: resolveSessionRef always finds exact match when present
     * fc.uuid for sessionId, create session, resolve → found
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-002
     */
    it.prop([fc.uuid()])(
      'resolveSessionRef always finds exact match for any UUID @requirement:REQ-RSM-002',
      async (sessionId) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-resolve-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          await createTestSession(localChatsDir, {
            sessionId,
            projectHash: PROJECT_HASH,
          });

          const sessions = await SessionDiscovery.listSessions(
            localChatsDir,
            PROJECT_HASH,
          );
          const result = SessionDiscovery.resolveSessionRef(
            sessionId,
            sessions,
          );

          expect('session' in result).toBe(true);
          if ('session' in result) {
            expect(result.session.sessionId).toBe(sessionId);
          }
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 27: Session ordering is consistent regardless of creation count
     * fc.nat(1-10) sessions, verify newest always first
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-003
     */
    it.prop([fc.integer({ min: 2, max: 6 })])(
      'newest session is always first regardless of count @requirement:REQ-RSM-003',
      async (sessionCount) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-order-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const sessions: Array<{ sessionId: string }> = [];
          for (let i = 0; i < sessionCount; i++) {
            const sessionId = `session-${String(i).padStart(4, '0')}`;
            await createTestSession(localChatsDir, {
              sessionId,
              projectHash: PROJECT_HASH,
            });
            sessions.push({ sessionId });
            if (i < sessionCount - 1) await delay(50);
          }

          const discovered = await SessionDiscovery.listSessions(
            localChatsDir,
            PROJECT_HASH,
          );
          expect(discovered).toHaveLength(sessionCount);

          // The last created session should be first (newest)
          expect(discovered[0].sessionId).toBe(
            sessions[sessions.length - 1].sessionId,
          );
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 30: Discovery returns empty array for any non-matching hash
     * fc.uuid for hash, create sessions with different hash, verify empty
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-003
     */
    it.prop([fc.uuid(), fc.uuid()])(
      'returns empty for any non-matching hash @requirement:REQ-RSM-003',
      async (createHash, queryHash) => {
        // Ensure hashes are different
        fc.pre(createHash !== queryHash);

        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-empty-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          await createTestSession(localChatsDir, {
            projectHash: createHash,
          });

          const sessions = await SessionDiscovery.listSessions(
            localChatsDir,
            queryHash,
          );
          expect(sessions).toEqual([]);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 31: resolveSessionRef by numeric index always works within range
     * fc.nat(1-N) for N sessions, verify correct session resolved
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-002
     */
    it.prop([fc.integer({ min: 1, max: 5 })])(
      'numeric index within range always resolves correctly @requirement:REQ-RSM-002',
      async (sessionCount) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-index-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          for (let i = 0; i < sessionCount; i++) {
            await createTestSession(localChatsDir, {
              projectHash: PROJECT_HASH,
            });
            if (i < sessionCount - 1) await delay(50);
          }

          const sessions = await SessionDiscovery.listSessions(
            localChatsDir,
            PROJECT_HASH,
          );

          // Every valid index 1..N should resolve
          for (let idx = 1; idx <= sessionCount; idx++) {
            const result = SessionDiscovery.resolveSessionRef(
              String(idx),
              sessions,
            );
            expect('session' in result).toBe(true);
            if ('session' in result) {
              expect(result.session.sessionId).toBe(
                sessions[idx - 1].sessionId,
              );
            }
          }
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Addendum property test: Tiebreaker is deterministic for any two session IDs
     * with same mtime
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-003
     */
    it.prop([
      fc.tuple(
        fc.stringMatching(/^[0-9a-f]{8}$/),
        fc.stringMatching(/^[0-9a-f]{8}$/),
      ),
    ])(
      'mtime tiebreaker is deterministic for any two session IDs @requirement:REQ-RSM-003',
      async ([idA, idB]) => {
        fc.pre(idA !== idB);

        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-tiebreak-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const sA = await createTestSession(localChatsDir, {
            sessionId: idA,
            projectHash: PROJECT_HASH,
          });
          const sB = await createTestSession(localChatsDir, {
            sessionId: idB,
            projectHash: PROJECT_HASH,
          });

          // Set identical mtime
          const sameTime = new Date('2026-01-01T00:00:00.000Z');
          fsSyncModule.utimesSync(sA.filePath, sameTime, sameTime);
          fsSyncModule.utimesSync(sB.filePath, sameTime, sameTime);

          const result1 = await SessionDiscovery.listSessions(
            localChatsDir,
            PROJECT_HASH,
          );
          const result2 = await SessionDiscovery.listSessions(
            localChatsDir,
            PROJECT_HASH,
          );

          // Same order both times
          expect(result1.map((s) => s.sessionId)).toEqual(
            result2.map((s) => s.sessionId),
          );

          // First result has lexicographically greater session ID
          expect(result1).toHaveLength(2);
          const expectedFirst = idA.localeCompare(idB) > 0 ? idA : idB;
          expect(result1[0].sessionId).toBe(expectedFirst);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );
  });
});
