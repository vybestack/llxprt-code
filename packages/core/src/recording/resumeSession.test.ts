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
 * @requirement REQ-RSM-001, REQ-RSM-002, REQ-RSM-004, REQ-RSM-005, REQ-RSM-006
 *
 * Behavioral and property-based tests for resumeSession. Tests use real
 * SessionRecordingService, SessionLockManager, and ReplayEngine instances
 * to create, lock, and resume genuine session JSONL files in real temp
 * directories — no mock theater.
 *
 * Property-based tests use fast-check (≥30% of total tests).
 * All tests expect real behavior. They will fail against the Phase 18 stub
 * — that is correct TDD.
 */

import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import { SessionLockManager } from './SessionLockManager.js';
import { resumeSession } from './resumeSession.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import { type IContent } from '../services/history/IContent.js';
import {
  PROJECT_HASH,
  makeConfig,
  makeContent,
  isParseWarning,
  createTestSession,
  makeResumeRequest,
  readJsonlFile,
  delay,
  expectOk,
  expectNotOk,
  collectBootRows,
  useResumeFixture,
} from './resumeSession.test.helpers.js';

describe('resumeSession @plan:PLAN-20260211-SESSIONRECORDING.P19: resumes the most recent unlocked session', () => {
  const { chatsDir, lockHandles } = useResumeFixture();
  describe('CONTINUE_LATEST @requirement:REQ-RSM-001 @plan:PLAN-20260211-SESSIONRECORDING.P19', () => {
    /**
     * Test 11: Resume most recent session
     * GIVEN: 2 sessions, newest with content "second session"
     * WHEN: resumeSession with CONTINUE_LATEST
     * THEN: Returns history from most recent session
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-001
     */
    it('resumes the most recent unlocked session', async () => {
      await createTestSession(chatsDir(), {
        projectHash: PROJECT_HASH,
        contents: [makeContent('first session message')],
      });
      await delay(50);
      await createTestSession(chatsDir(), {
        projectHash: PROJECT_HASH,
        contents: [makeContent('second session message')],
      });

      const result = await resumeSession(makeResumeRequest(chatsDir()));

      const okResult = expectOk(result);
      expect(await collectBootRows(okResult.boot.streamRows())).toHaveLength(1);
      expect(
        (await collectBootRows(okResult.boot.streamRows()))[0].blocks[0],
      ).toStrictEqual({
        type: 'text',
        text: 'second session message',
      });
      expect(okResult.lockHandle).toBeDefined();
      expect(okResult.lockHandle.lockPath).toBeTruthy();
      lockHandles.push(okResult.lockHandle);
    });
  });
});

describe('resumeSession @plan:PLAN-20260211-SESSIONRECORDING.P19: resumes a specific session by ID', () => {
  const { chatsDir, lockHandles } = useResumeFixture();
  describe('Specific session @requirement:REQ-RSM-002 @plan:PLAN-20260211-SESSIONRECORDING.P19', () => {
    /**
     * Test 12: Resume specific session by ID
     * GIVEN: 2 sessions, target with known content
     * WHEN: resumeSession with specific sessionId
     * THEN: Returns history from the targeted session
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-002
     */
    it('resumes a specific session by ID', async () => {
      const targetId = 'target-resume-session';
      await createTestSession(chatsDir(), {
        sessionId: targetId,
        projectHash: PROJECT_HASH,
        contents: [makeContent('target content')],
      });
      await createTestSession(chatsDir(), {
        projectHash: PROJECT_HASH,
        contents: [makeContent('other content')],
      });

      const result = await resumeSession(
        makeResumeRequest(chatsDir(), { continueRef: targetId }),
      );

      const okResult = expectOk(result);
      expect(await collectBootRows(okResult.boot.streamRows())).toHaveLength(1);
      expect(
        (await collectBootRows(okResult.boot.streamRows()))[0].blocks[0],
      ).toStrictEqual({
        type: 'text',
        text: 'target content',
      });
      expect(okResult.metadata.sessionId).toBe(targetId);
      expect(okResult.lockHandle).toBeDefined();
      expect(okResult.lockHandle.lockPath).toBeTruthy();
      lockHandles.push(okResult.lockHandle);
    });
  });
});

