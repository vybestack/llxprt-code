/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import type { IContent, Logger } from '@vybestack/llxprt-code-core';
import { CommandKind } from '../commands/types.js';
import { MessageType } from '../types.js';
import type { HistoryItemWithoutId } from '../types.js';
import {
  processSlashCommand,
  type SlashCommandHandlerDeps,
} from './slashCommandHandlers.js';

const performResumeMock = vi.fn();

beforeEach(() => {
  performResumeMock.mockReset();
});

function createDeps(
  addItem: ReturnType<typeof vi.fn>,
): SlashCommandHandlerDeps {
  return {
    commands: [
      {
        name: 'help',
        description: 'Show help',
        kind: CommandKind.BUILT_IN,
        action: vi.fn(() => ({
          type: 'message' as const,
          messageType: 'info' as const,
          content: 'ok',
        })),
      },
    ],
    config: null,
    commandContext: {
      services: {
        config: null,
        agent: null,
        settings:
          {} as SlashCommandHandlerDeps['commandContext']['services']['settings'],
        git: undefined,
        logger: new DebugLogger('test') as unknown as Logger,
      },
      ui: {
        addItem,
        clear: vi.fn(),
        setDebugMessage: vi.fn(),
        pendingItem: null,
        setPendingItem: vi.fn(),
        loadHistory: vi.fn(),
        toggleCorgiMode: vi.fn(),
        toggleDebugProfiler: vi.fn(),
        toggleVimEnabled: vi.fn(),
        setLlxprtMdFileCount: vi.fn(),
        updateHistoryTokenCount: vi.fn(),
        reloadCommands: vi.fn(),
        extensionsUpdateState: new Map(),
        dispatchExtensionStateUpdate: vi.fn(),
        addConfirmUpdateExtensionRequest: vi.fn(),
      },
      session: {
        stats:
          {} as SlashCommandHandlerDeps['commandContext']['session']['stats'],
        sessionShellAllowlist: new Set(),
      },
    },
    actions: {} as SlashCommandHandlerDeps['actions'],
    addItem,
    addMessage: vi.fn(),
    setIsProcessing: vi.fn(),
    setLocalIsProcessing: vi.fn(),
    setPendingItem: vi.fn(),
    setSessionShellAllowlist: vi.fn(),
    setConfirmationRequest: vi.fn(),
    confirmationLogger: new DebugLogger('test-confirmation'),
    slashCommandLogger: new DebugLogger('test-slash'),
  };
}

describe('processSlashCommand', () => {
  it('sanitizes whitespace-separated secure commands before adding history', async () => {
    const addItem = vi.fn();

    await processSlashCommand(createDeps(addItem), '/key\tsk-abc123456');

    expect(addItem).toHaveBeenCalled();
    const [historyItem] = addItem.mock.calls[0] as [
      { type: MessageType; text: string },
      number,
    ];
    expect(historyItem.type).toBe(MessageType.USER);
    expect(historyItem.text).toContain('/key');
    expect(historyItem.text).not.toContain('sk-abc123456');
  });
});

