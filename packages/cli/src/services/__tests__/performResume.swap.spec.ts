/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260214-SESSIONBROWSER.P10
 * @requirement REQ-SW-001, REQ-SW-002, REQ-SW-003, REQ-SW-004, REQ-SW-005, REQ-PR-003, REQ-EH-004
 *
 * Behavioral tests for performResume two-phase swap and "latest" resolution
 * edge cases. Split from the original performResume.spec.ts for max-lines
 * compliance.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  performResume,
  SessionRecordingService,
  SessionLockManager,
  type LockHandle,
  type IContent,
  makeConfig,
  makeContent,
  makeResumeContext,
  createTestSession,
  countFileEvents,
  readJsonlFile,
  extractSessionId,
  PROJECT_HASH,
  assertResumeOk,
  assertResumeError,
  collectLock,
  ResumeTestSetup,
} from './performResume-test-helpers.js';

describe('performResume swap and latest @plan:PLAN-20260214-SESSIONBROWSER.P10', () => {
  const setup = new ResumeTestSetup();
  let chatsDir: string;
  let lockHandles: LockHandle[];
  let recordingsToDispose: SessionRecordingService[];

  beforeEach(async () => {
    await setup.beforeEach();
    chatsDir = setup.chatsDir;
    lockHandles = setup.lockHandles;
    recordingsToDispose = setup.recordingsToDispose;
  });

  afterEach(() => setup.afterEach());

  describe('Two-Phase Swap @requirement:REQ-SW-001,REQ-SW-002 @plan:PLAN-20260214-SESSIONBROWSER.P10', () => {
    /**
     * Test 10: Phase 1 failure preserves old session (REQ-SW-002, REQ-EH-004)
     */
    it('Phase 1 failure preserves old session - can still write to old file', async () => {
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

      const targetId = 'target-locked-session';
      await createTestSession(chatsDir, {
        sessionId: targetId,
        contents: [makeContent('target content')],
      });
      const targetLock = await SessionLockManager.acquire(chatsDir, targetId);
      lockHandles.push(targetLock);

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'old-current-session',
        currentRecording: oldRecording,
      });

      const result = await performResume(targetId, context);
      expect(result.ok).toBe(false);

      oldRecording.recordContent(
        makeContent('new message after failed resume'),
      );
      await oldRecording.flush();

      const oldEventCountAfter = await countFileEvents(oldFilePath);
      expect(oldEventCountAfter).toBeGreaterThan(oldEventCountBefore);
    });

    /**
     * Test 11: After resume, old session file is closed
     */
    it('after resume, old session file is closed', async () => {
      const oldConfig = makeConfig(chatsDir, {
        sessionId: 'old-session-to-close',
        projectHash: PROJECT_HASH,
      });
      const oldRecording = new SessionRecordingService(oldConfig);
      oldRecording.recordContent(makeContent('old message'));
      await oldRecording.flush();
      const oldFilePath = oldRecording.getFilePath()!;
      recordingsToDispose.push(oldRecording);

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

      const result = await performResume(targetId, context);
      expect(result.ok).toBe(true);

      oldRecording.recordContent(makeContent('should not appear'));
      await oldRecording.flush();

      const oldEventCountAfter = await countFileEvents(oldFilePath);
      expect(oldEventCountAfter).toBe(oldEventCountBefore);
    });

    /**
     * Test 12: After resume, new events go to new file
     */
    it('after resume, new events go to new file', async () => {
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

      assertResumeOk(result);
      const newRecording = context.recordingCallbacks.getCurrentRecording();
      expect(newRecording).not.toBeNull();
      recordingsToDispose.push(newRecording!);

      const eventCountBefore = await countFileEvents(targetFilePath);

      newRecording!.recordContent(makeContent('new event after resume'));
      await newRecording!.flush();

      const eventCountAfter = await countFileEvents(targetFilePath);
      expect(eventCountAfter).toBeGreaterThan(eventCountBefore);

      const events = await readJsonlFile(targetFilePath);
      const lastContentEvent = events.filter((e) => e.type === 'content').pop();
      const payload = lastContentEvent?.payload as { content: IContent };
      expect(payload.content.blocks[0]).toStrictEqual({
        type: 'text',
        text: 'new event after resume',
      });
    });

    /**
     * Test 13: After resume, old lock file is released (REQ-SW-004)
     */
    it('after resume, old lock file is released', async () => {
      const oldSessionId = 'old-session-with-lock';

      await createTestSession(chatsDir, {
        sessionId: oldSessionId,
        contents: [makeContent('old locked content')],
      });
      const oldLock = await SessionLockManager.acquire(chatsDir, oldSessionId);

      const targetId = 'target-for-lock-release';
      await createTestSession(chatsDir, {
        sessionId: targetId,
        contents: [makeContent('target content')],
      });

      const context = makeResumeContext(chatsDir, {
        currentSessionId: oldSessionId,
        currentLockHandle: oldLock,
      });

      expect(await SessionLockManager.isLocked(chatsDir, oldSessionId)).toBe(
        true,
      );

      const result = await performResume(targetId, context);
      expect(result.ok).toBe(true);

      expect(await SessionLockManager.isLocked(chatsDir, oldSessionId)).toBe(
        false,
      );

      const newLock = context.recordingCallbacks.getCurrentLockHandle();
      collectLock(lockHandles, newLock);
    });

    /**
     * Test 14: Phase 2 skips null lock gracefully (REQ-SW-004)
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

      const newLock = context.recordingCallbacks.getCurrentLockHandle();
      collectLock(lockHandles, newLock);
    });

    /**
     * Test 15: After resume, old file event count unchanged
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

      const newLock = context.recordingCallbacks.getCurrentLockHandle();
      collectLock(lockHandles, newLock);
    });

    /**
     * Test 16: Lock release failure tolerance (REQ-SW-005)
     */
    it('tolerates lock release failure', async () => {
      const oldSessionId = 'old-session-release-fail';

      await createTestSession(chatsDir, {
        sessionId: oldSessionId,
        contents: [makeContent('old content')],
      });
      const oldLock = await SessionLockManager.acquire(chatsDir, oldSessionId);

      await oldLock.release();

      const targetId = 'target-release-fail-test';
      await createTestSession(chatsDir, {
        sessionId: targetId,
        contents: [makeContent('target content')],
      });

      const context = makeResumeContext(chatsDir, {
        currentSessionId: oldSessionId,
        currentLockHandle: oldLock,
      });

      const result = await performResume(targetId, context);

      expect(result.ok).toBe(true);
      assertResumeOk(result);
      const newRecording = context.recordingCallbacks.getCurrentRecording();
      expect(newRecording).not.toBeNull();
      expect(newRecording!.isActive()).toBe(true);
      recordingsToDispose.push(newRecording!);

      const newLock = context.recordingCallbacks.getCurrentLockHandle();
      collectLock(lockHandles, newLock);
    });
  });

  describe('"latest" Resolution Edge Cases @requirement:REQ-PR-003 @plan:PLAN-20260214-SESSIONBROWSER.P10', () => {
    /**
     * Test 17: "latest" with all locked
     */
    it('"latest" returns error when all sessions are locked', async () => {
      const session1 = await createTestSession(chatsDir, {
        contents: [makeContent('session 1')],
      });
      const session2 = await createTestSession(chatsDir, {
        contents: [makeContent('session 2')],
      });

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
      assertResumeError(result);
      expect(result.error.toLowerCase()).toMatch(/no.*session|in use|locked/);
    });

    /**
     * Test 18: "latest" with all empty
     */
    it('"latest" returns error when all sessions are empty', async () => {
      const emptySessionId1 = 'empty-session-1';
      const emptySessionId2 = 'empty-session-2';

      const emptyConfig1 = makeConfig(chatsDir, { sessionId: emptySessionId1 });
      const emptySvc1 = new SessionRecordingService(emptyConfig1);
      emptySvc1.recordSessionEvent('info', 'session started');
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

      expect(result.ok).toBe(false);
      assertResumeError(result);
      expect(result.error.toLowerCase()).toMatch(/no.*session|empty/);
    });

    /**
     * Test 19: "latest" skips current session
     */
    it('"latest" skips current session', async () => {
      const { sessionId: olderSessionId } = await createTestSession(chatsDir, {
        contents: [makeContent('older session message')],
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

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
      assertResumeOk(result);
      expect(result.metadata.sessionId).toBe(olderSessionId);
      expect(result.history[0].blocks[0]).toStrictEqual({
        type: 'text',
        text: 'older session message',
      });

      const newLock = context.recordingCallbacks.getCurrentLockHandle();
      collectLock(lockHandles, newLock);
    });
  });
});
