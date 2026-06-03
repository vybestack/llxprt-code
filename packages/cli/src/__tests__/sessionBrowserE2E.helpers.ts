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
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  SessionRecordingService,
  type RecordingIntegration,
  type SessionRecordingServiceConfig,
  type IContent,
  type LockHandle,
} from '@vybestack/llxprt-code-core';
import type {
  ResumeContext,
  RecordingSwapCallbacks,
} from '../services/performResume.js';
import type { CommandContext } from '../ui/commands/types.js';
import type { HistoryItemWithoutId } from '../ui/types.js';
import { MessageType } from '../ui/types.js';

export const PROJECT_HASH = 'e2e-test-project-hash';

export interface SessionBrowserTestState {
  tempDir: string;
  chatsDir: string;
  lockHandles: LockHandle[];
  recordingsToDispose: SessionRecordingService[];
}

export async function createSessionBrowserTestState(): Promise<SessionBrowserTestState> {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'session-browser-e2e-'),
  );
  return {
    tempDir,
    chatsDir: await setupChatsDir(tempDir, PROJECT_HASH),
    lockHandles: [],
    recordingsToDispose: [],
  };
}

export async function cleanupSessionBrowserTestState(
  state: SessionBrowserTestState,
): Promise<void> {
  for (const handle of state.lockHandles) {
    try {
      await handle.release();
    } catch {
      // Ignore release errors during cleanup
    }
  }
  for (const recording of state.recordingsToDispose) {
    try {
      await recording.dispose();
    } catch {
      // Ignore dispose errors during cleanup
    }
  }
  await fs.rm(state.tempDir, { recursive: true, force: true });
}

/**
 * Create a SessionRecordingServiceConfig for testing.
 */
export function makeConfig(
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
export function makeContent(
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
export async function createTestSession(
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
export async function createEmptySession(
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
export function makeResumeContext(
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
export function makeMockLogger(): CommandContext['services']['logger'] {
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
export function makeCommandContext(
  overrides: Partial<CommandContext> = {},
): CommandContext {
  return {
    services: {
      config: {
        isInteractive: () =>
          overrides.services?.config?.isInteractive() ?? true,
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
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Convert IContent[] to HistoryItemWithoutId[] for UI display.
 * This mirrors the conversion pattern used in the application.
 * @plan PLAN-20260214-SESSIONBROWSER.P31
 * @requirement REQ-CV-002
 */
export function convertIContentToHistoryItems(
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
