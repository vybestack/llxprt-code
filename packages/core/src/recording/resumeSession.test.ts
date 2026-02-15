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
 * @requirement REQ-RSM-001, REQ-RSM-002, REQ-RSM-004, REQ-RSM-005, REQ-RSM-006
 *
 * Behavioral and property-based tests for resumeSession. Tests use real
 * SessionRecordingService, SessionLockManager, and ReplayEngine instances
 * to create, lock, and resume genuine session JSONL files in real temp
 * directories — no mock theater.
 *
 * Property-based tests use @fast-check/vitest (≥30% of total tests).
 * All tests expect real behavior. They will fail against the Phase 18 stub
 * — that is correct TDD.
 */

import { describe, expect, beforeEach, afterEach } from 'vitest';
import { it } from '@fast-check/vitest';
import * as fc from 'fast-check';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionRecordingService } from './SessionRecordingService.js';
import { SessionLockManager, type LockHandle } from './SessionLockManager.js';
import {
  resumeSession,
  CONTINUE_LATEST,
  type ResumeRequest,
} from './resumeSession.js';
import {
  type SessionRecordingServiceConfig,
  type SessionRecordLine,
} from './types.js';
import { type IContent } from '../services/history/IContent.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROJECT_HASH = 'test-project-hash-resume';

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
): Promise<{
  filePath: string;
  sessionId: string;
  service: SessionRecordingService;
}> {
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
  await svc.dispose();
  return { filePath, sessionId, service: svc };
}

/**
 * Build a ResumeRequest for the given chatsDir.
 */
function makeResumeRequest(
  chatsDir: string,
  overrides: Partial<ResumeRequest> = {},
): ResumeRequest {
  return {
    continueRef: overrides.continueRef ?? CONTINUE_LATEST,
    projectHash: overrides.projectHash ?? PROJECT_HASH,
    chatsDir,
    currentProvider: overrides.currentProvider ?? 'anthropic',
    currentModel: overrides.currentModel ?? 'claude-4',
    workspaceDirs: overrides.workspaceDirs ?? ['/test/workspace'],
  };
}

/**
 * Read a JSONL file and parse each line into a SessionRecordLine.
 */
