/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { collectResumeRows } from '../../__tests__/resumeRows.js';

/**
 * @plan PLAN-20260214-SESSIONBROWSER.P10
 * @requirement REQ-PR-001, REQ-RC-008, REQ-RC-009
 *
 * Behavioral tests for performResume session resolution and error cases.
 * Split from the original performResume.spec.ts for max-lines compliance.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  performResume,
  SessionLockManager,
  type LockHandle,
  makeContent,
  makeResumeContext,
  createTestSession,
  assertResumeOk,
  assertResumeError,
  collectLock,
  ResumeTestSetup,
} from './performResume-test-helpers.js';

let chatsDir: string;
let lockHandles: LockHandle[];
describe('performResume @plan:PLAN-20260214-SESSIONBROWSER.P10', () => {
  const setup = new ResumeTestSetup();

  beforeEach(async () => {
    await setup.beforeEach();
    chatsDir = setup.chatsDir;
    lockHandles = setup.lockHandles;
  });

  afterEach(() => setup.afterEach());

  describe('Session Resolution @requirement:REQ-PR-001 @plan:PLAN-20260214-SESSIONBROWSER.P10', () => {
    /**
     * Test 1: Resolve by session ID
     */
    it('resolves session by exact session ID', testResolutionById);
    /**
     * Test 2: Resolve by "latest"
     */
    it('resolves "latest" to newest resumable session', testResolutionLatest);
    /**
     * Test 3: Resolve by index
     */
    it('resolves index "1" to the first (newest) session', testResolutionIndex);
    /**
     * Test 4: Resolve by prefix
     */
    it('resolves unique prefix to matching session', testResolutionPrefix);
  });

  describe('Error Cases @requirement:REQ-RC-008,REQ-RC-009 @plan:PLAN-20260214-SESSIONBROWSER.P10', () => {
    /**
     * Test 5: Same-session error (REQ-RC-009)
     */
    it('returns error for same-session resume', testErrorsSameSession);
    /**
     * Test 6: Locked session error (REQ-RC-008)
     */
    it('returns error for locked session', testErrorsLocked);
    /**
     * Test 7: Missing session error
     */
    it('returns error for non-existent session', testErrorsMissing);
    /**
     * Test 8: Ambiguous prefix error
     */
    it('returns error for ambiguous prefix', testErrorsAmbiguous);
    /**
     * Test 9: Out-of-range index error
     */
    it('returns error for out-of-range index', testErrorsOutOfRange);
  });
});

async function testResolutionById(): Promise<void> {
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
  assertResumeOk(result);
  const restoredRows = await collectResumeRows(result.history);
  expect(restoredRows).toHaveLength(1);
  expect(restoredRows[0].blocks[0]).toStrictEqual({
    type: 'text',
    text: 'target session content',
  });

  const newLock = context.recordingCallbacks.getCurrentLockHandle();
  collectLock(lockHandles, newLock);
}

async function testResolutionLatest(): Promise<void> {
  await createTestSession(chatsDir, {
    contents: [makeContent('older session')],
  });
  await new Promise((resolve) => setTimeout(resolve, 50));

  const { sessionId: newerSessionId } = await createTestSession(chatsDir, {
    contents: [makeContent('newer session')],
  });

  const context = makeResumeContext(chatsDir, {
    currentSessionId: 'completely-different-session',
  });

  const result = await performResume('latest', context);

  expect(result.ok).toBe(true);
  assertResumeOk(result);
  const restoredRows = await collectResumeRows(result.history);
  expect(restoredRows[0].blocks[0]).toStrictEqual({
    type: 'text',
    text: 'newer session',
  });
  expect(result.metadata.sessionId).toBe(newerSessionId);

  const newLock = context.recordingCallbacks.getCurrentLockHandle();
  collectLock(lockHandles, newLock);
}

async function testResolutionIndex(): Promise<void> {
  await createTestSession(chatsDir, {
    contents: [makeContent('oldest session')],
  });
  await new Promise((resolve) => setTimeout(resolve, 50));

  const { sessionId } = await createTestSession(chatsDir, {
    contents: [makeContent('newest session for index')],
  });

  const context = makeResumeContext(chatsDir, {
    currentSessionId: 'different-session',
  });

  const result = await performResume('1', context);

  expect(result.ok).toBe(true);
  assertResumeOk(result);
  const restoredRows = await collectResumeRows(result.history);
  expect(result.metadata.sessionId).toBe(sessionId);
  expect(restoredRows[0].blocks[0]).toStrictEqual({
    type: 'text',
    text: 'newest session for index',
  });

  const newLock = context.recordingCallbacks.getCurrentLockHandle();
  collectLock(lockHandles, newLock);
}

async function testResolutionPrefix(): Promise<void> {
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
  assertResumeOk(result);
  expect(result.metadata.sessionId).toBe(targetId);

  const newLock = context.recordingCallbacks.getCurrentLockHandle();
  collectLock(lockHandles, newLock);
}

async function testErrorsSameSession(): Promise<void> {
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
  assertResumeError(result);
  expect(result.error).toBe('That session is already active.');
}

async function testErrorsLocked(): Promise<void> {
  const sessionId = 'locked-session-test';
  await createTestSession(chatsDir, {
    sessionId,
    contents: [makeContent('locked content')],
  });

  const handle = await SessionLockManager.acquire(chatsDir, sessionId);
  lockHandles.push(handle);

  const context = makeResumeContext(chatsDir, {
    currentSessionId: 'other-session',
  });

  const result = await performResume(sessionId, context);

  expect(result.ok).toBe(false);
  assertResumeError(result);
  expect(result.error.toLowerCase()).toContain('in use');
}

async function testErrorsMissing(): Promise<void> {
  await createTestSession(chatsDir, {
    contents: [makeContent('existing content')],
  });

  const context = makeResumeContext(chatsDir, {
    currentSessionId: 'other-session',
  });

  const result = await performResume('nonexistent-session-id', context);

  expect(result.ok).toBe(false);
  assertResumeError(result);
  expect(result.error).toBeTruthy();
}

async function testErrorsAmbiguous(): Promise<void> {
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

  const result = await performResume('ambig-', context);

  expect(result.ok).toBe(false);
  assertResumeError(result);
  expect(result.error.toLowerCase()).toContain('ambiguous');
  expect(result.error).toContain('ambig-first-session');
  expect(result.error).toContain('ambig-second-session');
}

async function testErrorsOutOfRange(): Promise<void> {
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
  assertResumeError(result);
  expect(result.error).toMatch(/out of range|not found/i);
}