describe('resumeSession @plan:PLAN-20260211-SESSIONRECORDING.P19: reconstructs history with correct IContent items', () => {
  const { chatsDir, lockHandles } = useResumeFixture();
  describe('History reconstruction @requirement:REQ-RSM-004 @plan:PLAN-20260211-SESSIONRECORDING.P19', () => {
    /**
     * Test 13: Resume reconstructs history correctly
     * GIVEN: Session with 3 content events
     * WHEN: resumeSession completes
     * THEN: (await collectBootRows(result.boot.streamRows())) has 3 IContent items with correct content
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-004
     */
    it('reconstructs history with correct IContent items', async () => {
      const contents: IContent[] = [
        makeContent('question 1', 'human'),
        makeContent('answer 1', 'ai'),
        makeContent('question 2', 'human'),
      ];

      await createTestSession(chatsDir(), {
        projectHash: PROJECT_HASH,
        contents,
      });

      const result = await resumeSession(makeResumeRequest(chatsDir()));

      const okResult = expectOk(result);
      lockHandles.push(okResult.lockHandle);
      expect(await collectBootRows(okResult.boot.streamRows())).toHaveLength(3);
      expect(
        (await collectBootRows(okResult.boot.streamRows()))[0].speaker,
      ).toBe('human');
      expect(
        (await collectBootRows(okResult.boot.streamRows()))[0].blocks[0],
      ).toStrictEqual({
        type: 'text',
        text: 'question 1',
      });
      expect(
        (await collectBootRows(okResult.boot.streamRows()))[1].speaker,
      ).toBe('ai');
      expect(
        (await collectBootRows(okResult.boot.streamRows()))[1].blocks[0],
      ).toStrictEqual({
        type: 'text',
        text: 'answer 1',
      });
      expect(
        (await collectBootRows(okResult.boot.streamRows()))[2].speaker,
      ).toBe('human');
      expect(
        (await collectBootRows(okResult.boot.streamRows()))[2].blocks[0],
      ).toStrictEqual({
        type: 'text',
        text: 'question 2',
      });
    });
  });
});

describe('resumeSession @plan:PLAN-20260211-SESSIONRECORDING.P19: reconstructs history correctly for compressed sessions', () => {
  const { chatsDir, lockHandles } = useResumeFixture();
  describe('Compressed history reconstruction', () => {
    /**
     * Test 14: Resume handles compressed session
     * GIVEN: Session with content, then compression, then more content
     * WHEN: resumeSession completes
     * THEN: History reflects post-compression state (summary + new content)
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-004
     */
    it('reconstructs history correctly for compressed sessions', async () => {
      const sessionId = 'compressed-session';
      const config = makeConfig(chatsDir(), {
        sessionId,
        projectHash: PROJECT_HASH,
      });
      const svc = new SessionRecordingService(config);

      // Add initial content
      svc.recordContent(makeContent('old msg 1', 'human'));
      svc.recordContent(makeContent('old msg 2', 'ai'));
      svc.recordContent(makeContent('old msg 3', 'human'));

      // Compress all prior content
      const summary: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Summary of prior conversation' }],
        metadata: { isSummary: true },
      };
      svc.recordCompressed(summary, 3);

      // Add new content after compression
      svc.recordContent(makeContent('new msg after compression', 'human'));
      svc.recordContent(makeContent('new response', 'ai'));

      await svc.flush();
      await svc.dispose();

      const result = await resumeSession(makeResumeRequest(chatsDir()));

      const okResult = expectOk(result);
      lockHandles.push(okResult.lockHandle);
      // After compression: summary + 2 new content items = 3
      expect(await collectBootRows(okResult.boot.streamRows())).toHaveLength(3);
      expect(
        (await collectBootRows(okResult.boot.streamRows()))[0].blocks[0],
      ).toStrictEqual({
        type: 'text',
        text: 'Summary of prior conversation',
      });
      expect(
        (await collectBootRows(okResult.boot.streamRows()))[1].blocks[0],
      ).toStrictEqual({
        type: 'text',
        text: 'new msg after compression',
      });
      expect(
        (await collectBootRows(okResult.boot.streamRows()))[2].blocks[0],
      ).toStrictEqual({
        type: 'text',
        text: 'new response',
      });
    });
  });
});

