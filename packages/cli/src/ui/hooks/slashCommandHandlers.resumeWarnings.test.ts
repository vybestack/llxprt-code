/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #3732: a successful `/continue <id>` resume reports the recordings it
 * skipped, and that report must survive the history restore that follows.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DebugLogger,
  SessionRecordingService,
  getProjectHash,
  type LockHandle,
} from '@vybestack/llxprt-code-core';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { continueCommand } from '../commands/continueCommand.js';
import { createTurnStore } from '../stores/turn/turnStore.js';
import {
  processSlashCommand,
  type SlashCommandHandlerDeps,
} from './slashCommandHandlers.js';
import { convertMessageToHistoryItem } from './slashCommandProcessorSupport.js';

const SESSION_ID = 'healthy-resume-session';
const CORRUPT_REASON =
  'Invalid session_start: missing or malformed required fields';

async function writeHealthySession(
  chatsDir: string,
  projectHash: string,
): Promise<void> {
  const recording = new SessionRecordingService({
    chatsDir,
    sessionId: SESSION_ID,
    projectHash,
    workspaceDirs: [chatsDir],
    provider: 'test-provider',
    model: 'test-model',
  });
  try {
    recording.recordContent({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'restored conversation' }],
    });
    await recording.flush();
  } finally {
    await recording.dispose();
  }
}

async function writeCorruptSession(
  chatsDir: string,
  projectHash: string,
): Promise<string> {
  const filePath = join(chatsDir, 'session-2026-10-08T21-18-08-corrupt.jsonl');
  const header = {
    v: 1,
    seq: 1,
    ts: '2026-10-08T21:18:08.000Z',
    type: 'session_start',
    payload: {
      sessionId: 'corrupt-resume-session',
      projectHash,
      workspaceDirs: ['/x'],
      provider: 'anthropic',
      model: 42,
      startTime: '2026-10-08T21:18:08.000Z',
    },
  };
  await writeFile(filePath, `${JSON.stringify(header)}\n`, 'utf-8');
  return filePath;
}

describe('processSlashCommand /continue <id> with an unreadable recording present (issue #3732)', () => {
  let root: string;
  let committed: SessionRecordingService | null;
  let committedLock: LockHandle | null;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'continue-warnings-3732-'));
    committed = null;
    committedLock = null;
  });

  afterEach(async () => {
    await committed?.dispose();
    await committedLock?.release();
    await rm(root, { recursive: true, force: true });
  });

  function createDeps(
    turnStore: ReturnType<typeof createTurnStore>,
  ): SlashCommandHandlerDeps {
    const { commands } = turnStore;
    const addItem = (
      item: Parameters<SlashCommandHandlerDeps['addItem']>[0],
      timestamp: number,
    ): void => {
      commands.addItem(item, timestamp);
    };
    const projectRoot = join(root, 'project');
    return {
      commands: [continueCommand],
      config: {
        getEphemeralSetting: () => 'auto',
        storage: { getProjectTempDir: () => root },
        getSessionRecordingQueueByteLimit: () => Number.MAX_SAFE_INTEGER,
        createSessionPersistenceService: () => undefined,
        getLocalMediaStore: () => undefined,
        getProjectRoot: () => projectRoot,
        getSessionId: () => 'current-session',
        getProvider: () => 'test-provider',
        getModel: () => 'test-model',
        getWorkspaceContext: () => ({ getDirectories: () => [root] }),
        getAgentClient: () => ({ getHistoryService: () => undefined }),
        adoptSessionId: () => {},
      } as never,
      commandContext: createMockCommandContext({
        ui: { addItem: commands.addItem, clear: commands.clearItems },
      }),
      actions: {} as never,
      addItem,
      addMessage: (message) => {
        addItem(
          convertMessageToHistoryItem(message),
          message.timestamp.getTime(),
        );
      },
      setIsProcessing: vi.fn(),
      setLocalIsProcessing: vi.fn(),
      setPendingItem: vi.fn(),
      setSessionShellAllowlist: vi.fn(),
      setConfirmationRequest: vi.fn(),
      recordingSwapCallbacks: {
        getCurrentRecording: () => null,
        getCurrentIntegration: () => null,
        getCurrentLockHandle: () => null,
        setRecording: (recording, _integration, lock) => {
          committed = recording;
          committedLock = lock;
        },
      },
      confirmationLogger: new DebugLogger('test-confirmation'),
      slashCommandLogger: new DebugLogger('test-slash'),
      beginSlashCommandAction: () => new AbortController(),
      endSlashCommandAction: () => {},
    };
  }

  it('leaves the skipped-recording warning visible next to the restored conversation', async () => {
    const chatsDir = join(root, 'chats');
    await mkdir(chatsDir, { recursive: true });
    const projectHash = getProjectHash(join(root, 'project'));
    await writeHealthySession(chatsDir, projectHash);
    const corruptPath = await writeCorruptSession(chatsDir, projectHash);
    const turnStore = createTurnStore();

    await processSlashCommand(createDeps(turnStore), `/continue ${SESSION_ID}`);

    const visible = turnStore.store
      .getState()
      .history.map((item) => ('text' in item ? item.text : item.type));
    expect(visible).toStrictEqual([
      'restored conversation',
      `Warning: Skipped unreadable session recording ${corruptPath}: ${CORRUPT_REASON}`,
    ]);
  });
});
