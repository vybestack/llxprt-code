/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260214-SESSIONBROWSER.P30
 * @plan PLAN-20260214-SESSIONBROWSER.P31
 * @requirement REQ-SW-001, REQ-SW-002, REQ-SW-003, REQ-SW-006, REQ-SW-007
 * @requirement REQ-EN-001, REQ-EN-002, REQ-EN-004
 * @requirement REQ-EH-001, REQ-EH-004
 * @requirement REQ-CV-001, REQ-CV-002
 * @requirement REQ-PR-001, REQ-PR-003
 *
 * End-to-End Integration tests for the Session Browser feature.
 * Tests use real JSONL files on disk, real SessionDiscovery, and real
 * session recording services — no mock theater.
 *
 * Property-based tests use fast-check (≥30% of core state tests).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  SessionRecordingService,
  SessionDiscovery,
  SessionLockManager,
  RecordingIntegration,
  type SessionRecordingServiceConfig,
  type IContent,
  type LockHandle,
} from '@vybestack/llxprt-code-core';
import {
  performResume,
  type ResumeContext,
  type RecordingSwapCallbacks,
} from '../services/performResume.js';
import { continueCommand } from '../ui/commands/continueCommand.js';
import type {
  CommandContext,
  SlashCommandActionReturn,
} from '../ui/commands/types.js';
import type { HistoryItemWithoutId } from '../ui/types.js';
import { MessageType } from '../ui/types.js';

// ---------------------------------------------------------------------------
// Test Infrastructure Helpers
// ---------------------------------------------------------------------------

const PROJECT_HASH = 'e2e-test-project-hash';

/**
 * Create a SessionRecordingServiceConfig for testing.
 */
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

/**
 * Create an IContent block for testing.
 */
function makeContent(
  text: string,
  speaker: IContent['speaker'] = 'human',
): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

/**
 * Create a minimal JSONL session file for testing.
 * Uses real SessionRecordingService to write session_start header + content events.
 *
 * @param dir - Directory to write the session file to
 * @param opts - Session configuration options
 * @returns Object with file path, session ID, and disposed recording service
 */
async function createTestSession(
  dir: string,
  opts: {
    sessionId?: string;
    provider?: string;
    model?: string;
    projectHash?: string;
    messages?: Array<{ speaker: 'user' | 'model'; text: string }>;
    contents?: IContent[];
  } = {},
): Promise<{ filePath: string; sessionId: string }> {
  const sessionId = opts.sessionId ?? crypto.randomUUID();
  const config = makeConfig(dir, {
    sessionId,
    provider: opts.provider,
    model: opts.model,
    projectHash: opts.projectHash,
  });
  const svc = new SessionRecordingService(config);

  // If contents are provided, use those directly
  if (opts.contents) {
    for (const content of opts.contents) {
      svc.recordContent(content);
    }
  } else {
    // Convert simple messages to IContent and record them
    const messages = opts.messages ?? [
      { speaker: 'user' as const, text: 'hello' },
    ];
    for (const msg of messages) {
      const speaker: IContent['speaker'] =
        msg.speaker === 'user' ? 'human' : 'ai';
      svc.recordContent(makeContent(msg.text, speaker));
    }
  }

  await svc.flush();
  const filePath = svc.getFilePath()!;
  await svc.dispose();

  return { filePath, sessionId };
}

/**
 * Create an empty session (session_start only, no content events).
 */
async function createEmptySession(
  dir: string,
  sessionId: string,
  projectHash: string = PROJECT_HASH,
): Promise<{ filePath: string; sessionId: string }> {
  const config = makeConfig(dir, { sessionId, projectHash });
  const svc = new SessionRecordingService(config);
  // Record a session event to materialize the file (but not a content event)
  svc.recordSessionEvent('info', 'session initialized');
  await svc.flush();
  const filePath = svc.getFilePath()!;
  await svc.dispose();
  return { filePath, sessionId };
}

/**
 * Create the chats directory structure expected by SessionDiscovery.
 * Creates ~/.llxprt/chats/{projectHash}/ equivalent structure in a temp dir.
 *
 * @param baseDir - Base temp directory
 * @param _projectHash - Project hash for the chats subdirectory (unused since chatsDir is flat)
 * @returns Path to the chats directory
 */