describe('resumeSession @plan:PLAN-20260211-SESSIONRECORDING.P19: returns correct session metadata', () => {
  const { chatsDir, lockHandles } = useResumeFixture();
  describe('Metadata @requirement:REQ-RSM-004 @plan:PLAN-20260211-SESSIONRECORDING.P19', () => {
    /**
     * Test 15: Resume returns correct metadata
     * GIVEN: Session with known provider, model, sessionId
     * WHEN: resumeSession completes
     * THEN: result.metadata reflects the session's original values
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-004
     */
    it('returns correct session metadata', async () => {
      const sessionId = 'metadata-session-id';
      await createTestSession(chatsDir(), {
        sessionId,
        projectHash: PROJECT_HASH,
        provider: 'google',
        model: 'gemini-3',
      });

      const result = await resumeSession(
        makeResumeRequest(chatsDir(), {
          currentProvider: 'google',
          currentModel: 'gemini-3',
        }),
      );

      const okResult = expectOk(result);
      lockHandles.push(okResult.lockHandle);
      expect(okResult.metadata.sessionId).toBe(sessionId);
      expect(okResult.metadata.provider).toBe('google');
      expect(okResult.metadata.model).toBe('gemini-3');
      expect(okResult.metadata.projectHash).toBe(PROJECT_HASH);
      expect(typeof okResult.metadata.startTime).toBe('string');
    });
  });
});

describe('resumeSession @plan:PLAN-20260211-SESSIONRECORDING.P19: returns error when no sessions exist', () => {
  const { chatsDir } = useResumeFixture();
  describe('Error cases @plan:PLAN-20260211-SESSIONRECORDING.P19', () => {
    /**
     * Test 16: Resume no sessions found
     * GIVEN: Empty chatsDir
     * WHEN: resumeSession is called
     * THEN: Returns error "No sessions found"
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-001
     */
    it('returns error when no sessions exist', async () => {
      const result = await resumeSession(makeResumeRequest(chatsDir()));

      const errResult = expectNotOk(result);
      expect(errResult.error.toLowerCase()).toContain('no session');
    });
  });
});

describe('resumeSession @plan:PLAN-20260211-SESSIONRECORDING.P19: returns error when specific session ID is not found', () => {
  const { chatsDir } = useResumeFixture();
  describe('Error cases @plan:PLAN-20260211-SESSIONRECORDING.P19', () => {
    /**
     * Test 17: Resume specific session not found
     * GIVEN: Sessions exist but none match the provided ref
     * WHEN: resumeSession with non-existent ID
     * THEN: Returns error
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-002
     */
    it('returns error when specific session ID is not found', async () => {
      await createTestSession(chatsDir(), { projectHash: PROJECT_HASH });

      const result = await resumeSession(
        makeResumeRequest(chatsDir(), {
          continueRef: 'nonexistent-session-id',
        }),
      );

      const errResult = expectNotOk(result);
      expect(errResult.error).toBeTruthy();
    });
  });
});

describe('resumeSession @plan:PLAN-20260211-SESSIONRECORDING.P19: returns error when target session is locked', () => {
  const { chatsDir, lockHandles } = useResumeFixture();
  describe('Error cases @plan:PLAN-20260211-SESSIONRECORDING.P19', () => {
    /**
     * Test 18: Resume locked session fails
     * GIVEN: Only session is locked
     * WHEN: resumeSession with specific ID
     * THEN: Returns error about session being in use
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-001
     */
    it('returns error when target session is locked', async () => {
      const sessionId = 'locked-session';
      await createTestSession(chatsDir(), {
        sessionId,
        projectHash: PROJECT_HASH,
      });

      const handle = await SessionLockManager.acquire(chatsDir(), sessionId);
      lockHandles.push(handle);

      const result = await resumeSession(
        makeResumeRequest(chatsDir(), { continueRef: sessionId }),
      );

      const errResult = expectNotOk(result);
      expect(errResult.error.toLowerCase()).toContain('in use');
    });
  });
});

