/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260214-SESSIONBROWSER.P10
 * @requirement REQ-PR-001, REQ-PR-002, REQ-PR-003, REQ-SW-001, REQ-SW-002, REQ-SW-003, REQ-SW-004, REQ-SW-005, REQ-RC-008, REQ-RC-009, REQ-EH-004, REQ-RS-012
 *
 * Behavioral and property-based tests for performResume. Tests use real
 * JSONL session files in temp directories, real SessionRecordingService,
 * SessionLockManager, and SessionDiscovery instances — no mock theater.
 *
 * Property-based tests use fast-check (≥30% of total tests).
 * All tests expect real behavior. They will fail against the stub
 * — that is correct TDD.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  SessionRecordingService,
  SessionLockManager,
  RecordingIntegration,
  type LockHandle,
  type SessionRecordingServiceConfig,
  type SessionRecordLine,
  type IContent,
} from '@vybestack/llxprt-code-core';
import {
  performResume,
  type ResumeContext,
  type RecordingSwapCallbacks,
} from '../performResume.js';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

const PROJECT_HASH = 'test-project-hash-pr';

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
 * Create a test session with a corrupt line (for testing warnings propagation).
 * The replay engine will generate warnings for corrupt JSON lines.
 */
async function createSessionWithCorruptLine(
  chatsDir: string,
  sessionId: string,
): Promise<string> {
  const config = makeConfig(chatsDir, { sessionId, projectHash: PROJECT_HASH });
  const svc = new SessionRecordingService(config);

  // Record a human message
  svc.recordContent(makeContent('Show me the file', 'human'));

  // Flush to materialize the file
  await svc.flush();

  // Get the file path
  const filePath = svc.getFilePath()!;
  await svc.dispose();

  // Read file and add a corrupt line
  const fileContent = await fs.readFile(filePath, 'utf-8');
  const lines = fileContent.trim().split('\n');

  // Insert a corrupt JSON line
  const corruptLine = '{this is not valid JSON}';

  // Write back with corrupt line in the middle
  const newContent =
    [lines[0], corruptLine, ...lines.slice(1)].join('\n') + '\n';
  await fs.writeFile(filePath, newContent);

  return filePath;
}

/**
 * Build a ResumeContext for testing.
 */
