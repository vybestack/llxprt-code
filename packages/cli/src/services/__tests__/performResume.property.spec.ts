/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260214-SESSIONBROWSER.P10
 * @requirement REQ-PR-002, REQ-PR-003, REQ-RS-012
 *
 * Result validation and property-based tests for performResume. Split from
 * the original performResume.spec.ts for max-lines compliance. Property-based
 * tests use fast-check (≥30% of total tests).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  performResume,
  SessionRecordingService,
  SessionLockManager,
  type LockHandle,
  type IContent,
  makeContent,
  makeResumeContext,
  createTestSession,
  createSessionWithCorruptLine,
  readJsonlFile,
  PROJECT_HASH,
  assertResumeOk,
  assertResumeError,
  collectLock,
  releaseLock,
  expectResultDiscriminated,
  ResumeTestSetup,
} from './performResume-test-helpers.js';

describe('performResume validation and property tests @plan:PLAN-20260214-SESSIONBROWSER.P10', () => {
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

  describe('Result Validation @requirement:REQ-PR-002 @plan:PLAN-20260214-SESSIONBROWSER.P10', () => {
    /**
     * Test 20: History contains original messages
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
      assertResumeOk(result);
      expect(result.history).toHaveLength(2);
      expect(result.history[0].speaker).toBe('human');
      expect(result.history[0].blocks[0]).toStrictEqual({
        type: 'text',
        text: 'user question',
      });
      expect(result.history[1].speaker).toBe('ai');
      expect(result.history[1].blocks[0]).toStrictEqual({
        type: 'text',
        text: 'ai response',
      });

      const newLock = context.recordingCallbacks.getCurrentLockHandle();
      collectLock(lockHandles, newLock);
    });

    /**
     * Test 21: Metadata has correct sessionId
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
      assertResumeOk(result);
      expect(result.metadata.sessionId).toBe(targetId);

      const newLock = context.recordingCallbacks.getCurrentLockHandle();
      collectLock(lockHandles, newLock);
    });

    /**
     * Test 22: Warnings array present
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
      assertResumeOk(result);
      expect(Array.isArray(result.warnings)).toBe(true);

      const newLock = context.recordingCallbacks.getCurrentLockHandle();
      collectLock(lockHandles, newLock);
    });

    /**
     * Test 22a: Warnings from resumeSession are propagated (REQ-RS-012)
     */
    it('propagates warnings from resume (REQ-RS-012)', async () => {
      const targetId = 'session-with-corruption';
      await createSessionWithCorruptLine(chatsDir, targetId);

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'other-session',
      });

      const result = await performResume(targetId, context);

      expect(result.ok).toBe(true);
      assertResumeOk(result);
      expect(result.warnings.length).toBeGreaterThan(0);
      const hasParseWarning = result.warnings.some(
        (w) => w.includes('parse') || w.includes('JSON'),
      );
      expect(hasParseWarning).toBe(true);

      const newLock = context.recordingCallbacks.getCurrentLockHandle();
      collectLock(lockHandles, newLock);
    });

    /**
     * Test 22b: Empty warnings array when no issues
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
      assertResumeOk(result);
      expect(result.warnings.length).toBe(0);

      const newLock = context.recordingCallbacks.getCurrentLockHandle();
      collectLock(lockHandles, newLock);
    });

    /**
     * Test 23: New recording writes to new session file
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
      assertResumeOk(result);
      const newRecording = context.recordingCallbacks.getCurrentRecording();
      expect(newRecording).not.toBeNull();
      recordingsToDispose.push(newRecording!);

      newRecording!.recordContent(makeContent('new content via result'));
      await newRecording!.flush();

      const events = await readJsonlFile(targetFilePath);
      const contentEvents = events.filter((e) => e.type === 'content');
      const texts = contentEvents.map((e) => {
        const payload = e.payload as { content: IContent };
        const textBlock = payload.content.blocks[0] as { text: string };
        return textBlock.text;
      });
      expect(texts).toContain('new content via result');

      const newLock = context.recordingCallbacks.getCurrentLockHandle();
      collectLock(lockHandles, newLock);
    });

    /**
     * Test 24: New lock holds target session
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
      assertResumeOk(result);
      const newLock = context.recordingCallbacks.getCurrentLockHandle();
      expect(newLock).not.toBeNull();
      expect(newLock!.lockPath).toContain(chatsDir);
      expect(newLock!.lockPath).toMatch(/\.lock$/);

      const lockFileExists = await fs
        .stat(newLock!.lockPath)
        .then(() => true)
        .catch(() => false);
      expect(lockFileExists).toBe(true);

      lockHandles.push(newLock!);
    });
  });

  // =========================================================================
  // Property-Based Tests (≥30% = 8+ out of 26+)
  // =========================================================================

  describe('Property-Based Tests @plan:PLAN-20260214-SESSIONBROWSER.P10', () => {
    /**
     * Test 25: Property: result is always discriminated union
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
              await createTestSession(localChatsDir, {
                projectHash: PROJECT_HASH,
                contents: [makeContent('test content')],
              });

              const context = makeResumeContext(localChatsDir, {
                currentSessionId: 'other-session',
              });

              const result = await performResume(ref, context);

              expect(typeof result.ok).toBe('boolean');
              expect(result).toHaveProperty('ok');

              expectResultDiscriminated(result, expect);

              const newLock = context.recordingCallbacks.getCurrentLockHandle();
              await releaseLock(newLock);
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
     */
    it('failures always have non-empty error string', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 20 }),
          async (badRef) => {
            const localTempDir = await fs.mkdtemp(
              path.join(os.tmpdir(), 'prop-error-'),
            );
            const localChatsDir = path.join(localTempDir, 'chats');
            await fs.mkdir(localChatsDir, { recursive: true });

            try {
              await createTestSession(localChatsDir, {
                sessionId: 'known-session-id',
                projectHash: PROJECT_HASH,
                contents: [makeContent('content')],
              });

              const unmatchableRef = `unmatchable-${badRef}-${crypto.randomUUID()}`;

              const context = makeResumeContext(localChatsDir, {
                currentSessionId: 'other-session',
              });

              const result = await performResume(unmatchableRef, context);

              assertResumeError(result);
              expect(typeof result.error).toBe('string');
              expect(result.error.length).toBeGreaterThan(0);
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

              assertResumeOk(result);
              expect(Array.isArray(result.history)).toBe(true);
              expect(result.history.length).toBe(contents.length);
              expect(result.metadata).toBeDefined();
              expect(result.metadata.sessionId).toBe(sessionId);
              expect(Array.isArray(result.warnings)).toBe(true);

              const newLock = context.recordingCallbacks.getCurrentLockHandle();
              await releaseLock(newLock);
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
     */
    it('same-session always fails', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 5, maxLength: 20 }),
          async (sessionId) => {
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

              const context = makeResumeContext(localChatsDir, {
                currentSessionId: sanitizedId,
              });

              const result = await performResume(sanitizedId, context);

              expect(result.ok).toBe(false);
              assertResumeError(result);
              expect(result.error).toBe('That session is already active.');
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
              assertResumeOk(result);
              expect(result.history).toHaveLength(contents.length);
              for (let i = 0; i < contents.length; i++) {
                expect(result.history[i].speaker).toBe(contents[i].speaker);
                expect(result.history[i].blocks[0]).toStrictEqual(
                  contents[i].blocks[0],
                );
              }

              const newLock = context.recordingCallbacks.getCurrentLockHandle();
              await releaseLock(newLock);
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
     */
    it('valid index within bounds succeeds', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 2, max: 5 }),
          fc.nat(),
          async (sessionCount, indexSeed) => {
            const localTempDir = await fs.mkdtemp(
              path.join(os.tmpdir(), 'prop-index-'),
            );
            const localChatsDir = path.join(localTempDir, 'chats');
            await fs.mkdir(localChatsDir, { recursive: true });

            try {
              for (let i = 0; i < sessionCount; i++) {
                await createTestSession(localChatsDir, {
                  projectHash: PROJECT_HASH,
                  contents: [makeContent(`session ${i + 1}`)],
                });
                await new Promise((resolve) => setTimeout(resolve, 20));
              }

              const validIndex = (indexSeed % sessionCount) + 1;

              const context = makeResumeContext(localChatsDir, {
                currentSessionId: 'other-session',
              });

              const result = await performResume(String(validIndex), context);

              expect(result.ok).toBe(true);

              assertResumeOk(result);
              const newLock = context.recordingCallbacks.getCurrentLockHandle();
              await releaseLock(newLock);
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
              assertResumeOk(result);
              expect(result.metadata.sessionId).toBe(sessionId);

              const newLock = context.recordingCallbacks.getCurrentLockHandle();
              await releaseLock(newLock);
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

              const lock = await SessionLockManager.acquire(
                localChatsDir,
                sessionId,
              );

              const context = makeResumeContext(localChatsDir, {
                currentSessionId: 'other-session',
              });

              const result = await performResume(sessionId, context);

              expect(result.ok).toBe(false);
              assertResumeError(result);
              expect(result.error.toLowerCase()).toContain('in use');

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