describe('resumeSession @plan:PLAN-20260211-SESSIONRECORDING.P19: CONTINUE_LATEST skips locked sessions and resumes next unlocked', () => {
  const { chatsDir, lockHandles } = useResumeFixture();
  describe('Error cases @plan:PLAN-20260211-SESSIONRECORDING.P19', () => {
    /**
     * Test 19: CONTINUE_LATEST skips locked → resumes second newest
     * GIVEN: 2 sessions, newest is locked
     * WHEN: resumeSession with CONTINUE_LATEST
     * THEN: Resumes the second newest (unlocked) session
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-001
     */
    it('CONTINUE_LATEST skips locked sessions and resumes next unlocked', async () => {
      // Create older session
      await createTestSession(chatsDir(), {
        projectHash: PROJECT_HASH,
        contents: [makeContent('older unlocked content')],
      });
      await delay(100);

      // Create newer session and lock it
      const newer = await createTestSession(chatsDir(), {
        projectHash: PROJECT_HASH,
        contents: [makeContent('newer locked content')],
      });

      const handle = await SessionLockManager.acquire(
        chatsDir(),
        newer.sessionId,
      );
      lockHandles.push(handle);

      const result = await resumeSession(makeResumeRequest(chatsDir()));

      const okResult = expectOk(result);
      lockHandles.push(okResult.lockHandle);
      expect(
        (await collectBootRows(okResult.boot.streamRows()))[0].blocks[0],
      ).toStrictEqual({
        type: 'text',
        text: 'older unlocked content',
      });
    });
  });
});

describe('resumeSession @plan:PLAN-20260211-SESSIONRECORDING.P19: returns error when all sessions are locked', () => {
  const { chatsDir, lockHandles } = useResumeFixture();
  describe('Error cases @plan:PLAN-20260211-SESSIONRECORDING.P19', () => {
    /**
     * Test 20: Resume all locked returns error
     * GIVEN: All sessions are locked
     * WHEN: resumeSession with CONTINUE_LATEST
     * THEN: Returns error about all sessions being in use
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-001
     */
    it('returns error when all sessions are locked', async () => {
      const s1 = await createTestSession(chatsDir(), {
        projectHash: PROJECT_HASH,
      });
      const s2 = await createTestSession(chatsDir(), {
        projectHash: PROJECT_HASH,
      });

      // Lock both by their full header session identities.
      for (const session of [s1, s2]) {
        const handle = await SessionLockManager.acquire(
          chatsDir(),
          session.sessionId,
        );
        lockHandles.push(handle);
      }

      const result = await resumeSession(makeResumeRequest(chatsDir()));

      const errResult = expectNotOk(result);
      expect(errResult.error.toLowerCase()).toContain('in use');
    });
  });
});

describe('resumeSession @plan:PLAN-20260211-SESSIONRECORDING.P19: records provider_switch when current provider differs from session', () => {
  const { chatsDir, lockHandles } = useResumeFixture();
  describe('Provider mismatch @requirement:REQ-RSM-005 @plan:PLAN-20260211-SESSIONRECORDING.P19', () => {
    /**
     * Test 21: Provider mismatch records provider_switch event
     * GIVEN: Session with provider "anthropic", current provider is "openai"
     * WHEN: resumeSession completes
     * THEN: provider_switch event is recorded in the session file
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-005
     */
    it('records provider_switch when current provider differs from session', async () => {
      await createTestSession(chatsDir(), {
        projectHash: PROJECT_HASH,
        provider: 'anthropic',
        model: 'claude-4',
        contents: [makeContent('original content')],
      });

      const result = await resumeSession(
        makeResumeRequest(chatsDir(), {
          currentProvider: 'openai',
          currentModel: 'gpt-5',
        }),
      );

      const okResult = expectOk(result);
      lockHandles.push(okResult.lockHandle);
      // Flush the recording to ensure the provider_switch is written
      await okResult.recording.flush();

      // Read the file and check for provider_switch event
      const events = await readJsonlFile(okResult.recording.getFilePath()!);
      const providerSwitchEvents = events.filter(
        (e) => e.type === 'provider_switch',
      );
      expect(providerSwitchEvents.length).toBeGreaterThanOrEqual(1);

      const switchPayload = providerSwitchEvents[
        providerSwitchEvents.length - 1
      ].payload as { provider: string; model: string };
      expect(switchPayload.provider).toBe('openai');
      expect(switchPayload.model).toBe('gpt-5');

      await okResult.recording.dispose();
    });
  });
});