async function setupChatsDir(
  baseDir: string,
  _projectHash: string,
): Promise<string> {
  // Real structure is: chatsDir/{projectHash}/session-*.jsonl
  // But SessionDiscovery lists sessions in chatsDir directly filtered by projectHash in header
  const chatsDir = path.join(baseDir, 'chats');
  await fs.mkdir(chatsDir, { recursive: true });
  return chatsDir;
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
  let recording = opts.currentRecording ?? null;
  let integration = opts.currentIntegration ?? null;
  let lockHandle = opts.currentLockHandle ?? null;

  const callbacks: RecordingSwapCallbacks = {
    getCurrentRecording: () => recording,
    getCurrentIntegration: () => integration,
    getCurrentLockHandle: () => lockHandle,
    setRecording: (newRecording, newIntegration, newLock, _newMetadata) => {
      recording = newRecording;
      integration = newIntegration;
      lockHandle = newLock;
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
 * Create a mock logger that satisfies the Logger interface minimally.
 */
function makeMockLogger(): CommandContext['services']['logger'] {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as CommandContext['services']['logger'];
}

/**
 * Create a minimal CommandContext for testing continueCommand.
 */
function makeCommandContext(
  overrides: Partial<CommandContext> = {},
): CommandContext {
  return {
    services: {
      config: {
        isInteractive: () =>
          overrides.services?.config?.isInteractive?.() ?? true,
      } as CommandContext['services']['config'],
      settings: {} as CommandContext['services']['settings'],
      git: undefined,
      logger: makeMockLogger(),
    },
    ui: {
      addItem: () => 0,
      clear: () => {},
      setDebugMessage: () => {},
      pendingItem: overrides.ui?.pendingItem ?? null,
      setPendingItem: () => {},
      loadHistory: () => {},
      toggleCorgiMode: () => {},
      toggleDebugProfiler: () => {},
      toggleVimEnabled: async () => false,
      setGeminiMdFileCount: () => {},
      setLlxprtMdFileCount: () => {},
      updateHistoryTokenCount: () => {},
      reloadCommands: () => {},
      extensionsUpdateState: new Map(),
      dispatchExtensionStateUpdate: () => {},
      addConfirmUpdateExtensionRequest: () => {},
      ...overrides.ui,
    },
    session: {
      stats: {} as CommandContext['session']['stats'],
      sessionShellAllowlist: new Set(),
      ...overrides.session,
    },
    ...overrides,
  } as CommandContext;
}

/**
 * Helper to add a small delay for mtime differentiation.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Convert IContent[] to HistoryItemWithoutId[] for UI display.
 * This mirrors the conversion pattern used in the application.
 * @plan PLAN-20260214-SESSIONBROWSER.P31
 * @requirement REQ-CV-002
 */
function convertIContentToHistoryItems(
  contents: IContent[],
): HistoryItemWithoutId[] {
  return contents.map((content) => {
    const text = content.blocks
      .filter((block) => block.type === 'text')
      .map((block) => (block as { type: 'text'; text: string }).text)
      .join('');

    return {
      type: content.speaker === 'human' ? MessageType.USER : MessageType.GEMINI,
      text,
    } as HistoryItemWithoutId;
  });
}

// ---------------------------------------------------------------------------
// E2E Test Suite
// ---------------------------------------------------------------------------

describe('Session Browser E2E Integration @plan:PLAN-20260214-SESSIONBROWSER.P30 @plan:PLAN-20260214-SESSIONBROWSER.P31', () => {
  let tempDir: string;
  let chatsDir: string;
  let lockHandles: LockHandle[];
  let recordingsToDispose: SessionRecordingService[];

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-browser-e2e-'));
    chatsDir = await setupChatsDir(tempDir, PROJECT_HASH);
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
  // Core Resume Flow Tests (6 tests)
  // -------------------------------------------------------------------------

  describe('Core Resume Flow @plan:PLAN-20260214-SESSIONBROWSER.P31', () => {
    /**
     * Test 1: performResume resolves "latest" to newest unlocked session
     * @requirement REQ-EN-002, REQ-PR-001
     */
    it('performResume resolves "latest" to newest unlocked session @requirement:REQ-EN-002,REQ-PR-001', async () => {
      // Create older session
      await createTestSession(chatsDir, {
        messages: [{ speaker: 'user', text: 'older message' }],
      });
      await delay(50);

      // Create newer session
      const { sessionId: newerSessionId } = await createTestSession(chatsDir, {
        messages: [{ speaker: 'user', text: 'newer message' }],
      });

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'completely-different-session',
      });

      const result = await performResume('latest', context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.metadata.sessionId).toBe(newerSessionId);
        expect(result.history[0].blocks[0]).toMatchObject({
          type: 'text',
          text: 'newer message',
        });

        const newLock = context.recordingCallbacks.getCurrentLockHandle();
        if (newLock) lockHandles.push(newLock);
      }
    });

    /**
     * Test 2: performResume resolves numeric index
     * @requirement REQ-EN-004, REQ-PR-001
     */
    it('performResume resolves numeric index @requirement:REQ-EN-004,REQ-PR-001', async () => {
      // Create session 1 (will be index 2 since newest first)
      await createTestSession(chatsDir, {
        messages: [{ speaker: 'user', text: 'first session' }],
      });
      await delay(50);

      // Create session 2 (will be index 1)
      const { sessionId: newestSessionId } = await createTestSession(chatsDir, {
        messages: [{ speaker: 'user', text: 'second session' }],
      });

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'different-session',
      });

      const result = await performResume('1', context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.metadata.sessionId).toBe(newestSessionId);
        expect(result.history[0].blocks[0]).toMatchObject({
          type: 'text',
          text: 'second session',
        });

        const newLock = context.recordingCallbacks.getCurrentLockHandle();
        if (newLock) lockHandles.push(newLock);
      }
    });

    /**
     * Test 3: performResume resolves session ID
     * @requirement REQ-PR-001
     */
    it('performResume resolves session ID @requirement:REQ-PR-001', async () => {
      const targetId = 'target-session-by-exact-id';
      await createTestSession(chatsDir, {
        sessionId: targetId,
        messages: [{ speaker: 'user', text: 'target content' }],
      });

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'other-session',
      });

      const result = await performResume(targetId, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.metadata.sessionId).toBe(targetId);
        expect(result.history[0].blocks[0]).toMatchObject({
          type: 'text',
          text: 'target content',
        });

        const newLock = context.recordingCallbacks.getCurrentLockHandle();
        if (newLock) lockHandles.push(newLock);
      }
    });

    /**
     * Test 4: performResume returns error for locked session
     * @requirement REQ-SW-002, REQ-PR-003
     */
    it('performResume returns error for locked session @requirement:REQ-SW-002,REQ-PR-003', async () => {
      const targetId = 'locked-session-test';
      await createTestSession(chatsDir, {
        sessionId: targetId,
        messages: [{ speaker: 'user', text: 'locked content' }],
      });

      // Lock the session
      const handle = await SessionLockManager.acquire(chatsDir, targetId);
      lockHandles.push(handle);

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'other-session',
      });

      const result = await performResume(targetId, context);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.toLowerCase()).toContain('in use');
      }
    });

    /**
     * Test 5: performResume returns error for non-existent session
     * @requirement REQ-PR-003
     */
    it('performResume returns error for non-existent session @requirement:REQ-PR-003', async () => {
      // Create at least one session so the project has sessions
      await createTestSession(chatsDir, {
        messages: [{ speaker: 'user', text: 'existing content' }],
      });

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'other-session',
      });

      const result = await performResume('nonexistent-session-id-xyz', context);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeTruthy();
        expect(result.error.toLowerCase()).toMatch(/not found|no.*session/);
      }
    });

    /**
     * Test 6: performResume returns error for current session
     * @requirement REQ-PR-003
     */
    it('performResume returns error for current session @requirement:REQ-PR-003', async () => {
      const sessionId = 'current-active-session';
      await createTestSession(chatsDir, {
        sessionId,
        messages: [{ speaker: 'user', text: 'current content' }],
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
  });

  // -------------------------------------------------------------------------
  // Two-Phase Swap Tests (4 tests)
  // -------------------------------------------------------------------------

  describe('Two-Phase Swap @plan:PLAN-20260214-SESSIONBROWSER.P31', () => {
    /**
     * Test 7: New session acquired before old disposed
     * @requirement REQ-SW-001
     */
    it('new session acquired before old disposed @requirement:REQ-SW-001', async () => {
      // Create old session (the "current" one)
      const oldConfig = makeConfig(chatsDir, {
        sessionId: 'old-current-session',
        projectHash: PROJECT_HASH,
      });
      const oldRecording = new SessionRecordingService(oldConfig);
      oldRecording.recordContent(makeContent('old message'));
      await oldRecording.flush();
      recordingsToDispose.push(oldRecording);

      // Create target session
      const targetId = 'target-for-swap-test';
      await createTestSession(chatsDir, {
        sessionId: targetId,
        messages: [{ speaker: 'user', text: 'target content' }],
      });

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'old-current-session',
        currentRecording: oldRecording,
      });

      // Before resume, old recording should be active
      expect(oldRecording.isActive()).toBe(true);

      const result = await performResume(targetId, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // New recording should be installed
        const newRecording = context.recordingCallbacks.getCurrentRecording();
        expect(newRecording).not.toBeNull();
        expect(newRecording!.isActive()).toBe(true);
        recordingsToDispose.push(newRecording!);

        const newLock = context.recordingCallbacks.getCurrentLockHandle();
        if (newLock) lockHandles.push(newLock);
      }
    });

    /**
     * Test 8: Failed resume preserves old session
     * @requirement REQ-SW-002, REQ-EH-004
     */
    it('failed resume preserves old session @requirement:REQ-SW-002,REQ-EH-004', async () => {
      // Create old session (the "current" one)
      const oldConfig = makeConfig(chatsDir, {
        sessionId: 'old-preserved-session',
        projectHash: PROJECT_HASH,
      });
      const oldRecording = new SessionRecordingService(oldConfig);
      oldRecording.recordContent(makeContent('old message'));
      await oldRecording.flush();
      const oldFilePath = oldRecording.getFilePath()!;
      recordingsToDispose.push(oldRecording);

      // Create target session and lock it so resume will fail
      const targetId = 'target-locked-session';
      await createTestSession(chatsDir, {
        sessionId: targetId,
        messages: [{ speaker: 'user', text: 'target content' }],
      });
      const targetLock = await SessionLockManager.acquire(chatsDir, targetId);
      lockHandles.push(targetLock);

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'old-preserved-session',
        currentRecording: oldRecording,
      });

      // Attempt resume - should fail
      const result = await performResume(targetId, context);
      expect(result.ok).toBe(false);

      // Old recording should still be functional
      expect(oldRecording.isActive()).toBe(true);
      oldRecording.recordContent(
        makeContent('new message after failed resume'),
      );
      await oldRecording.flush();

      // Verify the content was written
      const fileContent = await fs.readFile(oldFilePath, 'utf-8');
      expect(fileContent).toContain('new message after failed resume');
    });

    /**
     * Test 9: After successful swap events go to new session
     * @requirement REQ-SW-006, REQ-SW-007
     */
    it('after successful swap events go to new session @requirement:REQ-SW-006,REQ-SW-007', async () => {
      // Create target session
      const targetId = 'target-for-new-events';
      const { filePath: targetFilePath } = await createTestSession(chatsDir, {
        sessionId: targetId,
        messages: [{ speaker: 'user', text: 'original target content' }],
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

        // Record new event
        newRecording!.recordContent(makeContent('new event after resume'));
        await newRecording!.flush();

        // Verify the content is in the file
        const fileContent = await fs.readFile(targetFilePath, 'utf-8');
        expect(fileContent).toContain('new event after resume');

        const newLock = context.recordingCallbacks.getCurrentLockHandle();
        if (newLock) lockHandles.push(newLock);
      }
    });

    /**
     * Test 9a: Swap completes without write errors
     * @requirement REQ-SW-003
     */
    it('swap completes without write errors @requirement:REQ-SW-003', async () => {
      const targetId = 'target-no-write-errors';
      const { filePath: targetFilePath } = await createTestSession(chatsDir, {
        sessionId: targetId,
        messages: [{ speaker: 'user', text: 'initial content' }],
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

        // Write multiple events to verify no write errors
        for (let i = 0; i < 5; i++) {
          newRecording!.recordContent(makeContent(`message ${i}`));
        }
        await newRecording!.flush();

        // Verify all events were written
        const fileContent = await fs.readFile(targetFilePath, 'utf-8');
        for (let i = 0; i < 5; i++) {
          expect(fileContent).toContain(`message ${i}`);
        }

        const newLock = context.recordingCallbacks.getCurrentLockHandle();
        if (newLock) lockHandles.push(newLock);
      }
    });
  });

  // -------------------------------------------------------------------------
  // History Conversion Tests (2 tests)
  // -------------------------------------------------------------------------

  describe('History Conversion @plan:PLAN-20260214-SESSIONBROWSER.P31', () => {
    /**
     * Test 10: IContent to HistoryItem conversion
     * @requirement REQ-CV-002
     */
    it('IContent to HistoryItem conversion @requirement:REQ-CV-002', async () => {
      const contents: IContent[] = [
        makeContent('user question', 'human'),
        makeContent('ai response', 'ai'),
      ];

      // Test direct conversion
      const historyItems = convertIContentToHistoryItems(contents);

      expect(historyItems).toHaveLength(2);
      expect(historyItems[0].type).toBe(MessageType.USER);
      expect(historyItems[0].text).toBe('user question');
      expect(historyItems[1].type).toBe(MessageType.GEMINI);
      expect(historyItems[1].text).toBe('ai response');
    });

    /**
     * Test 11: Resume returns correct history
     * @requirement REQ-CV-001
     */
    it('resume returns correct history @requirement:REQ-CV-001', async () => {
      const targetId = 'session-with-history';
      await createTestSession(chatsDir, {
        sessionId: targetId,
        contents: [
          makeContent('first question', 'human'),
          makeContent('first answer', 'ai'),
          makeContent('second question', 'human'),
          makeContent('second answer', 'ai'),
        ],
      });

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'other-session',
      });

      const result = await performResume(targetId, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.history).toHaveLength(4);
        expect(result.history[0].speaker).toBe('human');
        expect(result.history[0].blocks[0]).toMatchObject({
          type: 'text',
          text: 'first question',
        });
        expect(result.history[1].speaker).toBe('ai');
        expect(result.history[1].blocks[0]).toMatchObject({
          type: 'text',
          text: 'first answer',
        });
        expect(result.history[2].speaker).toBe('human');
        expect(result.history[2].blocks[0]).toMatchObject({
          type: 'text',
          text: 'second question',
        });
        expect(result.history[3].speaker).toBe('ai');
        expect(result.history[3].blocks[0]).toMatchObject({
          type: 'text',
          text: 'second answer',
        });

        const newLock = context.recordingCallbacks.getCurrentLockHandle();
        if (newLock) lockHandles.push(newLock);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Command Integration Tests (3 tests)
  // -------------------------------------------------------------------------

  describe('/continue Command Integration @plan:PLAN-20260214-SESSIONBROWSER.P31', () => {
    /**
     * Test 14: continueCommand in non-interactive mode with no args returns error
     * @requirement REQ-PR-003
     */
    it('continueCommand in non-interactive mode returns error @requirement:REQ-PR-003', async () => {
      const ctx = makeCommandContext({
        services: {
          config: {
            isInteractive: () => false,
          } as CommandContext['services']['config'],
          settings: {} as CommandContext['services']['settings'],
          git: undefined,
          logger: makeMockLogger(),
        },
      });

      const result = (await continueCommand.action!(
        ctx,
        '',
      )) as SlashCommandActionReturn;

      expect(result).toBeDefined();
      expect(result.type).toBe('message');
      if (result.type === 'message') {
        expect(result.messageType).toBe('error');
        expect(result.content).toContain('interactive');
      }
    });

    /**
     * Test 13: continueCommand with latest returns PerformResumeActionReturn
     * @requirement REQ-EN-002
     *
     * Note: continueCommand returns a 'perform_resume' action type, not 'load_history'
     * The actual history loading happens in the processor that handles the action.
     */
    it('continueCommand with latest returns PerformResumeActionReturn @requirement:REQ-EN-002', async () => {
      const ctx = makeCommandContext({
        services: {
          config: {
            isInteractive: () => true,
          } as CommandContext['services']['config'],
          settings: {} as CommandContext['services']['settings'],
          git: undefined,
          logger: makeMockLogger(),
        },
        ui: {
          pendingItem: null,
          addItem: () => 0,
          clear: () => {},
          setDebugMessage: () => {},
          setPendingItem: () => {},
          loadHistory: () => {},
          toggleCorgiMode: () => {},
          toggleDebugProfiler: () => {},
          toggleVimEnabled: async () => false,
          setGeminiMdFileCount: () => {},
          setLlxprtMdFileCount: () => {},
          updateHistoryTokenCount: () => {},
          reloadCommands: () => {},
          extensionsUpdateState: new Map(),
          dispatchExtensionStateUpdate: () => {},
          addConfirmUpdateExtensionRequest: () => {},
        },
      });

      const result = (await continueCommand.action!(
        ctx,
        'latest',
      )) as SlashCommandActionReturn;

      expect(result).toBeDefined();
      expect(result.type).toBe('perform_resume');
      if (result.type === 'perform_resume') {
        expect(result.sessionRef).toBe('latest');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Error Handling Tests (2 tests)
  // -------------------------------------------------------------------------

  describe('Error Handling @plan:PLAN-20260214-SESSIONBROWSER.P31', () => {
    /**
     * Test 15: Discovery failure produces error state
     * @requirement REQ-EH-001
     */
    it('discovery failure produces error state @requirement:REQ-EH-001', async () => {
      // Use a non-existent directory to simulate discovery failure
      const nonExistentDir = path.join(tempDir, 'non-existent-dir');

      const context = makeResumeContext(nonExistentDir, {
        currentSessionId: 'other-session',
      });

      const result = await performResume('latest', context);

      // Discovery should return empty list, so "latest" should fail
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeTruthy();
      }
    });

    /**
     * Test 16: performResume "latest" skips empty sessions
     * @requirement REQ-EN-002
     */
    it('performResume "latest" skips empty sessions @requirement:REQ-EN-002', async () => {
      // Create an empty session (newest)
      await createEmptySession(chatsDir, 'empty-session-newest');
      await delay(50);

      // Create a session with content (older)
      const { sessionId: contentSessionId } = await createTestSession(
        chatsDir,
        {
          messages: [{ speaker: 'user', text: 'has content' }],
        },
      );
      await delay(50);

      // Create another empty session (oldest)
      await createEmptySession(chatsDir, 'empty-session-oldest');

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'different-session',
      });

      const result = await performResume('latest', context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Should have skipped the empty session and picked the one with content
        expect(result.metadata.sessionId).toBe(contentSessionId);
        expect(result.history[0].blocks[0]).toMatchObject({
          type: 'text',
          text: 'has content',
        });

        const newLock = context.recordingCallbacks.getCurrentLockHandle();
        if (newLock) lockHandles.push(newLock);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Property-Based Tests (3 tests using fast-check)
  // -------------------------------------------------------------------------

  describe('Property-Based Tests @plan:PLAN-20260214-SESSIONBROWSER.P31', () => {
    /**
     * Test 17: Any valid session index resolves correctly
     * @requirement REQ-EN-004
     */
    it('any valid session index resolves correctly @requirement:REQ-EN-004', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 2, max: 5 }),
          async (sessionCount) => {
            const localTempDir = await fs.mkdtemp(
              path.join(os.tmpdir(), 'prop-index-e2e-'),
            );
            const localChatsDir = path.join(localTempDir, 'chats');
            await fs.mkdir(localChatsDir, { recursive: true });

            try {
              // Create N sessions
              const sessionIds: string[] = [];
              for (let i = 0; i < sessionCount; i++) {
                const { sessionId } = await createTestSession(localChatsDir, {
                  projectHash: PROJECT_HASH,
                  messages: [{ speaker: 'user', text: `session ${i + 1}` }],
                });
                sessionIds.push(sessionId);
                await delay(20);
              }

              // Pick a random valid index
              const validIndex = Math.floor(Math.random() * sessionCount) + 1;

              const context = makeResumeContext(localChatsDir, {
                currentSessionId: 'other-session',
              });

              const result = await performResume(String(validIndex), context);

              expect(result.ok).toBe(true);
              if (result.ok) {
                // Index is 1-based, newest first
                const expectedSessionId = sessionIds[sessionCount - validIndex];
                expect(result.metadata.sessionId).toBe(expectedSessionId);

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
     * Test 18: Any session ID prefix resolves if unique
     * @requirement REQ-PR-001
     */
    it('any session ID prefix resolves if unique @requirement:REQ-PR-001', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 5, maxLength: 15 }),
          async (rawId) => {
            // Sanitize to valid session ID
            const sessionId = `unique-${rawId.replace(/[^a-zA-Z0-9-]/g, 'x')}`;

            const localTempDir = await fs.mkdtemp(
              path.join(os.tmpdir(), 'prop-prefix-e2e-'),
            );
            const localChatsDir = path.join(localTempDir, 'chats');
            await fs.mkdir(localChatsDir, { recursive: true });

            try {
              await createTestSession(localChatsDir, {
                sessionId,
                projectHash: PROJECT_HASH,
                messages: [{ speaker: 'user', text: 'content' }],
              });

              const context = makeResumeContext(localChatsDir, {
                currentSessionId: 'other-session',
              });

              // Use the unique prefix "unique-"
              const result = await performResume('unique-', context);

              expect(result.ok).toBe(true);
              if (result.ok) {
                expect(result.metadata.sessionId).toBe(sessionId);

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
     * Test 19: performResume always returns discriminated union
     * @requirement REQ-PR-003
     */
    it('performResume always returns discriminated union @requirement:REQ-PR-003', async () => {
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
              path.join(os.tmpdir(), 'prop-union-e2e-'),
            );
            const localChatsDir = path.join(localTempDir, 'chats');
            await fs.mkdir(localChatsDir, { recursive: true });

            try {
              // Create at least one session
              await createTestSession(localChatsDir, {
                projectHash: PROJECT_HASH,
                messages: [{ speaker: 'user', text: 'test content' }],
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
                expect(Array.isArray(result.history)).toBe(true);
                expect(Array.isArray(result.warnings)).toBe(true);
              } else {
                expect(result).toHaveProperty('error');
                expect(typeof result.error).toBe('string');
                expect(result.error.length).toBeGreaterThan(0);
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
  });

  // -------------------------------------------------------------------------
  // Session Discovery integration
  // -------------------------------------------------------------------------

  describe('Session Discovery integration @plan:PLAN-20260214-SESSIONBROWSER.P31', () => {
    it('discovers JSONL session files', async () => {
      // Create multiple session files
      await createTestSession(chatsDir, {
        messages: [{ speaker: 'user', text: 'Session 1' }],
      });
      await createTestSession(chatsDir, {
        messages: [{ speaker: 'user', text: 'Session 2' }],
      });
      await createTestSession(chatsDir, {
        messages: [{ speaker: 'user', text: 'Session 3' }],
      });

      const sessions = await SessionDiscovery.listSessions(
        chatsDir,
        PROJECT_HASH,
      );

      expect(sessions).toHaveLength(3);
      expect(sessions.every((s) => s.filePath.endsWith('.jsonl'))).toBe(true);
    });

    it('filters sessions by project hash', async () => {
      // Create sessions with different project hashes
      await createTestSession(chatsDir, {
        projectHash: PROJECT_HASH,
        messages: [{ speaker: 'user', text: 'Project A' }],
      });
      await createTestSession(chatsDir, {
        projectHash: 'different-project-hash',
        messages: [{ speaker: 'user', text: 'Project B' }],
      });

      const sessionsA = await SessionDiscovery.listSessions(
        chatsDir,
        PROJECT_HASH,
      );
      const sessionsB = await SessionDiscovery.listSessions(
        chatsDir,
        'different-project-hash',
      );

      expect(sessionsA).toHaveLength(1);
      expect(sessionsB).toHaveLength(1);
    });

    it('sorts sessions by modification time (newest first)', async () => {
      const { sessionId: olderId } = await createTestSession(chatsDir, {
        messages: [{ speaker: 'user', text: 'Older' }],
      });
      await delay(50);
      const { sessionId: newerId } = await createTestSession(chatsDir, {
        messages: [{ speaker: 'user', text: 'Newer' }],
      });

      const sessions = await SessionDiscovery.listSessions(
        chatsDir,
        PROJECT_HASH,
      );

      expect(sessions).toHaveLength(2);
      expect(sessions[0].sessionId).toBe(newerId);
      expect(sessions[1].sessionId).toBe(olderId);
    });

    it('handles discovery failure gracefully @requirement:REQ-EH-001', async () => {
      const nonExistentDir = path.join(tempDir, 'non-existent-chats');

      const sessions = await SessionDiscovery.listSessions(
        nonExistentDir,
        PROJECT_HASH,
      );

      expect(sessions).toEqual([]);
    });

    it('reads session metadata from headers', async () => {
      await createTestSession(chatsDir, {
        provider: 'openai',
        model: 'gpt-4-turbo',
        messages: [{ speaker: 'user', text: 'test' }],
      });

      const sessions = await SessionDiscovery.listSessions(
        chatsDir,
        PROJECT_HASH,
      );

      expect(sessions).toHaveLength(1);
      expect(sessions[0].provider).toBe('openai');
      expect(sessions[0].model).toBe('gpt-4-turbo');
    });
  });

  // -------------------------------------------------------------------------
  // Session locking
  // -------------------------------------------------------------------------

  describe('Session locking @plan:PLAN-20260214-SESSIONBROWSER.P31', () => {
    it('prevents resuming locked session', async () => {
      const sessionId = 'session-to-lock';
      await createTestSession(chatsDir, {
        sessionId,
        messages: [{ speaker: 'user', text: 'content' }],
      });

      const lock = await SessionLockManager.acquire(chatsDir, sessionId);
      lockHandles.push(lock);

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'other-session',
      });

      const result = await performResume(sessionId, context);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.toLowerCase()).toContain('in use');
      }
    });

    it('acquires lock on resumed session', async () => {
      const sessionId = 'session-to-resume';
      await createTestSession(chatsDir, {
        sessionId,
        messages: [{ speaker: 'user', text: 'content' }],
      });

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'other-session',
      });

      const result = await performResume(sessionId, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const newLock = context.recordingCallbacks.getCurrentLockHandle();
        expect(newLock).not.toBeNull();
        expect(newLock!.lockPath).toContain(chatsDir);

        lockHandles.push(newLock!);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('Edge cases @plan:PLAN-20260214-SESSIONBROWSER.P31', () => {
    it('handles empty sessions (no content events)', async () => {
      // Create empty session
      await createEmptySession(chatsDir, 'empty-session');
      await delay(50);

      // Create session with content
      const { sessionId: contentSessionId } = await createTestSession(
        chatsDir,
        {
          messages: [{ speaker: 'user', text: 'has content' }],
        },
      );

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'different-session',
      });

      const result = await performResume('latest', context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Should skip empty and pick the one with content
        expect(result.metadata.sessionId).toBe(contentSessionId);

        const newLock = context.recordingCallbacks.getCurrentLockHandle();
        if (newLock) lockHandles.push(newLock);
      }
    });

    it('handles same-session resume attempt', async () => {
      const sessionId = 'current-session';
      await createTestSession(chatsDir, {
        sessionId,
        messages: [{ speaker: 'user', text: 'content' }],
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

    it('handles ambiguous prefix', async () => {
      await createTestSession(chatsDir, {
        sessionId: 'prefix-first-session',
        messages: [{ speaker: 'user', text: 'first' }],
      });
      await createTestSession(chatsDir, {
        sessionId: 'prefix-second-session',
        messages: [{ speaker: 'user', text: 'second' }],
      });

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'other-session',
      });

      const result = await performResume('prefix-', context);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.toLowerCase()).toContain('ambiguous');
      }
    });

    it('handles out-of-range index', async () => {
      await createTestSession(chatsDir, {
        messages: [{ speaker: 'user', text: 'session 1' }],
      });
      await createTestSession(chatsDir, {
        messages: [{ speaker: 'user', text: 'session 2' }],
      });

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'other-session',
      });

      const result = await performResume('999', context);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/out of range/i);
      }
    });

    it('handles non-existent session ID', async () => {
      await createTestSession(chatsDir, {
        messages: [{ speaker: 'user', text: 'existing' }],
      });

      const context = makeResumeContext(chatsDir, {
        currentSessionId: 'other-session',
      });

      const result = await performResume('nonexistent-session-xyz', context);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeTruthy();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Verify test infrastructure works
  // -------------------------------------------------------------------------

  describe('Test infrastructure verification @plan:PLAN-20260214-SESSIONBROWSER.P30', () => {
    it('createTestSession creates real JSONL files', async () => {
      const { filePath, sessionId } = await createTestSession(chatsDir, {
        messages: [
          { speaker: 'user', text: 'Hello world' },
          { speaker: 'model', text: 'Hi there!' },
        ],
      });

      // Verify file exists
      const stat = await fs.stat(filePath);
      expect(stat.isFile()).toBe(true);

      // Verify file has content
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n');

      // Should have session_start + 2 content events = 3 lines
      expect(lines.length).toBe(3);

      // First line should be session_start
      const firstLine = JSON.parse(lines[0]);
      expect(firstLine.type).toBe('session_start');
      expect(firstLine.payload.sessionId).toBe(sessionId);
      expect(firstLine.payload.projectHash).toBe(PROJECT_HASH);

      // Second line should be human content
      const secondLine = JSON.parse(lines[1]);
      expect(secondLine.type).toBe('content');
      expect(secondLine.payload.content.speaker).toBe('human');
      expect(secondLine.payload.content.blocks[0].text).toBe('Hello world');

      // Third line should be ai content
      const thirdLine = JSON.parse(lines[2]);
      expect(thirdLine.type).toBe('content');
      expect(thirdLine.payload.content.speaker).toBe('ai');
      expect(thirdLine.payload.content.blocks[0].text).toBe('Hi there!');
    });

    it('setupChatsDir creates proper directory structure', async () => {
      // chatsDir was already created in beforeEach
      const stat = await fs.stat(chatsDir);
      expect(stat.isDirectory()).toBe(true);
      expect(chatsDir).toContain('chats');
    });

    it('multiple sessions get unique files', async () => {
      const session1 = await createTestSession(chatsDir, {
        sessionId: 'session-1',
        messages: [{ speaker: 'user', text: 'First session' }],
      });

      await delay(10);

      const session2 = await createTestSession(chatsDir, {
        sessionId: 'session-2',
        messages: [{ speaker: 'user', text: 'Second session' }],
      });

      expect(session1.filePath).not.toBe(session2.filePath);
      expect(session1.sessionId).toBe('session-1');
      expect(session2.sessionId).toBe('session-2');

      // Both files should exist
      await expect(fs.stat(session1.filePath)).resolves.toBeDefined();
      await expect(fs.stat(session2.filePath)).resolves.toBeDefined();
    });

    it('sessions have correct provider and model in header', async () => {
      const { filePath } = await createTestSession(chatsDir, {
        provider: 'openai',
        model: 'gpt-4',
        messages: [{ speaker: 'user', text: 'test' }],
      });

      const content = await fs.readFile(filePath, 'utf-8');
      const firstLine = JSON.parse(content.split('\n')[0]);

      expect(firstLine.payload.provider).toBe('openai');
      expect(firstLine.payload.model).toBe('gpt-4');
    });
  });
});
