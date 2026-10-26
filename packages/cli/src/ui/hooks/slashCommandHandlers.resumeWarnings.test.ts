/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #3732: a successful `/continue <id>` resume reports the recordings it
 * skipped, and that report must survive the history restore that follows.
 */

import {
  DebugLogger,
  getProjectHash,
  LocalMediaStore,
  type LockHandle,
  type SessionRecordingPort,
} from '@vybestack/llxprt-code-core';
import {
  createRecorderForTest,
  recordRowsForTest,
} from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { continueCommand } from '../commands/continueCommand.js';
import { createTurnStore } from '../stores/turn/turnStore.js';
import {
  processSlashCommand,
  type SlashCommandHandlerDeps,
} from './slashCommandHandlers.js';
import { convertMessageToHistoryItem } from './slashCommandProcessorSupport.js';

const SESSION_ID = 'healthy-resume-session';

async function writeHealthySession(
  chatsDir: string,
  projectHash: string,
): Promise<void> {
  const recording = createRecorderForTest({
    chatsDir,
    sessionId: SESSION_ID,
    projectHash,
    workspaceDirs: [chatsDir],
    provider: 'test-provider',
    model: 'test-model',
  });
  try {
    await recordRowsForTest(recording, [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'restored conversation' }],
      },
    ]);
    await recording.flush();
  } finally {
    await recording.dispose();
  }
}

async function writeCorruptSession(
  chatsDir: string,
  projectHash: string,
): Promise<string> {
  const recorder = createRecorderForTest({
    chatsDir,
    projectHash,
    sessionId: 'corrupt-resume-session',
  });
  let path: string;
  try {
    await recordRowsForTest(recorder, [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'corrupt fixture' }],
      },
    ]);
    const recorded = recorder.getFilePath();
    if (recorded === null) throw new Error('Expected corrupt fixture path');
    path = recorded;
  } finally {
    await recorder.dispose();
  }
  const bytes = await readFile(path);
  bytes[60] ^= 1;
  await writeFile(path, bytes);
  return path;
}

describe('processSlashCommand /continue <id> with an unreadable recording present (issue #3732)', () => {
  let root: string;
  let committed: SessionRecordingPort | null;
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
        projectTempDir: root,
        getSessionRecordingQueueByteLimit: () => Number.MAX_SAFE_INTEGER,
        logSlashCommand: () => {},
        getProjectRoot: () => projectRoot,
        getSessionId: () => 'current-session',
        getProvider: () => 'test-provider',
        getModel: () => 'test-model',
        directories: () => [root],
        adoptSessionId: () => {},
      } as never,
      commandContext: createMockCommandContext({
        ui: { addItem: commands.addItem, clear: commands.clearItems },
        services: {
          agent: {
            agentClient: { getHistoryService: () => undefined },
          },
        },
      }),
      sessionMediaStore: new LocalMediaStore({
        rootDirectory: join(root, 'media'),
        quotaBytes: 1024,
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
        getCurrentMetadata: () => null,
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
    const reason = 'Journal header CRC mismatch';

    await processSlashCommand(createDeps(turnStore), `/continue ${SESSION_ID}`);

    const visible = turnStore.store
      .getState()
      .history.map((item) => ('text' in item ? item.text : item.type));
    expect(visible).toStrictEqual([
      'restored conversation',
      `Warning: Skipped unreadable session recording ${corruptPath}: ${reason}`,
    ]);
  });
});