function makeResumeContext(
  chatsDir: string,
  opts: {
    currentSessionId?: string;
    provider?: string;
    model?: string;
    currentRecording?: SessionRecordingService | null;
    currentIntegration?: RecordingIntegration | null;
    currentLockHandle?: LockHandle | null;
  } = {},
): ResumeContext {
  // Create mutable state for tracking swap operations
  let recording = opts.currentRecording ?? null;
  let integration = opts.currentIntegration ?? null;
  let lockHandle = opts.currentLockHandle ?? null;
  // Metadata is set by setRecording but only used internally
  void opts.currentSessionId; // Used in context

  const callbacks: RecordingSwapCallbacks = {
    getCurrentRecording: () => recording,
    getCurrentIntegration: () => integration,
    getCurrentLockHandle: () => lockHandle,
    setRecording: (newRecording, newIntegration, newLock, _newMetadata) => {
      recording = newRecording;
      integration = newIntegration;
      lockHandle = newLock;
      // metadata is updated but not directly used in tests
    },
  };

  return {
    chatsDir,
    projectHash: PROJECT_HASH,
    currentSessionId: opts.currentSessionId ?? 'current-session',
    currentProvider: opts.provider ?? 'anthropic',
    currentModel: opts.model ?? 'claude-4',
    workspaceDirs: ['/test/workspace'],
    recordingCallbacks: callbacks,
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

/**
 * Count events in a JSONL session file.
 */
async function countFileEvents(filePath: string): Promise<number> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return raw.trim().split('\n').length;
}

/**
 * Extract session ID from file path.
 */
function extractSessionId(filePath: string): string {
  const basename = path.basename(filePath);
  const match = basename.match(/^session-(.+)\.jsonl$/);
  if (!match) throw new Error(`Invalid session file path: ${filePath}`);
  return match[1];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('performResume @plan:PLAN-20260214-SESSIONBROWSER.P10', () => {
  let tempDir: string;
  let chatsDir: string;
  let lockHandles: LockHandle[];
  let recordingsToDispose: SessionRecordingService[];

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'perform-resume-test-'));
    chatsDir = path.join(tempDir, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
    lockHandles = [];
    recordingsToDispose = [];
  });

  afterEach(async () => {
    // Release any acquired locks
    for (const handle of lockHandles) {
      try {
        await handle.release();
      } catch {
        // Ignore release errors during cleanup
      }
    }
    // Dispose any recordings
    for (const recording of recordingsToDispose) {
      try {
        await recording.dispose();
      } catch {
        // Ignore dispose errors during cleanup
      }
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Test 1: Resolve by session ID
  // -------------------------------------------------------------------------

  describe('Session Resolution @requirement:REQ-PR-001 @plan:PLAN-20260214-SESSIONBROWSER.P10', () => {
    /**
     * Test 1: Resolve by session ID
     * GIVEN: A valid session ID exists
     * WHEN: performResume is called with that session ID
     * THEN: Returns ok:true with history from that session
     */
    it('resolves session by exact session ID', async () => {
      const targetId = 'target-session-by-id';
      await createTestSession(chatsDir, {
        sessionId: targetId,
        contents: [makeContent('target session content')],
      });

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'other-session',
      });

      const result = await performResume(targetId, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.history).toHaveLength(1);
        expect(result.history[0].blocks[0]).toEqual({
          type: 'text',
          text: 'target session content',
        });
      }

      // Track new lock for cleanup
      const newLock = context.recordingCallbacks.getCurrentLockHandle();
      if (newLock) lockHandles.push(newLock);
    });

    /**
     * Test 2: Resolve by "latest"
     * GIVEN: Multiple sessions exist
     * WHEN: performResume is called with "latest"
     * THEN: Picks the newest non-locked, non-current, non-empty session
     */
    it('resolves "latest" to newest resumable session', async () => {
      // Create older session
      await createTestSession(chatsDir, {
        contents: [makeContent('older session')],
      });
      await delay(50);

      // Create newer session
      const { sessionId: newerSessionId } = await createTestSession(chatsDir, {
        contents: [makeContent('newer session')],
      });

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'completely-different-session',
      });

      const result = await performResume('latest', context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.history[0].blocks[0]).toEqual({
          type: 'text',
          text: 'newer session',
        });
        expect(result.metadata.sessionId).toBe(newerSessionId);
      }

      // Track new lock for cleanup
      const newLock = context.recordingCallbacks.getCurrentLockHandle();
      if (newLock) lockHandles.push(newLock);
    });

    /**
     * Test 3: Resolve by index
     * GIVEN: Multiple sessions exist
     * WHEN: performResume is called with "1"
     * THEN: Resumes the first (newest) session
     */
    it('resolves index "1" to the first (newest) session', async () => {
      await createTestSession(chatsDir, {
        contents: [makeContent('oldest session')],
      });
      await delay(50);

      const { sessionId } = await createTestSession(chatsDir, {
        contents: [makeContent('newest session for index')],
      });

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'different-session',
      });

      const result = await performResume('1', context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.metadata.sessionId).toBe(sessionId);
        expect(result.history[0].blocks[0]).toEqual({
          type: 'text',
          text: 'newest session for index',
        });
      }

      // Track new lock for cleanup
      const newLock = context.recordingCallbacks.getCurrentLockHandle();
      if (newLock) lockHandles.push(newLock);
    });

    /**
     * Test 4: Resolve by prefix
     * GIVEN: A session with a unique prefix exists
     * WHEN: performResume is called with that prefix
     * THEN: Resolves to the matching session
     */
    it('resolves unique prefix to matching session', async () => {
      const targetId = 'unique-prefix-abc123';
      await createTestSession(chatsDir, {
        sessionId: targetId,
        contents: [makeContent('prefix test content')],
      });

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'other-session',
      });

      const result = await performResume('unique-prefix', context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.metadata.sessionId).toBe(targetId);
      }

      // Track new lock for cleanup
      const newLock = context.recordingCallbacks.getCurrentLockHandle();
      if (newLock) lockHandles.push(newLock);
    });
  });

  // -------------------------------------------------------------------------
  // Error Cases
  // -------------------------------------------------------------------------

  describe('Error Cases @requirement:REQ-RC-008,REQ-RC-009 @plan:PLAN-20260214-SESSIONBROWSER.P10', () => {
    /**
     * Test 5: Same-session error (REQ-RC-009)
     * GIVEN: currentSessionId matches the target
     * WHEN: performResume is called
     * THEN: Returns ok:false with "That session is already active."
     */
    it('returns error for same-session resume', async () => {
      const sessionId = 'current-active-session';
      await createTestSession(chatsDir, {
        sessionId,
        contents: [makeContent('current session content')],
      });

      const context = makeResumeContext(chatsDir, {
        currentSessionId: sessionId,
      });

      const result = await performResume(sessionId, context);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('That session is already active.');
      }
    });

    /**
     * Test 6: Locked session error (REQ-RC-008)
     * GIVEN: Target session is locked by another process
     * WHEN: performResume is called
     * THEN: Returns ok:false with "in use" error
     */
    it('returns error for locked session', async () => {
      const sessionId = 'locked-session-test';
      await createTestSession(chatsDir, {
        sessionId,
        contents: [makeContent('locked content')],
      });

      // Lock the session
      const handle = await SessionLockManager.acquire(chatsDir, sessionId);
      lockHandles.push(handle);

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'other-session',
      });

      const result = await performResume(sessionId, context);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.toLowerCase()).toContain('in use');
      }
    });

    /**
     * Test 7: Missing session error
     * GIVEN: The session ref doesn't match any session
     * WHEN: performResume is called
     * THEN: Returns ok:false with error
     */
    it('returns error for non-existent session', async () => {
      // Create at least one session so the project has sessions
      await createTestSession(chatsDir, {
        contents: [makeContent('existing content')],
      });

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'other-session',
      });

      const result = await performResume('nonexistent-session-id', context);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeTruthy();
      }
    });

    /**
     * Test 8: Ambiguous prefix error
     * GIVEN: Multiple sessions match the prefix
     * WHEN: performResume is called with that prefix
     * THEN: Returns ok:false with error listing matching IDs
     */
    it('returns error for ambiguous prefix', async () => {
      // Use session IDs with different 12-char prefixes to avoid filename collision
      // (materialize() uses first 12 chars + timestamp for filename)
      await createTestSession(chatsDir, {
        sessionId: 'ambig-first-session',
        contents: [makeContent('first ambig')],
      });
      await createTestSession(chatsDir, {
        sessionId: 'ambig-second-session',
        contents: [makeContent('second ambig')],
      });

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'other-session',
      });

      // Use prefix 'ambig-' which matches both 'ambig-first-session' and 'ambig-second-session'
      const result = await performResume('ambig-', context);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.toLowerCase()).toContain('ambiguous');
        expect(result.error).toContain('ambig-first-session');
        expect(result.error).toContain('ambig-second-session');
      }
    });

    /**
     * Test 9: Out-of-range index error
     * GIVEN: Only 2 sessions exist
     * WHEN: performResume is called with index "999"
     * THEN: Returns ok:false with error
     */
    it('returns error for out-of-range index', async () => {
      await createTestSession(chatsDir, {
        contents: [makeContent('session 1')],
      });
      await createTestSession(chatsDir, {
        contents: [makeContent('session 2')],
      });

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'other-session',
      });

      const result = await performResume('999', context);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/out of range|not found/i);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Two-Phase Swap Tests
  // -------------------------------------------------------------------------

  describe('Two-Phase Swap @requirement:REQ-SW-001,REQ-SW-002 @plan:PLAN-20260214-SESSIONBROWSER.P10', () => {
    /**
     * Test 10: Phase 1 failure preserves old session (REQ-SW-002, REQ-EH-004)
     * GIVEN: resumeSession will fail (locked target)
     * WHEN: performResume is called
     * THEN: Old session file still receives events when writing
     *
     * Note: This test verifies that on Phase 1 failure, the old recording
     * is NOT disposed and can still write to its file.
     */
    it('Phase 1 failure preserves old session - can still write to old file', async () => {
      // Create old session (the "current" one)
      const oldConfig = makeConfig(chatsDir, {
        sessionId: 'old-current-session',
        projectHash: PROJECT_HASH,
      });
      const oldRecording = new SessionRecordingService(oldConfig);
      oldRecording.recordContent(makeContent('old message'));
      await oldRecording.flush();
      const oldFilePath = oldRecording.getFilePath()!;
      recordingsToDispose.push(oldRecording);

      const oldEventCountBefore = await countFileEvents(oldFilePath);

      // Create target session and lock it so resume will fail
      const targetId = 'target-locked-session';
      await createTestSession(chatsDir, {
        sessionId: targetId,
        contents: [makeContent('target content')],
      });
      const targetLock = await SessionLockManager.acquire(chatsDir, targetId);
      lockHandles.push(targetLock);

      // Create context with the old recording
      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'old-current-session',
        currentRecording: oldRecording,
      });

      // Attempt resume - should fail
      const result = await performResume(targetId, context);
      expect(result.ok).toBe(false);

      // Old recording should still be functional
      oldRecording.recordContent(
        makeContent('new message after failed resume'),
      );
      await oldRecording.flush();

      const oldEventCountAfter = await countFileEvents(oldFilePath);
      expect(oldEventCountAfter).toBeGreaterThan(oldEventCountBefore);
    });

    /**
     * Test 11: After resume, old session file is closed
     * GIVEN: Successful resume
     * WHEN: Attempting to write to old recording
     * THEN: Old file is unchanged (service was disposed)
     */
    it('after resume, old session file is closed', async () => {
      // Create old session
      const oldConfig = makeConfig(chatsDir, {
        sessionId: 'old-session-to-close',
        projectHash: PROJECT_HASH,
      });
      const oldRecording = new SessionRecordingService(oldConfig);
      oldRecording.recordContent(makeContent('old message'));
      await oldRecording.flush();
      const oldFilePath = oldRecording.getFilePath()!;
      recordingsToDispose.push(oldRecording);

      // Create target session
      const targetId = 'target-for-swap';
      await createTestSession(chatsDir, {
        sessionId: targetId,
        contents: [makeContent('target content')],
      });

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'old-session-to-close',
        currentRecording: oldRecording,
      });

      const oldEventCountBefore = await countFileEvents(oldFilePath);

      // Resume should succeed
      const result = await performResume(targetId, context);
      expect(result.ok).toBe(true);

      // After resume, old recording should be disposed
      // Writing should have no effect
      oldRecording.recordContent(makeContent('should not appear'));
      await oldRecording.flush();

      const oldEventCountAfter = await countFileEvents(oldFilePath);
      expect(oldEventCountAfter).toBe(oldEventCountBefore);
    });

    /**
     * Test 12: After resume, new events go to new file
     * GIVEN: Successful resume
     * WHEN: Recording events via new recording
     * THEN: Events appear in the NEW session file
     */
    it('after resume, new events go to new file', async () => {
      // Create target session
      const targetId = 'target-for-new-events';
      const { filePath: targetFilePath } = await createTestSession(chatsDir, {
        sessionId: targetId,
        contents: [makeContent('original target content')],
      });

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'some-other-session',
      });

      const result = await performResume(targetId, context);
      expect(result.ok).toBe(true);

      if (result.ok) {
        // Get the new recording from callbacks
        const newRecording = context.recordingCallbacks.getCurrentRecording();
        expect(newRecording).not.toBeNull();
        recordingsToDispose.push(newRecording!);

        const eventCountBefore = await countFileEvents(targetFilePath);

        // Record new event
        newRecording!.recordContent(makeContent('new event after resume'));
        await newRecording!.flush();

        const eventCountAfter = await countFileEvents(targetFilePath);
        expect(eventCountAfter).toBeGreaterThan(eventCountBefore);

        // Verify the content is in the file
        const events = await readJsonlFile(targetFilePath);
        const lastContentEvent = events
          .filter((e) => e.type === 'content')
          .pop();
        const payload = lastContentEvent?.payload as { content: IContent };
        expect(payload.content.blocks[0]).toEqual({
          type: 'text',
          text: 'new event after resume',
        });
      }
    });

    /**
     * Test 13: After resume, old lock file is released (REQ-SW-004)
     * GIVEN: Current session has a lock
     * WHEN: performResume succeeds
     * THEN: Old lock file is released
     */
    it('after resume, old lock file is released', async () => {
      const oldSessionId = 'old-session-with-lock';

      // Create and lock old session
      await createTestSession(chatsDir, {
        sessionId: oldSessionId,
        contents: [makeContent('old locked content')],
      });
      const oldLock = await SessionLockManager.acquire(chatsDir, oldSessionId);

      // Create target session
      const targetId = 'target-for-lock-release';
      await createTestSession(chatsDir, {
        sessionId: targetId,
        contents: [makeContent('target content')],
      });

      const context = makeResumeContext(chatsDir, {
        currentSessionId: oldSessionId,
        currentLockHandle: oldLock,
      });

      // Verify old session is locked before resume
      expect(await SessionLockManager.isLocked(chatsDir, oldSessionId)).toBe(
        true,
      );

      const result = await performResume(targetId, context);
      expect(result.ok).toBe(true);

      // Old lock should be released
      expect(await SessionLockManager.isLocked(chatsDir, oldSessionId)).toBe(
        false,
      );

      // Track new lock for cleanup
      const newLock = context.recordingCallbacks.getCurrentLockHandle();
      if (newLock) lockHandles.push(newLock);
    });

    /**
     * Test 14: Phase 2 skips null lock gracefully (REQ-SW-004)
     * GIVEN: currentLockHandle is null
     * WHEN: performResume succeeds
     * THEN: No error occurs
     */
    it('skips null lock gracefully during Phase 2', async () => {
      const targetId = 'target-with-null-lock';
      await createTestSession(chatsDir, {
        sessionId: targetId,
        contents: [makeContent('target content')],
      });

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'some-other-session',
        currentLockHandle: null,
      });

      const result = await performResume(targetId, context);

      expect(result.ok).toBe(true);

      // Track new lock for cleanup
      const newLock = context.recordingCallbacks.getCurrentLockHandle();
      if (newLock) lockHandles.push(newLock);
    });

    /**
     * Test 15: After resume, old file event count unchanged
     * GIVEN: Old session has N events
     * WHEN: performResume succeeds
     * THEN: Old session file still has N events (no new events written)
     */
    it('after resume, old file event count unchanged', async () => {
      const oldSessionId = 'old-session-event-count';
      const { filePath: oldFilePath } = await createTestSession(chatsDir, {
        sessionId: oldSessionId,
        contents: [
          makeContent('msg 1'),
          makeContent('msg 2'),
          makeContent('msg 3'),
        ],
      });

      const targetId = 'target-session-event-count';
      await createTestSession(chatsDir, {
        sessionId: targetId,
        contents: [makeContent('target content')],
      });

      const context = makeResumeContext(chatsDir, {
        currentSessionId: oldSessionId,
      });

      const eventCountBefore = await countFileEvents(oldFilePath);

      const result = await performResume(targetId, context);
      expect(result.ok).toBe(true);

      const eventCountAfter = await countFileEvents(oldFilePath);
      expect(eventCountAfter).toBe(eventCountBefore);

      // Track new lock for cleanup
      const newLock = context.recordingCallbacks.getCurrentLockHandle();
      if (newLock) lockHandles.push(newLock);
    });

    /**
     * Test 16: Lock release failure tolerance (REQ-SW-005)
     * GIVEN: Old lock release will fail (simulated by early manual release)
     * WHEN: performResume completes
     * THEN: Returns ok:true and new session is operational
     */
    it('tolerates lock release failure', async () => {
      const oldSessionId = 'old-session-release-fail';

      // Create and lock old session
      await createTestSession(chatsDir, {
        sessionId: oldSessionId,
        contents: [makeContent('old content')],
      });
      const oldLock = await SessionLockManager.acquire(chatsDir, oldSessionId);

      // Manually release the lock early to simulate "release failure"
      // (the lock file is already gone when performResume tries to release)
      await oldLock.release();

      const targetId = 'target-release-fail-test';
      await createTestSession(chatsDir, {
        sessionId: targetId,
        contents: [makeContent('target content')],
      });

      const context = makeResumeContext(chatsDir, {
        currentSessionId: oldSessionId,
        currentLockHandle: oldLock, // Still pass the (already-released) lock
      });

      const result = await performResume(targetId, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // New session should be operational
        const newRecording = context.recordingCallbacks.getCurrentRecording();
        expect(newRecording).not.toBeNull();
        expect(newRecording!.isActive()).toBe(true);
        recordingsToDispose.push(newRecording!);
      }

      // Track new lock for cleanup
      const newLock = context.recordingCallbacks.getCurrentLockHandle();
      if (newLock) lockHandles.push(newLock);
    });
  });

  // -------------------------------------------------------------------------
  // "latest" Special Cases
  // -------------------------------------------------------------------------

  describe('"latest" Resolution Edge Cases @requirement:REQ-PR-003 @plan:PLAN-20260214-SESSIONBROWSER.P10', () => {
    /**
     * Test 17: "latest" with all locked
     * GIVEN: All sessions are locked
     * WHEN: performResume is called with "latest"
     * THEN: Returns ok:false with error
     */
    it('"latest" returns error when all sessions are locked', async () => {
      const session1 = await createTestSession(chatsDir, {
        contents: [makeContent('session 1')],
      });
      const session2 = await createTestSession(chatsDir, {
        contents: [makeContent('session 2')],
      });

      // Lock both sessions
      const lock1 = await SessionLockManager.acquire(
        chatsDir,
        extractSessionId(session1.filePath),
      );
      const lock2 = await SessionLockManager.acquire(
        chatsDir,
        extractSessionId(session2.filePath),
      );
      lockHandles.push(lock1, lock2);

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'different-session',
      });

      const result = await performResume('latest', context);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.toLowerCase()).toMatch(/no.*session|in use|locked/);
      }
    });

    /**
     * Test 18: "latest" with all empty
     * GIVEN: All sessions have no content events
     * WHEN: performResume is called with "latest"
     * THEN: Returns ok:false with error
     */
    it('"latest" returns error when all sessions are empty', async () => {
      // Create sessions without user content (empty in terms of conversation)
      // These have session_start but no content events
      const emptySessionId1 = 'empty-session-1';
      const emptySessionId2 = 'empty-session-2';

      // Create session files with only session_start (no content events)
      const emptyConfig1 = makeConfig(chatsDir, { sessionId: emptySessionId1 });
      const emptySvc1 = new SessionRecordingService(emptyConfig1);
      emptySvc1.recordSessionEvent('info', 'session started'); // This materializes the file
      await emptySvc1.flush();
      await emptySvc1.dispose();

      const emptyConfig2 = makeConfig(chatsDir, { sessionId: emptySessionId2 });
      const emptySvc2 = new SessionRecordingService(emptyConfig2);
      emptySvc2.recordSessionEvent('info', 'session started');
      await emptySvc2.flush();
      await emptySvc2.dispose();

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'different-session',
      });

      const result = await performResume('latest', context);

      // "latest" should skip empty sessions and return an error
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.toLowerCase()).toMatch(/no.*session|empty/);
      }
    });

    /**
     * Test 19: "latest" skips current session
     * GIVEN: Current session is the newest
     * WHEN: performResume is called with "latest"
     * THEN: Picks the second newest session
     */
    it('"latest" skips current session', async () => {
      // Create older session
      const { sessionId: olderSessionId } = await createTestSession(chatsDir, {
        contents: [makeContent('older session message')],
      });
      await delay(50);

      // Create newer session that will be "current"
      const { sessionId: currentSessionId } = await createTestSession(
        chatsDir,
        {
          contents: [makeContent('current session message')],
        },
      );

      const context = makeResumeContext(chatsDir, {
        currentSessionId,
      });

      const result = await performResume('latest', context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.metadata.sessionId).toBe(olderSessionId);
        expect(result.history[0].blocks[0]).toEqual({
          type: 'text',
          text: 'older session message',
        });
      }

      // Cleanup
      const newLock = context.recordingCallbacks.getCurrentLockHandle();
      if (newLock) lockHandles.push(newLock);
    });
  });

  // -------------------------------------------------------------------------
  // Result Validation
  // -------------------------------------------------------------------------

  describe('Result Validation @requirement:REQ-PR-002 @plan:PLAN-20260214-SESSIONBROWSER.P10', () => {
    /**
     * Test 20: History contains original messages
     * GIVEN: Session with specific content
     * WHEN: performResume succeeds
     * THEN: result.history includes the original user message
     */
    it('history contains original messages', async () => {
      const targetId = 'session-with-history';
      await createTestSession(chatsDir, {
        sessionId: targetId,
        contents: [
          makeContent('user question', 'human'),
          makeContent('ai response', 'ai'),
        ],
      });

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'other-session',
      });

      const result = await performResume(targetId, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.history).toHaveLength(2);
        expect(result.history[0].speaker).toBe('human');
        expect(result.history[0].blocks[0]).toEqual({
          type: 'text',
          text: 'user question',
        });
        expect(result.history[1].speaker).toBe('ai');
        expect(result.history[1].blocks[0]).toEqual({
          type: 'text',
          text: 'ai response',
        });
      }

      // Cleanup
      const newLock = context.recordingCallbacks.getCurrentLockHandle();
      if (newLock) lockHandles.push(newLock);
    });

    /**
     * Test 21: Metadata has correct sessionId
     * GIVEN: Session with known ID
     * WHEN: performResume succeeds
     * THEN: result.metadata.sessionId equals the target session ID
     */
    it('metadata has correct sessionId', async () => {
      const targetId = 'metadata-session-id-test';
      await createTestSession(chatsDir, {
        sessionId: targetId,
        contents: [makeContent('content')],
      });

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'other-session',
      });

      const result = await performResume(targetId, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.metadata.sessionId).toBe(targetId);
      }

      // Cleanup
      const newLock = context.recordingCallbacks.getCurrentLockHandle();
      if (newLock) lockHandles.push(newLock);
    });

    /**
     * Test 22: Warnings array present
     * GIVEN: Normal session
     * WHEN: performResume succeeds
     * THEN: result.warnings is an array
     */
    it('warnings array is present on success', async () => {
      const targetId = 'warnings-array-test';
      await createTestSession(chatsDir, {
        sessionId: targetId,
        contents: [makeContent('content')],
      });

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'other-session',
      });

      const result = await performResume(targetId, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(Array.isArray(result.warnings)).toBe(true);
      }

      // Cleanup
      const newLock = context.recordingCallbacks.getCurrentLockHandle();
      if (newLock) lockHandles.push(newLock);
    });

    /**
     * Test 22a: Warnings from resumeSession are propagated (REQ-RS-012)
     * GIVEN: Session with corrupt JSON line
     * WHEN: performResume succeeds
     * THEN: result.warnings contains warning about parse error
     */
    it('propagates warnings from resume (REQ-RS-012)', async () => {
      const targetId = 'session-with-corruption';
      await createSessionWithCorruptLine(chatsDir, targetId);

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'other-session',
      });

      const result = await performResume(targetId, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // The warnings should include something about parse error
        expect(result.warnings.length).toBeGreaterThan(0);
        const hasParseWarning = result.warnings.some(
          (w) => w.includes('parse') || w.includes('JSON'),
        );
        expect(hasParseWarning).toBe(true);
      }

      // Cleanup
      const newLock = context.recordingCallbacks.getCurrentLockHandle();
      if (newLock) lockHandles.push(newLock);
    });

    /**
     * Test 22b: Empty warnings array when no issues
     * GIVEN: Clean session with no truncation/corruption
     * WHEN: performResume succeeds
     * THEN: result.warnings.length === 0
     */
    it('empty warnings for clean session', async () => {
      const targetId = 'clean-session-no-warnings';
      await createTestSession(chatsDir, {
        sessionId: targetId,
        contents: [makeContent('clean content')],
      });

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'other-session',
      });

      const result = await performResume(targetId, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.warnings.length).toBe(0);
      }

      // Cleanup
      const newLock = context.recordingCallbacks.getCurrentLockHandle();
      if (newLock) lockHandles.push(newLock);
    });

    /**
     * Test 23: New recording writes to new session file
     * GIVEN: Successful resume
     * WHEN: Using the new recording from result
     * THEN: Events are written to the correct file
     */
    it('new recording from result writes to new session file', async () => {
      const targetId = 'new-recording-test';
      const { filePath: targetFilePath } = await createTestSession(chatsDir, {
        sessionId: targetId,
        contents: [makeContent('original content')],
      });

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'other-session',
      });

      const result = await performResume(targetId, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const newRecording = context.recordingCallbacks.getCurrentRecording();
        expect(newRecording).not.toBeNull();
        recordingsToDispose.push(newRecording!);

        // Write and flush
        newRecording!.recordContent(makeContent('new content via result'));
        await newRecording!.flush();

        // Verify content in file
        const events = await readJsonlFile(targetFilePath);
        const contentEvents = events.filter((e) => e.type === 'content');
        const texts = contentEvents.map((e) => {
          const payload = e.payload as { content: IContent };
          const textBlock = payload.content.blocks[0] as { text: string };
          return textBlock.text;
        });
        expect(texts).toContain('new content via result');
      }

      // Cleanup
      const newLock = context.recordingCallbacks.getCurrentLockHandle();
      if (newLock) lockHandles.push(newLock);
    });

    /**
     * Test 24: New lock holds target session
     * GIVEN: Successful resume
     * WHEN: Checking the new lock
     * THEN: Lock handle is returned and lock file exists
     *
     * NOTE: resumeSession uses a truncated lock ID extracted from the session
     * filename (first 12 chars of sessionId + timestamp prefix), so we check
     * that the lock file exists rather than checking for full sessionId.
     */
    it('new lock holds target session', async () => {
      const targetId = 'lock-target-test';
      await createTestSession(chatsDir, {
        sessionId: targetId,
        contents: [makeContent('content')],
      });

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'other-session',
      });

      const result = await performResume(targetId, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const newLock = context.recordingCallbacks.getCurrentLockHandle();
        expect(newLock).not.toBeNull();
        // Lock path should be in the chats directory and end with .lock
        expect(newLock!.lockPath).toContain(chatsDir);
        expect(newLock!.lockPath).toMatch(/\.lock$/);

        // Verify lock file actually exists
        const lockFileExists = await fs
          .stat(newLock!.lockPath)
          .then(() => true)
          .catch(() => false);
        expect(lockFileExists).toBe(true);

        lockHandles.push(newLock!);
      }
    });
  });

  // =========================================================================
  // Property-Based Tests (≥30% = 8+ out of 26+)
  // =========================================================================

  describe('Property-Based Tests @plan:PLAN-20260214-SESSIONBROWSER.P10', () => {
    /**
     * Test 25: Property: result is always discriminated union
     * For any session ref input, result has ok:true or ok:false
     */
    it('result is always a discriminated union', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(
            fc.constant('latest'),
            fc.constant('1'),
            fc.constant('999'),
            fc.string({ minLength: 1, maxLength: 20 }),
          ),
          async (ref) => {
            const localTempDir = await fs.mkdtemp(
              path.join(os.tmpdir(), 'prop-union-'),
            );
            const localChatsDir = path.join(localTempDir, 'chats');
            await fs.mkdir(localChatsDir, { recursive: true });

            try {
              // Create at least one session
              await createTestSession(localChatsDir, {
                projectHash: PROJECT_HASH,
                contents: [makeContent('test content')],
              });

              const context = makeResumeContext(localChatsDir, {
                currentSessionId: 'other-session',
              });

              const result = await performResume(ref, context);

              // Result must have exactly one of ok: true or ok: false
              expect(typeof result.ok).toBe('boolean');
              expect(result).toHaveProperty('ok');

              if (result.ok) {
                expect(result).toHaveProperty('history');
                expect(result).toHaveProperty('metadata');
                expect(result).toHaveProperty('warnings');
              } else {
                expect(result).toHaveProperty('error');
              }

              // Cleanup
              const newLock = context.recordingCallbacks.getCurrentLockHandle();
              if (newLock) await newLock.release();
            } finally {
              await fs.rm(localTempDir, { recursive: true, force: true });
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    /**
     * Test 26: Property: ok:false always has error string
     * For any failure, result.error is a non-empty string
     */
    it('failures always have non-empty error string', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 20 }),
          async (badRef) => {
            // Ensure ref doesn't match any session by using random chars
            const localTempDir = await fs.mkdtemp(
              path.join(os.tmpdir(), 'prop-error-'),
            );
            const localChatsDir = path.join(localTempDir, 'chats');
            await fs.mkdir(localChatsDir, { recursive: true });

            try {
              // Create a session with a known ID
              await createTestSession(localChatsDir, {
                sessionId: 'known-session-id',
                projectHash: PROJECT_HASH,
                contents: [makeContent('content')],
              });

              // Use a ref that definitely won't match
              const unmatchableRef = `unmatchable-${badRef}-${crypto.randomUUID()}`;

              const context = makeResumeContext(localChatsDir, {
                currentSessionId: 'other-session',
              });

              const result = await performResume(unmatchableRef, context);

              if (!result.ok) {
                expect(typeof result.error).toBe('string');
                expect(result.error.length).toBeGreaterThan(0);
              }
            } finally {
              await fs.rm(localTempDir, { recursive: true, force: true });
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    /**
     * Test 27: Property: ok:true always has all fields
     * For any success, history/metadata/warnings are present
     */
    it('successes always have all required fields', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              speaker: fc.constantFrom('human' as const, 'ai' as const),
              text: fc.string({ minLength: 1, maxLength: 50 }),
            }),
            { minLength: 1, maxLength: 5 },
          ),
          async (items) => {
            const localTempDir = await fs.mkdtemp(
              path.join(os.tmpdir(), 'prop-fields-'),
            );
            const localChatsDir = path.join(localTempDir, 'chats');
            await fs.mkdir(localChatsDir, { recursive: true });

            try {
              const contents: IContent[] = items.map((item) => ({
                speaker: item.speaker,
                blocks: [{ type: 'text' as const, text: item.text }],
              }));

              const { sessionId } = await createTestSession(localChatsDir, {
                projectHash: PROJECT_HASH,
                contents,
              });

              const context = makeResumeContext(localChatsDir, {
                currentSessionId: 'other-session',
              });

              const result = await performResume(sessionId, context);

              if (result.ok) {
                expect(Array.isArray(result.history)).toBe(true);
                expect(result.history.length).toBe(contents.length);
                expect(result.metadata).toBeDefined();
                expect(result.metadata.sessionId).toBe(sessionId);
                expect(Array.isArray(result.warnings)).toBe(true);

                // Cleanup lock
                const newLock =
                  context.recordingCallbacks.getCurrentLockHandle();
                if (newLock) await newLock.release();
              }
            } finally {
              await fs.rm(localTempDir, { recursive: true, force: true });
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    /**
     * Test 28: Property: same-session always fails
     * For any context where ref resolves to currentSessionId, result.ok is false
     */
    it('same-session always fails', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 5, maxLength: 20 }),
          async (sessionId) => {
            // Sanitize sessionId to be valid
            const sanitizedId = sessionId.replace(/[^a-zA-Z0-9-]/g, 'x');

            const localTempDir = await fs.mkdtemp(
              path.join(os.tmpdir(), 'prop-same-'),
            );
            const localChatsDir = path.join(localTempDir, 'chats');
            await fs.mkdir(localChatsDir, { recursive: true });

            try {
              await createTestSession(localChatsDir, {
                sessionId: sanitizedId,
                projectHash: PROJECT_HASH,
                contents: [makeContent('content')],
              });

              // Context with same currentSessionId
              const context = makeResumeContext(localChatsDir, {
                currentSessionId: sanitizedId,
              });

              const result = await performResume(sanitizedId, context);

              expect(result.ok).toBe(false);
              if (!result.ok) {
                expect(result.error).toBe('That session is already active.');
              }
            } finally {
              await fs.rm(localTempDir, { recursive: true, force: true });
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    /**
     * Test 29 (extra): Property: history roundtrip preserves content
     * Any IContent written to a session can be read back via performResume
     */
    it('history roundtrip preserves content', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              speaker: fc.constantFrom('human' as const, 'ai' as const),
              text: fc.string({ minLength: 1, maxLength: 100 }),
            }),
            { minLength: 1, maxLength: 5 },
          ),
          async (items) => {
            const localTempDir = await fs.mkdtemp(
              path.join(os.tmpdir(), 'prop-roundtrip-'),
            );
            const localChatsDir = path.join(localTempDir, 'chats');
            await fs.mkdir(localChatsDir, { recursive: true });

            try {
              const contents: IContent[] = items.map((item) => ({
                speaker: item.speaker,
                blocks: [{ type: 'text' as const, text: item.text }],
              }));

              const { sessionId } = await createTestSession(localChatsDir, {
                projectHash: PROJECT_HASH,
                contents,
              });

              const context = makeResumeContext(localChatsDir, {
                currentSessionId: 'other-session',
              });

              const result = await performResume(sessionId, context);

              expect(result.ok).toBe(true);
              if (result.ok) {
                expect(result.history).toHaveLength(contents.length);
                for (let i = 0; i < contents.length; i++) {
                  expect(result.history[i].speaker).toBe(contents[i].speaker);
                  expect(result.history[i].blocks[0]).toEqual(
                    contents[i].blocks[0],
                  );
                }

                // Cleanup lock
                const newLock =
                  context.recordingCallbacks.getCurrentLockHandle();
                if (newLock) await newLock.release();
              }
            } finally {
              await fs.rm(localTempDir, { recursive: true, force: true });
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    /**
     * Test 30 (extra): Property: index within bounds succeeds
     * For sessions 1..N, any valid index 1..N returns ok:true
     */
    it('valid index within bounds succeeds', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 2, max: 5 }),
          async (sessionCount) => {
            const localTempDir = await fs.mkdtemp(
              path.join(os.tmpdir(), 'prop-index-'),
            );
            const localChatsDir = path.join(localTempDir, 'chats');
            await fs.mkdir(localChatsDir, { recursive: true });

            try {
              // Create N sessions
              for (let i = 0; i < sessionCount; i++) {
                await createTestSession(localChatsDir, {
                  projectHash: PROJECT_HASH,
                  contents: [makeContent(`session ${i + 1}`)],
                });
                await delay(20); // Ensure different modification times
              }

              // Pick a random valid index
              const validIndex = Math.floor(Math.random() * sessionCount) + 1;

              const context = makeResumeContext(localChatsDir, {
                currentSessionId: 'other-session',
              });

              const result = await performResume(String(validIndex), context);

              expect(result.ok).toBe(true);

              // Cleanup lock
              if (result.ok) {
                const newLock =
                  context.recordingCallbacks.getCurrentLockHandle();
                if (newLock) await newLock.release();
              }
            } finally {
              await fs.rm(localTempDir, { recursive: true, force: true });
            }
          },
        ),
        { numRuns: 5 },
      );
    });

    /**
     * Test 31 (extra): Property: metadata.sessionId always matches target
     * On successful resume, metadata.sessionId equals the resolved session ID
     */
    it('metadata.sessionId always matches target', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 5, maxLength: 20 }),
          async (rawId) => {
            const sessionId = `target-${rawId.replace(/[^a-zA-Z0-9-]/g, 'x')}`;

            const localTempDir = await fs.mkdtemp(
              path.join(os.tmpdir(), 'prop-meta-'),
            );
            const localChatsDir = path.join(localTempDir, 'chats');
            await fs.mkdir(localChatsDir, { recursive: true });

            try {
              await createTestSession(localChatsDir, {
                sessionId,
                projectHash: PROJECT_HASH,
                contents: [makeContent('content')],
              });

              const context = makeResumeContext(localChatsDir, {
                currentSessionId: 'other-session',
              });

              const result = await performResume(sessionId, context);

              expect(result.ok).toBe(true);
              if (result.ok) {
                expect(result.metadata.sessionId).toBe(sessionId);

                // Cleanup lock
                const newLock =
                  context.recordingCallbacks.getCurrentLockHandle();
                if (newLock) await newLock.release();
              }
            } finally {
              await fs.rm(localTempDir, { recursive: true, force: true });
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    /**
     * Test 32 (extra): Property: locked sessions are always rejected
     * For any session that is locked, performResume returns ok:false
     */
    it('locked sessions are always rejected', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 5, maxLength: 15 }),
          async (rawId) => {
            const sessionId = `locked-${rawId.replace(/[^a-zA-Z0-9-]/g, 'x')}`;

            const localTempDir = await fs.mkdtemp(
              path.join(os.tmpdir(), 'prop-locked-'),
            );
            const localChatsDir = path.join(localTempDir, 'chats');
            await fs.mkdir(localChatsDir, { recursive: true });

            try {
              await createTestSession(localChatsDir, {
                sessionId,
                projectHash: PROJECT_HASH,
                contents: [makeContent('content')],
              });

              // Lock the session
              const lock = await SessionLockManager.acquire(
                localChatsDir,
                sessionId,
              );

              const context = makeResumeContext(localChatsDir, {
                currentSessionId: 'other-session',
              });

              const result = await performResume(sessionId, context);

              expect(result.ok).toBe(false);
              if (!result.ok) {
                expect(result.error.toLowerCase()).toContain('in use');
              }

              // Cleanup lock
              await lock.release();
            } finally {
              await fs.rm(localTempDir, { recursive: true, force: true });
            }
          },
        ),
        { numRuns: 10 },
      );
    });
  });
});