async function readJsonlFile(filePath: string): Promise<SessionRecordLine[]> {
  const raw = await fs.readFile(filePath, 'utf-8');
  const lines = raw.trim().split('\n');
  return lines.map((line) => JSON.parse(line) as SessionRecordLine);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('resumeSession @plan:PLAN-20260211-SESSIONRECORDING.P19', () => {
  let tempDir: string;
  let chatsDir: string;
  let lockHandles: LockHandle[];

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-session-test-'));
    chatsDir = path.join(tempDir, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
    lockHandles = [];
  });

  afterEach(async () => {
    // Release any acquired locks
    for (const handle of lockHandles) {
      await handle.release();
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Resume Most Recent (CONTINUE_LATEST)
  // -------------------------------------------------------------------------

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
      await createTestSession(chatsDir, {
        projectHash: PROJECT_HASH,
        contents: [makeContent('first session message')],
      });
      await delay(50);
      await createTestSession(chatsDir, {
        projectHash: PROJECT_HASH,
        contents: [makeContent('second session message')],
      });

      const result = await resumeSession(makeResumeRequest(chatsDir));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.history).toHaveLength(1);
        expect(result.history[0].blocks[0]).toEqual({
          type: 'text',
          text: 'second session message',
        });
        expect(result.lockHandle).toBeDefined();
        expect(result.lockHandle.lockPath).toBeTruthy();
        lockHandles.push(result.lockHandle);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Resume Specific Session
  // -------------------------------------------------------------------------

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
      await createTestSession(chatsDir, {
        sessionId: targetId,
        projectHash: PROJECT_HASH,
        contents: [makeContent('target content')],
      });
      await createTestSession(chatsDir, {
        projectHash: PROJECT_HASH,
        contents: [makeContent('other content')],
      });

      const result = await resumeSession(
        makeResumeRequest(chatsDir, { continueRef: targetId }),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.history).toHaveLength(1);
        expect(result.history[0].blocks[0]).toEqual({
          type: 'text',
          text: 'target content',
        });
        expect(result.metadata.sessionId).toBe(targetId);
        expect(result.lockHandle).toBeDefined();
        expect(result.lockHandle.lockPath).toBeTruthy();
        lockHandles.push(result.lockHandle);
      }
    });
  });

  // -------------------------------------------------------------------------
  // History Reconstruction
  // -------------------------------------------------------------------------

  describe('History reconstruction @requirement:REQ-RSM-004 @plan:PLAN-20260211-SESSIONRECORDING.P19', () => {
    /**
     * Test 13: Resume reconstructs history correctly
     * GIVEN: Session with 3 content events
     * WHEN: resumeSession completes
     * THEN: result.history has 3 IContent items with correct content
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

      await createTestSession(chatsDir, {
        projectHash: PROJECT_HASH,
        contents,
      });

      const result = await resumeSession(makeResumeRequest(chatsDir));

      expect(result.ok).toBe(true);
      if (result.ok) {
        lockHandles.push(result.lockHandle);
        expect(result.history).toHaveLength(3);
        expect(result.history[0].speaker).toBe('human');
        expect(result.history[0].blocks[0]).toEqual({
          type: 'text',
          text: 'question 1',
        });
        expect(result.history[1].speaker).toBe('ai');
        expect(result.history[1].blocks[0]).toEqual({
          type: 'text',
          text: 'answer 1',
        });
        expect(result.history[2].speaker).toBe('human');
        expect(result.history[2].blocks[0]).toEqual({
          type: 'text',
          text: 'question 2',
        });
      }
    });

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
      const config = makeConfig(chatsDir, {
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

      const result = await resumeSession(makeResumeRequest(chatsDir));

      expect(result.ok).toBe(true);
      if (result.ok) {
        lockHandles.push(result.lockHandle);
        // After compression: summary + 2 new content items = 3
        expect(result.history).toHaveLength(3);
        expect(result.history[0].blocks[0]).toEqual({
          type: 'text',
          text: 'Summary of prior conversation',
        });
        expect(result.history[1].blocks[0]).toEqual({
          type: 'text',
          text: 'new msg after compression',
        });
        expect(result.history[2].blocks[0]).toEqual({
          type: 'text',
          text: 'new response',
        });
      }
    });
  });

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

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
      await createTestSession(chatsDir, {
        sessionId,
        projectHash: PROJECT_HASH,
        provider: 'google',
        model: 'gemini-3',
      });

      const result = await resumeSession(
        makeResumeRequest(chatsDir, {
          currentProvider: 'google',
          currentModel: 'gemini-3',
        }),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        lockHandles.push(result.lockHandle);
        expect(result.metadata.sessionId).toBe(sessionId);
        expect(result.metadata.provider).toBe('google');
        expect(result.metadata.model).toBe('gemini-3');
        expect(result.metadata.projectHash).toBe(PROJECT_HASH);
        expect(typeof result.metadata.startTime).toBe('string');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Error Cases
  // -------------------------------------------------------------------------

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
      const result = await resumeSession(makeResumeRequest(chatsDir));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.toLowerCase()).toContain('no session');
      }
    });

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
      await createTestSession(chatsDir, { projectHash: PROJECT_HASH });

      const result = await resumeSession(
        makeResumeRequest(chatsDir, {
          continueRef: 'nonexistent-session-id',
        }),
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeTruthy();
      }
    });

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
      const { filePath } = await createTestSession(chatsDir, {
        sessionId,
        projectHash: PROJECT_HASH,
      });

      // Extract the file identifier for locking
      const fileBasename = path.basename(filePath);
      const lockId = fileBasename
        .replace(/^session-/, '')
        .replace(/\.jsonl$/, '');
      const handle = await SessionLockManager.acquire(chatsDir, lockId);
      lockHandles.push(handle);

      const result = await resumeSession(
        makeResumeRequest(chatsDir, { continueRef: sessionId }),
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.toLowerCase()).toContain('in use');
      }
    });

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
      await createTestSession(chatsDir, {
        projectHash: PROJECT_HASH,
        contents: [makeContent('older unlocked content')],
      });
      await delay(100);

      // Create newer session and lock it
      const newer = await createTestSession(chatsDir, {
        projectHash: PROJECT_HASH,
        contents: [makeContent('newer locked content')],
      });

      const fileBasename = path.basename(newer.filePath);
      const lockId = fileBasename
        .replace(/^session-/, '')
        .replace(/\.jsonl$/, '');
      const handle = await SessionLockManager.acquire(chatsDir, lockId);
      lockHandles.push(handle);

      const result = await resumeSession(makeResumeRequest(chatsDir));

      expect(result.ok).toBe(true);
      if (result.ok) {
        lockHandles.push(result.lockHandle);
        expect(result.history[0].blocks[0]).toEqual({
          type: 'text',
          text: 'older unlocked content',
        });
      }
    });

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
      const s1 = await createTestSession(chatsDir, {
        projectHash: PROJECT_HASH,
      });
      const s2 = await createTestSession(chatsDir, {
        projectHash: PROJECT_HASH,
      });

      // Lock both
      for (const s of [s1, s2]) {
        const fileBasename = path.basename(s.filePath);
        const lockId = fileBasename
          .replace(/^session-/, '')
          .replace(/\.jsonl$/, '');
        const handle = await SessionLockManager.acquire(chatsDir, lockId);
        lockHandles.push(handle);
      }

      const result = await resumeSession(makeResumeRequest(chatsDir));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.toLowerCase()).toContain('in use');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Provider Mismatch
  // -------------------------------------------------------------------------

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
      await createTestSession(chatsDir, {
        projectHash: PROJECT_HASH,
        provider: 'anthropic',
        model: 'claude-4',
        contents: [makeContent('original content')],
      });

      const result = await resumeSession(
        makeResumeRequest(chatsDir, {
          currentProvider: 'openai',
          currentModel: 'gpt-5',
        }),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        lockHandles.push(result.lockHandle);
        // Flush the recording to ensure the provider_switch is written
        await result.recording.flush();

        // Read the file and check for provider_switch event
        const events = await readJsonlFile(result.recording.getFilePath()!);
        const providerSwitchEvents = events.filter(
          (e) => e.type === 'provider_switch',
        );
        expect(providerSwitchEvents.length).toBeGreaterThanOrEqual(1);

        const switchPayload = providerSwitchEvents[
          providerSwitchEvents.length - 1
        ].payload as { provider: string; model: string };
        expect(switchPayload.provider).toBe('openai');
        expect(switchPayload.model).toBe('gpt-5');

        await result.recording.dispose();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Recording Initialized for Append
  // -------------------------------------------------------------------------

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
      await createTestSession(chatsDir, {
        projectHash: PROJECT_HASH,
        contents: [
          makeContent('msg 1', 'human'),
          makeContent('msg 2', 'ai'),
          makeContent('msg 3', 'human'),
        ],
      });

      const result = await resumeSession(makeResumeRequest(chatsDir));

      expect(result.ok).toBe(true);
      if (result.ok) {
        lockHandles.push(result.lockHandle);
        // Record new content
        result.recording.recordContent(makeContent('resumed msg', 'human'));
        await result.recording.flush();

        // Read the file and check seq continuation
        const events = await readJsonlFile(result.recording.getFilePath()!);

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

        await result.recording.dispose();
      }
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-006
     */
    it('returned recording has non-null file path and matching session ID', async () => {
      const sessionId = 'recording-check-session';
      await createTestSession(chatsDir, {
        sessionId,
        projectHash: PROJECT_HASH,
      });

      const result = await resumeSession(
        makeResumeRequest(chatsDir, { continueRef: sessionId }),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        lockHandles.push(result.lockHandle);
        expect(result.recording).toBeDefined();
        expect(result.recording.getFilePath()).not.toBeNull();
        expect(result.recording.getSessionId()).toBe(sessionId);
        expect(result.recording.isActive()).toBe(true);
        await result.recording.dispose();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Warnings
  // -------------------------------------------------------------------------

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
      const { filePath } = await createTestSession(chatsDir, {
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

      const result = await resumeSession(makeResumeRequest(chatsDir));

      expect(result.ok).toBe(true);
      if (result.ok) {
        lockHandles.push(result.lockHandle);
        expect(result.warnings.length).toBeGreaterThan(0);
        const hasParseWarning = result.warnings.some(
          (w) => w.includes('parse') || w.includes('JSON'),
        );
        expect(hasParseWarning).toBe(true);
        await result.recording.dispose();
      }
    });
  });

  // =========================================================================
  // Property-Based Tests (≥30% of total)
  // =========================================================================

  describe('Property-Based Tests @plan:PLAN-20260211-SESSIONRECORDING.P19', () => {
    /**
     * Test 26: Resume preserves any valid IContent through write-replay cycle
     * fc.record for IContent, record, resume → history matches
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-004
     */
    it.prop([
      fc.array(
        fc.record({
          speaker: fc.constantFrom('human' as const, 'ai' as const),
          text: fc.string({ minLength: 1, maxLength: 100 }),
        }),
        { minLength: 1, maxLength: 5 },
      ),
    ])(
      'preserves any IContent through write-resume cycle @requirement:REQ-RSM-004',
      async (items) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-resume-roundtrip-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const contents: IContent[] = items.map((item) => ({
            speaker: item.speaker,
            blocks: [{ type: 'text' as const, text: item.text }],
          }));

          await createTestSession(localChatsDir, {
            projectHash: PROJECT_HASH,
            contents,
          });

          const result = await resumeSession(makeResumeRequest(localChatsDir));

          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.history).toHaveLength(contents.length);
            for (let i = 0; i < contents.length; i++) {
              expect(result.history[i].speaker).toBe(contents[i].speaker);
              expect(result.history[i].blocks[0]).toEqual(
                contents[i].blocks[0],
              );
            }
            await result.recording.dispose();
            await result.lockHandle.release();
          }
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 28: Provider mismatch detection works for any provider strings
     * fc.string pairs, verify mismatch detected when different
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-005
     */
    it.prop([
      fc.string({ minLength: 1, maxLength: 20 }),
      fc.string({ minLength: 1, maxLength: 20 }),
    ])(
      'detects provider mismatch for any two different provider strings @requirement:REQ-RSM-005',
      async (sessionProvider, currentProvider) => {
        fc.pre(sessionProvider !== currentProvider);

        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-provider-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          await createTestSession(localChatsDir, {
            projectHash: PROJECT_HASH,
            provider: sessionProvider,
            model: 'model-a',
          });

          const result = await resumeSession(
            makeResumeRequest(localChatsDir, {
              currentProvider,
              currentModel: 'model-b',
            }),
          );

          expect(result.ok).toBe(true);
          if (result.ok) {
            await result.recording.flush();

            // Verify provider_switch event was recorded
            const events = await readJsonlFile(result.recording.getFilePath()!);
            const switchEvents = events.filter(
              (e) => e.type === 'provider_switch',
            );
            expect(switchEvents.length).toBeGreaterThanOrEqual(1);

            const payload = switchEvents[switchEvents.length - 1].payload as {
              provider: string;
              model: string;
            };
            expect(payload.provider).toBe(currentProvider);

            await result.recording.dispose();
            await result.lockHandle.release();
          }
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 29: Sequence continuation after resume produces monotonic seq
     * fc.nat for original event count, resume, add events, verify monotonic
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-006
     */
    it.prop([fc.integer({ min: 1, max: 8 }), fc.integer({ min: 1, max: 5 })])(
      'sequence is monotonic across resume boundary @requirement:REQ-RSM-006',
      async (originalCount, newCount) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-seq-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const originalContents: IContent[] = [];
          for (let i = 0; i < originalCount; i++) {
            originalContents.push(makeContent(`original-${i}`));
          }

          await createTestSession(localChatsDir, {
            projectHash: PROJECT_HASH,
            contents: originalContents,
          });

          const result = await resumeSession(makeResumeRequest(localChatsDir));

          expect(result.ok).toBe(true);
          if (result.ok) {
            // Add new events
            for (let i = 0; i < newCount; i++) {
              result.recording.recordContent(makeContent(`new-${i}`));
            }
            await result.recording.flush();

            // Verify monotonic seq across entire file
            const events = await readJsonlFile(result.recording.getFilePath()!);
            for (let i = 1; i < events.length; i++) {
              expect(events[i].seq).toBeGreaterThan(events[i - 1].seq);
            }

            await result.recording.dispose();
            await result.lockHandle.release();
          }
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 32: Resume result always has non-null recording service
     * fc.nat(1-5) for session events, resume, verify recording is defined
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-006
     */
    it.prop([fc.integer({ min: 1, max: 5 })])(
      'resume always returns a non-null active recording service @requirement:REQ-RSM-006',
      async (contentCount) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-recording-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const contents: IContent[] = [];
          for (let i = 0; i < contentCount; i++) {
            contents.push(makeContent(`content-${i}`));
          }

          await createTestSession(localChatsDir, {
            projectHash: PROJECT_HASH,
            contents,
          });

          const result = await resumeSession(makeResumeRequest(localChatsDir));

          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.recording).toBeDefined();
            expect(result.recording.getFilePath()).not.toBeNull();
            expect(result.recording.isActive()).toBe(true);
            await result.recording.dispose();
            await result.lockHandle.release();
          }
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 33: Compression followed by content produces correct resume history length
     * fc.nat pairs for pre/post compression counts, resume, verify
     * history length = 1 (summary) + post-compression count
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-004
     */
    it.prop([fc.integer({ min: 1, max: 5 }), fc.integer({ min: 0, max: 5 })])(
      'compression + new content produces correct history length @requirement:REQ-RSM-004',
      async (preCompressCount, postCompressCount) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-compress-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const sessionId = crypto.randomUUID();
          const config = makeConfig(localChatsDir, {
            sessionId,
            projectHash: PROJECT_HASH,
          });
          const svc = new SessionRecordingService(config);

          // Pre-compression content
          for (let i = 0; i < preCompressCount; i++) {
            svc.recordContent(makeContent(`pre-${i}`));
          }

          // Compression
          const summary: IContent = {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'Summary' }],
            metadata: { isSummary: true },
          };
          svc.recordCompressed(summary, preCompressCount);

          // Post-compression content
          for (let i = 0; i < postCompressCount; i++) {
            svc.recordContent(makeContent(`post-${i}`));
          }

          await svc.flush();
          await svc.dispose();

          const result = await resumeSession(makeResumeRequest(localChatsDir));

          expect(result.ok).toBe(true);
          if (result.ok) {
            // history = 1 (summary) + postCompressCount
            expect(result.history).toHaveLength(1 + postCompressCount);
            await result.recording.dispose();
            await result.lockHandle.release();
          }
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Extra property: Resume succeeds for any number of content items
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-004
     */
    it.prop([fc.integer({ min: 1, max: 10 })])(
      'resume succeeds for any N content items @requirement:REQ-RSM-004',
      async (contentCount) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-any-count-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const contents: IContent[] = [];
          for (let i = 0; i < contentCount; i++) {
            contents.push(
              makeContent(`msg-${i}`, i % 2 === 0 ? 'human' : 'ai'),
            );
          }

          await createTestSession(localChatsDir, {
            projectHash: PROJECT_HASH,
            contents,
          });

          const result = await resumeSession(makeResumeRequest(localChatsDir));

          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.history).toHaveLength(contentCount);
            await result.recording.dispose();
            await result.lockHandle.release();
          }
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );
  });
});