// Emojis are written as escapes (U+2705 check mark, U+1F44D thumbs up) so the
// source stays ASCII-stable.
describe('processSlashCommand history replay emoji filtering (#2888)', () => {
  const USER_TEXT = 'nice \u{1F44D}';
  const MODEL_TEXT = 'Done \u2705';
  const MODEL_THOUGHT = 'hmm \u2705';

  function createLoadHistoryDeps(
    addItem: ReturnType<typeof vi.fn>,
    emojiMode: string | null,
    history: HistoryItemWithoutId[],
    clientHistory: IContent[],
  ): SlashCommandHandlerDeps {
    const deps = createDeps(addItem);
    deps.commandContext.services.config =
      emojiMode === null
        ? null
        : ({
            getEphemeralSetting: vi.fn().mockReturnValue(emojiMode),
            getAgentClient: vi.fn().mockReturnValue({ setHistory: vi.fn() }),
          } as unknown as SlashCommandHandlerDeps['config']);
    deps.commands = [
      {
        name: 'loadhist',
        description: 'Load history for tests',
        kind: CommandKind.BUILT_IN,
        action: vi.fn(async () => ({
          type: 'load_history' as const,
          history,
          clientHistory,
        })),
      },
    ];
    return deps;
  }

  it('filters replayed model text through the auto filter', async () => {
    const addItem = vi.fn();
    const deps = createLoadHistoryDeps(
      addItem,
      'auto',
      [
        { type: 'user', text: USER_TEXT },
        { type: 'gemini', text: MODEL_TEXT },
      ],
      [],
    );

    await processSlashCommand(deps, '/loadhist');

    // User text is never filtered live, so it must replay verbatim; model
    // text is filtered exactly as it would have rendered live.
    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({ type: MessageType.USER, text: USER_TEXT }),
      expect.any(Number),
    );
    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({ type: MessageType.AI, text: 'Done [OK]' }),
      expect.any(Number),
    );
  });

  it('defaults to the auto filter when no config is available', async () => {
    const addItem = vi.fn();
    const deps = createLoadHistoryDeps(
      addItem,
      null,
      [{ type: 'gemini', text: MODEL_TEXT }],
      [],
    );

    await processSlashCommand(deps, '/loadhist');

    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({ type: MessageType.AI, text: 'Done [OK]' }),
      expect.any(Number),
    );
  });

  it('filters replayed thinking blocks alongside model text (#2888)', async () => {
    const addItem = vi.fn();
    const deps = createLoadHistoryDeps(
      addItem,
      'auto',
      [
        {
          type: 'gemini',
          text: MODEL_TEXT,
          thinkingBlocks: [{ type: 'thinking', thought: MODEL_THOUGHT }],
        },
      ],
      [],
    );

    await processSlashCommand(deps, '/loadhist');

    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.AI,
        text: 'Done [OK]',
        thinkingBlocks: [{ type: 'thinking', thought: 'hmm [OK]' }],
      }),
      expect.any(Number),
    );
  });

  it('replays model text verbatim in allowed mode', async () => {
    const addItem = vi.fn();
    const deps = createLoadHistoryDeps(
      addItem,
      'allowed',
      [{ type: 'gemini', text: MODEL_TEXT }],
      [],
    );

    await processSlashCommand(deps, '/loadhist');

    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({ type: MessageType.AI, text: MODEL_TEXT }),
      expect.any(Number),
    );
  });

  it('replaces blocked model text with the live error item in error mode', async () => {
    const addItem = vi.fn();
    const deps = createLoadHistoryDeps(
      addItem,
      'error',
      [{ type: 'gemini', text: MODEL_TEXT }],
      [],
    );

    await processSlashCommand(deps, '/loadhist');

    // Mirrors the live blocked-turn presentation (commitAiPendingItem):
    // the model item is replaced by the shared error text, not blanked.
    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.ERROR,
        text: '[Error: Response blocked due to emoji detection]',
      }),
      expect.any(Number),
    );
  });

  it('keeps the client history verbatim while filtering display text', async () => {
    const addItem = vi.fn();
    const setHistory = vi.fn();
    const deps = createDeps(addItem);
    deps.commandContext.services.config = {
      getEphemeralSetting: vi.fn().mockReturnValue('auto'),
      getAgentClient: vi.fn().mockReturnValue({ setHistory }),
    } as never;
    const clientHistory: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'q' }] },
    ];
    const history: HistoryItemWithoutId[] = [
      { type: 'gemini', text: MODEL_TEXT },
    ];
    deps.commands = [
      {
        name: 'loadhist',
        description: 'Load history for tests',
        kind: CommandKind.BUILT_IN,
        action: vi.fn(async () => ({
          type: 'load_history' as const,
          history,
          clientHistory,
        })),
      },
    ];

    await processSlashCommand(deps, '/loadhist');

    // The agent client receives the recorded text unfiltered; only the
    // redisplayed UI text is subject to the emoji filter.
    expect(setHistory).toHaveBeenCalledWith(clientHistory);
    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({ type: MessageType.AI, text: 'Done [OK]' }),
      expect.any(Number),
    );
  });

  it('filters resumed session model text on perform_resume (#2888)', async () => {
    const addItem = vi.fn();
    const deps = createDeps(addItem);
    deps.config = {
      getEphemeralSetting: vi.fn().mockReturnValue('auto'),
      storage: { getProjectTempDir: vi.fn().mockReturnValue('/tmp/chats') },
      getProjectRoot: vi.fn().mockReturnValue('/tmp/project'),
      getSessionId: vi.fn().mockReturnValue('session-1'),
      getProvider: vi.fn().mockReturnValue('test-provider'),
      getModel: vi.fn().mockReturnValue('test-model'),
      getWorkspaceContext: vi.fn().mockReturnValue({
        getDirectories: vi.fn().mockReturnValue(['/tmp/project']),
      }),
      getAgentClient: vi.fn().mockReturnValue({
        getHistoryService: vi.fn().mockReturnValue({}),
      }),
      adoptSessionId: vi.fn(),
    } as never;
    deps.recordingSwapCallbacks = {} as never;
    // Injected instead of vi.mock: bun module mocks leak across test files.
    deps.performResumeFn = performResumeMock;
    deps.commands = [
      {
        name: 'resumecmd',
        description: 'Resume for tests',
        kind: CommandKind.BUILT_IN,
        action: vi.fn(async () => ({
          type: 'perform_resume' as const,
          sessionRef: 'abc',
        })),
      },
    ];
    performResumeMock.mockResolvedValue({
      ok: true,
      warnings: [],
      history: [
        { speaker: 'human', blocks: [{ type: 'text', text: USER_TEXT }] },
        { speaker: 'ai', blocks: [{ type: 'text', text: MODEL_TEXT }] },
      ],
    });

    await processSlashCommand(deps, '/resumecmd');

    expect(performResumeMock).toHaveBeenCalledTimes(1);
    expect(deps.commandContext.ui.clear).toHaveBeenCalled();
    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({ type: MessageType.USER, text: USER_TEXT }),
      expect.any(Number),
    );
    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'gemini', text: 'Done [OK]' }),
      expect.any(Number),
    );
  });
});