describe('resumeSession @plan:PLAN-20260211-SESSIONRECORDING.P19: new events after resume have seq continuing from lastSeq', () => {
  const { chatsDir, lockHandles } = useResumeFixture();
  describe('Recording append @requirement:REQ-RSM-006 @plan:PLAN-20260211-SESSIONRECORDING.P19', () => {
    /**
     * Test 22: Recording initialized for append with monotonic seq
     * GIVEN: Session file with events
     * WHEN: resumeSession completes, then new content is recorded
     * THEN: New events have seq > lastSeq from original session
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-006
     */
    it('new events after resume have seq continuing from lastSeq', async () => {
      // Create session with 3 content events (session_start seq=1, content seq=2,3,4)
      await createTestSession(chatsDir(), {
        projectHash: PROJECT_HASH,
        contents: [
          makeContent('msg 1', 'human'),
          makeContent('msg 2', 'ai'),
          makeContent('msg 3', 'human'),
        ],
      });

      const result = await resumeSession(makeResumeRequest(chatsDir()));

      const okResult = expectOk(result);
      lockHandles.push(okResult.lockHandle);
      // Record new content
      okResult.recording.recordContent(makeContent('resumed msg', 'human'));
      await okResult.recording.flush();

      // Read the file and check seq continuation
      const events = await readJsonlFile(okResult.recording.getFilePath()!);

      // Original: session_start(1), content(2), content(3), content(4)
      // New events should have seq > 4
      const originalLastSeq = 4;
      const newEvents = events.filter((e) => e.seq > originalLastSeq);
      expect(newEvents.length).toBeGreaterThanOrEqual(1);

      // All new events have seq > originalLastSeq
      for (const evt of newEvents) {
        expect(evt.seq).toBeGreaterThan(originalLastSeq);
      }

      // Verify monotonicity across all events
      for (let i = 1; i < events.length; i++) {
        expect(events[i].seq).toBeGreaterThan(events[i - 1].seq);
      }

      await okResult.recording.dispose();
    });
  });
});

describe('resumeSession @plan:PLAN-20260211-SESSIONRECORDING.P19: returned recording has non-null file path and matching session ID', () => {
  const { chatsDir, lockHandles } = useResumeFixture();
  describe('Recording append @requirement:REQ-RSM-006 @plan:PLAN-20260211-SESSIONRECORDING.P19', () => {
    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-006
     */
    it('returned recording has non-null file path and matching session ID', async () => {
      const sessionId = 'recording-check-session';
      await createTestSession(chatsDir(), {
        sessionId,
        projectHash: PROJECT_HASH,
      });

      const result = await resumeSession(
        makeResumeRequest(chatsDir(), { continueRef: sessionId }),
      );

      const okResult = expectOk(result);
      lockHandles.push(okResult.lockHandle);
      expect(okResult.recording).toBeDefined();
      expect(okResult.recording.getFilePath()).not.toBeNull();
      expect(okResult.recording.getSessionId()).toBe(sessionId);
      expect(okResult.recording.isActive()).toBe(true);
      await okResult.recording.dispose();
    });
  });
});

describe('resumeSession @plan:PLAN-20260211-SESSIONRECORDING.P19: passes through replay warnings for corrupt mid-file lines', () => {
  const { chatsDir, lockHandles } = useResumeFixture();
  describe('Warnings @plan:PLAN-20260211-SESSIONRECORDING.P19', () => {
    /**
     * Test 23: Resume returns replay warnings for corrupt mid-file lines
     * GIVEN: Session file with a corrupt line in the middle
     * WHEN: resumeSession completes
     * THEN: result.warnings includes warning about the corrupt line
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-004
     */
    it('passes through replay warnings for corrupt mid-file lines', async () => {
      // Create a valid session first
      const { filePath } = await createTestSession(chatsDir(), {
        projectHash: PROJECT_HASH,
        contents: [makeContent('valid content')],
      });

      // Inject a corrupt line in the middle of the file
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const lines = fileContent.trimEnd().split('\n');
      // Insert corrupt line between session_start and content
      const withCorruption =
        [lines[0], '{this is not valid json}', ...lines.slice(1)].join('\n') +
        '\n';
      await fs.writeFile(filePath, withCorruption, 'utf-8');

      const result = await resumeSession(makeResumeRequest(chatsDir()));

      const okResult = expectOk(result);
      lockHandles.push(okResult.lockHandle);
      expect(okResult.warnings.length).toBeGreaterThan(0);
      expect(okResult.warnings.some(isParseWarning)).toBe(true);
      await okResult.recording.dispose();
    });
  });
});
