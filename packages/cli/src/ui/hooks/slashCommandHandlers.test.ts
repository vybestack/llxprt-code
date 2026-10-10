/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { installWorkspaceRuntimeFixture } from '../../__tests__/workspace-runtime-fixture.js';
const composeFixtureRuntime = installWorkspaceRuntimeFixture();
import { createUiSessionOwner } from '../../__tests__/uiSessionOwner.js';
import { createMockRuntimeApi } from '../components/__tests__/StatsDisplay.testHelpers.js';
import { directoryCommand } from '../commands/directoryCommand.js';
import { mkdtemp, readFile, rm, realpath } from 'node:fs/promises';
import { buildSlashCommandRuntime } from '../cliUiRuntime.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CliSessionPersistence } from '../../cliSessionPersistence.js';

import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { withRecordingLifetimeFixture } from '../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { createFakeAgent } from './agentStream/__tests__/helpers/createFakeAgent.js';
import { waitFor } from '@vybestack/llxprt-code-test-utils';
import {
  DebugLogger,
  getProjectHash,
  LocalMediaStore,
} from '@vybestack/llxprt-code-core';
import type { IContent, Logger } from '@vybestack/llxprt-code-core';
import type { CommandContext, SlashCommand } from '../commands/types.js';
import { CommandKind } from '../commands/types.js';
import { MessageType } from '../types.js';
import {
  processSlashCommand,
  type SlashCommandHandlerDeps,
} from './slashCommandHandlers.js';
import { createSlashCommandCancellation } from './useSlashCommandCancellation.js';
import { computeIsAwaitingSlashCommandConfirmation } from '../containers/AppContainer/hooks/useAppInput.js';
import type { HistoryItemWithoutId } from '../types.js';

const performResumeMock = vi.fn();

describe('slashCommandHandlers', () => {
  beforeEach(() => {
    performResumeMock.mockReset();
  });

  type HistoryCall = [{ type: MessageType; text: string }, number];

  function createCommands(
    action: SlashCommand['action'],
  ): readonly SlashCommand[] {
    return [
      {
        name: 'help',
        description: 'Show help',
        kind: CommandKind.BUILT_IN,
        action:
          action ??
          vi.fn(() => ({
            type: 'message' as const,
            messageType: 'info' as const,
            content: 'ok',
          })),
      },
    ];
  }

  function createDeps(
    addItem: ReturnType<typeof vi.fn>,
    overrides: Partial<SlashCommandHandlerDeps> = {},
  ): SlashCommandHandlerDeps {
    return {
      commands: createCommands(undefined),
      config: null,
      commandContext: {
        runtimeApi: createMockRuntimeApi(),
        refreshProviderAliases: vi.fn(async () => {}),
        oauthControl:
          {} as SlashCommandHandlerDeps['commandContext']['oauthControl'],
        signal: new AbortController().signal,
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
      beginSlashCommandAction: () => new AbortController(),
      endSlashCommandAction: () => {},
      ...overrides,
    };
  }

  it('explains unknown MCP commands using the Agent discovery state without Config', async () => {
    const deps = createDeps(vi.fn());
    const messages: Array<string | undefined> = [];
    const baseAgent = createFakeAgent([]);
    const agent = createFakeAgent([], {
      mcp: {
        ...baseAgent.mcp,
        discoveryState: () => 'pending',
      },
    });
    await processSlashCommand(
      {
        ...deps,
        commandContext: {
          ...deps.commandContext,
          services: { ...deps.commandContext.services, agent },
        },
        addMessage: (message) => {
          if ('content' in message) messages.push(message.content);
        },
      },
      '/arithmetic',
    );
    expect(messages).toStrictEqual([
      'Unknown command: /arithmetic. Command might have been from an MCP server but MCP servers are not done loading.',
    ]);
  });

  it('persists a slash error only through the selected owner recorder', async () => {
    await withRecordingLifetimeFixture(async ({ agent }) => {
      await agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'start' }] },
      ]);
      await agent.session.setRecording({ enabled: true });
      const path = agent.session.getRecording().path;
      if (!path) throw new Error('No recording path');
      const deps = createDeps(vi.fn());
      const rawWrite = vi.fn();
      await processSlashCommand(
        {
          ...deps,
          commandContext: {
            ...deps.commandContext,
            recordingOwner: 'agent',
            services: { ...deps.commandContext.services, agent },
          },
          commands: createCommands(() => ({
            type: 'message',
            messageType: 'error',
            content: 'owner slash failure',
          })),
          recordingIntegration: { recordSessionEvent: rawWrite } as never,
        },
        '/help',
      );
      expect(
        (await readFile(path, 'utf8')).match(/owner slash failure/g),
      ).toHaveLength(1);
      expect(rawWrite).not.toHaveBeenCalled();
    });
  }, 30000);
  it('routes slash failures to a resumed different owner, not the closed owner', async () => {
    await withRecordingLifetimeFixture(async ({ agent, borrow }) => {
      await agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'first owner' }] },
      ]);
      await agent.session.setRecording({ enabled: true });
      const firstPath = agent.session.getRecording().path;
      if (!firstPath) throw new Error('No first recording path');
      await agent.session.setRecording({ enabled: false });
      const next = await borrow();
      await next.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'second owner' }] },
      ]);
      await next.session.setRecording({ enabled: true });
      const secondPath = next.session.getRecording().path;
      if (!secondPath) throw new Error('No second recording path');
      const deps = createDeps(vi.fn());
      await processSlashCommand(
        {
          ...deps,
          commandContext: {
            ...deps.commandContext,
            recordingOwner: 'agent',
            services: { ...deps.commandContext.services, agent: next },
          },
          commands: createCommands(() => {
            throw new Error('resumed owner failure');
          }),
        },
        '/help',
      );
      expect(await readFile(firstPath, 'utf8')).not.toContain(
        'resumed owner failure',
      );
      expect(await readFile(secondPath, 'utf8')).toContain(
        'resumed owner failure',
      );
    });
  }, 30000);

  it('records /directory add once in the owner session JSONL', async () => {
    await withRecordingLifetimeFixture(
      async ({ agent, config, settingsOwner }) => {
        await agent.setHistory([
          { speaker: 'human', blocks: [{ type: 'text', text: 'start' }] },
        ]);
        await agent.session.setRecording({ enabled: true });
        const path = agent.session.getRecording().path;
        if (!path) throw new Error('No recording path');
        const deps = createDeps(vi.fn());
        const addedDirectory = await realpath(
          await mkdtemp(join(tmpdir(), 'recorded-workspace-admission-')),
        );
        const runtime = {
          ...buildSlashCommandRuntime(
            config,
            agent,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            settingsOwner,
          ),
          getFolderTrust: () => false,
          shouldLoadMemoryFromIncludeDirectories: () => false,
        };
        try {
          await processSlashCommand(
            {
              ...deps,
              commands: [directoryCommand],
              commandContext: {
                ...deps.commandContext,
                recordingOwner: 'agent',
                services: {
                  ...deps.commandContext.services,
                  agent,
                  config: runtime,
                },
              },
            },
            `/directory add ${addedDirectory}`,
          );
          const lines = (await readFile(path, 'utf8')).split('\n');
          expect(
            lines.filter((line) => line.includes('directories_changed')),
          ).toHaveLength(1);
          expect(lines.join('\n')).toContain(addedDirectory);
          expect(agent.workspace.containsPath(addedDirectory)).toBe(true);
        } finally {
          await rm(addedDirectory, { recursive: true, force: true });
        }
      },
    );
  }, 30000);

  /**
   * Wires the REAL cancellation registry into the handler deps so the tests
   * exercise the same begin/cancel/end contract the app uses.
   */
  function createCancellableDeps(addItem: ReturnType<typeof vi.fn>): {
    deps: SlashCommandHandlerDeps;
    cancel: () => boolean;
    registered: AbortController[];
  } {
    const registry = createSlashCommandCancellation();
    const registered: AbortController[] = [];
    const deps = createDeps(addItem, {
      beginSlashCommandAction: () => {
        const controller = registry.beginSlashCommandAction();
        registered.push(controller);
        return controller;
      },
      endSlashCommandAction: registry.endSlashCommandAction,
    });
    return { deps, cancel: registry.cancelActiveSlashCommand, registered };
  }

  function errorTexts(addItem: ReturnType<typeof vi.fn>): string[] {
    return (addItem.mock.calls as HistoryCall[])
      .filter(([item]) => item.type === MessageType.ERROR)
      .map(([item]) => item.text);
  }

  describe('processSlashCommand', () => {
    it('sanitizes whitespace-separated secure commands before adding history', async () => {
      const addItem = vi.fn();

      await processSlashCommand(createDeps(addItem), '/key\tsk-abc123456');

      expect(addItem).toHaveBeenCalled();
      const [historyItem] = addItem.mock.calls[0] as HistoryCall;
      expect(historyItem.type).toBe(MessageType.USER);
      expect(historyItem.text).toContain('/key');
      expect(historyItem.text).not.toContain('sk-abc123456');
    });
  });

  describe('processSlashCommand cancellation', () => {
    it('hands the action the signal of the controller registered for it', async () => {
      const addItem = vi.fn();
      let observedSignal: AbortSignal | undefined;
      const { deps, registered } = createCancellableDeps(addItem);
      deps.commands = createCommands((context: CommandContext) => {
        observedSignal = context.signal;
      });

      await processSlashCommand(deps, '/help');

      // Identity, not shape: a per-invocation signal, not the base context's.
      expect(registered).toHaveLength(1);
      expect(observedSignal).toBe(registered[0].signal);
    });

    it('aborts the signal the running action is awaiting on when cancelled', async () => {
      const addItem = vi.fn();
      const { deps, cancel } = createCancellableDeps(addItem);
      let abortedDuringAction = false;
      let releaseAction: (() => void) | undefined;
      deps.commands = createCommands(async (context: CommandContext) => {
        await new Promise<void>((resolve) => {
          releaseAction = resolve;
          context.signal.addEventListener('abort', () => {
            abortedDuringAction = true;
            resolve();
          });
        });
      });

      const pending = processSlashCommand(deps, '/help');
      await Promise.resolve();
      expect(cancel()).toBe(true);
      releaseAction?.();
      await pending;

      expect(abortedDuringAction).toBe(true);
    });

    it('does not report an error when the action rejects because it was cancelled', async () => {
      const addItem = vi.fn();
      const { deps, cancel } = createCancellableDeps(addItem);
      let rejectAction: ((reason: Error) => void) | undefined;
      deps.commands = createCommands(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectAction = reject;
          }),
      );

      const pending = processSlashCommand(deps, '/help');
      await Promise.resolve();
      cancel();
      rejectAction?.(new Error('This operation was aborted'));
      const result = await pending;

      expect(result).toStrictEqual({ type: 'handled' });
      expect(errorTexts(addItem)).toStrictEqual([]);
    });

    it('discards the result of an action that resolves after being cancelled', async () => {
      // A command that notices the abort and unwinds cleanly still returns a
      // result. Acting on it would carry out the work the user just cancelled —
      // e.g. submitting a prompt built from a killed shell injection.
      const addItem = vi.fn();
      const { deps, cancel } = createCancellableDeps(addItem);
      let releaseAction: (() => void) | undefined;
      deps.commands = createCommands(async () => {
        await new Promise<void>((resolve) => {
          releaseAction = resolve;
        });
        return { type: 'submit_prompt' as const, content: 'partial work' };
      });

      const pending = processSlashCommand(deps, '/help');
      await Promise.resolve();
      cancel();
      releaseAction?.();

      expect(await pending).toStrictEqual({ type: 'handled' });
    });

    it('still reports an error when the action rejects without being cancelled', async () => {
      const addItem = vi.fn();
      const { deps } = createCancellableDeps(addItem);
      deps.commands = createCommands(async () => {
        throw new Error('backend exploded');
      });

      await processSlashCommand(deps, '/help');

      expect(errorTexts(addItem)).toStrictEqual(['backend exploded']);
    });

    it('parks a confirming tool group that takes the prompt away', async () => {
      // Links the two halves of the composer-visibility rule: the shell-expansion
      // approval this pipeline produces is exactly what
      // computeIsAwaitingSlashCommandConfirmation looks for.
      const addItem = vi.fn();
      const setPendingItem = vi.fn();
      const { deps } = createCancellableDeps(addItem);
      deps.setPendingItem = setPendingItem;
      deps.commands = createCommands(() => ({
        type: 'confirm_shell_commands' as const,
        commandsToConfirm: ['echo hi'],
        originalInvocation: { raw: '/help' },
      }));

      void processSlashCommand(deps, '/help');
      await waitFor(() => expect(setPendingItem).toHaveBeenCalled());

      const pendingItems = setPendingItem.mock.calls
        .map(([item]) => item as HistoryItemWithoutId | null)
        .filter((item): item is HistoryItemWithoutId => item !== null);
      expect(pendingItems.length).toBeGreaterThan(0);
      expect(computeIsAwaitingSlashCommandConfirmation(pendingItems)).toBe(
        true,
      );
    });

    it('deregisters the action once it settles so a later Esc cancels nothing', async () => {
      const addItem = vi.fn();
      const { deps, cancel } = createCancellableDeps(addItem);
      deps.commands = createCommands(() => {});

      await processSlashCommand(deps, '/help');

      expect(cancel()).toBe(false);
    });

    it('deregisters even when the invocation fails before the action runs', async () => {
      // Otherwise the registry keeps a controller nothing is waiting on, and a
      // later Esc reports a cancellation that did not happen.
      const addItem = vi.fn();
      const { deps, cancel } = createCancellableDeps(addItem);
      deps.commandContext = new Proxy(deps.commandContext, {
        get() {
          throw new Error('context construction exploded');
        },
      });
      deps.commands = createCommands(() => {});

      await processSlashCommand(deps, '/help');

      expect(errorTexts(addItem)).toStrictEqual([
        'context construction exploded',
      ]);
      expect(cancel()).toBe(false);
    });
  });

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
      deps.commandContext.services.agent = createFakeAgent([], {
        setHistory: async () => {},
      });
      deps.commandContext.services.config =
        emojiMode === null
          ? null
          : ({
              getEphemeralSetting: vi.fn().mockReturnValue(emojiMode),
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
      deps.commandContext.services.agent = createFakeAgent([], { setHistory });
      deps.commandContext.services.config = {
        getEphemeralSetting: vi.fn().mockReturnValue('auto'),
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
        projectTempDir: '/tmp/chats',
        getSessionRecordingQueueByteLimit: () => 0,
        logSlashCommand: () => {},
        // #3199 threads the media store through buildResumeContext.
        getLocalMediaStore: () => undefined,
        getProjectRoot: vi.fn().mockReturnValue('/tmp/project'),
        getSessionId: vi.fn().mockReturnValue('session-1'),
        getProvider: vi.fn().mockReturnValue('test-provider'),
        getModel: vi.fn().mockReturnValue('test-model'),
        directories: () => ['/tmp/project'],
        adoptSessionId: vi.fn(),
      } as never;
      const owner = createUiSessionOwner();
      deps.commandContext.services.agent = createFakeAgent([], {
        workspace: owner.workspace,
        sessionClient: owner.sessionClient,
        agentClient: owner.agentClient,
        providerManager: owner.providerManager,
      });
      deps.recordingSwapCallbacks = {} as never;
      deps.sessionPersistence = {
        mediaStore: new LocalMediaStore({
          rootDirectory: join(tmpdir(), 'slash-resume-text-only-media'),
          quotaBytes: 1024,
        }),
        forRecording: () => {
          throw new Error('Mocked resume must not request a journal');
        },
      };
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
  it('resumes legacy slash media through explicit client and recording owners without Config media lookup', async () => {
    await withRecordingLifetimeFixture(async ({ config, agent }) => {
      const root = await mkdtemp(join(tmpdir(), 'slash-media-owner-'));
      const store = new LocalMediaStore({
        rootDirectory: join(root, 'media'),
        quotaBytes: 1024,
      });
      const persistence = new CliSessionPersistence(
        { projectRoot: config.storageRoot, chatsDir: config.projectChatsDir },
        {
          mediaStore: store,
          maxQueueBytes: config.getSessionRecordingQueueByteLimit(),
        },
      );
      try {
        const reference = await store.admit({
          bytes: new TextEncoder().encode('owned media'),
          mimeType: 'text/plain',
          semanticMetadata: {},
        });
        const deps = createDeps(vi.fn());
        const displayed: string[] = [];
        deps.commandContext.ui.addItem = (item) => {
          if (item.type === MessageType.USER && item.text !== undefined) {
            displayed.push(item.text);
          }
          return displayed.length;
        };
        deps.config = composeFixtureRuntime(config);
        deps.commandContext.services.config = composeFixtureRuntime(config);
        deps.commandContext.services.agent = agent;
        deps.recordingSwapCallbacks = {
          getCurrentRecording: () => null,
          getCurrentIntegration: () => null,
          getCurrentLockHandle: () => null,
          setRecording: () => {
            throw new Error('Mocked resume must not swap recordings');
          },
        };
        deps.sessionPersistence = persistence;
        deps.performResumeFn = async (_sessionRef, context) => {
          const bytes = await context.mediaStore?.readVerified(reference);
          if (bytes === undefined) throw new Error('Missing owner media store');
          return {
            ok: true,
            warnings: [],
            metadata: {
              sessionId: config.getSessionId(),
              projectHash: getProjectHash(config.getProjectRoot()),
              provider: config.getProvider() ?? 'unknown',
              model: config.getModel(),
              workspaceDirs: [...agent.workspace.getDirectories()],
              startTime: new Date().toISOString(),
            },
            history: [
              {
                speaker: 'human',
                blocks: [
                  { type: 'text', text: new TextDecoder().decode(bytes) },
                ],
              },
            ],
          };
        };
        deps.commands = [
          {
            name: 'continue',
            description: 'Continue session',
            kind: CommandKind.BUILT_IN,
            action: async () => ({
              type: 'perform_resume',
              sessionRef: 'shared-label',
            }),
          },
        ];

        await processSlashCommand(deps, '/continue shared-label');

        expect(displayed).toContain('owned media');
      } finally {
        persistence.close();
        await store.close();
        await rm(root, { recursive: true, force: true });
      }
    });
  });

  it('routes /continue through a real Agent owner without raw swap callbacks', async () => {
    await withRecordingLifetimeFixture(async ({ agent, borrow, config }) => {
      await agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'slash replay' }] },
      ]);
      await agent.session.setRecording({ enabled: true });
      const sourceId = (await agent.session.listSessions()).at(0)?.id;
      if (!sourceId) throw new Error('Missing source');
      await agent.session.setRecording({ enabled: false });
      const next = await borrow();
      await next.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'current live owner' }],
        },
      ]);
      await next.session.setRecording({ enabled: true });
      const deps = createDeps(vi.fn());
      deps.config = composeFixtureRuntime(config);
      deps.commandContext.services.agent = next;
      deps.commandContext.recordingOwner = 'agent';
      let loaded:
        | Parameters<CommandContext['ui']['loadHistory']>[0]
        | undefined;
      deps.commandContext.ui.loadHistory = (history) => {
        loaded = history;
      };
      deps.commands = [
        {
          name: 'continue',
          description: 'Continue session',
          kind: CommandKind.BUILT_IN,
          action: async () => ({
            type: 'perform_resume',
            sessionRef: sourceId,
          }),
        },
      ];
      await processSlashCommand(deps, `/continue ${sourceId}`);
      expect(
        loaded?.some(
          (item) => item.type === 'user' && item.text === 'slash replay',
        ),
      ).toBe(true);
      expect(next.session.getRecording().enabled).toBe(true);
    });
  }, 30000);
});
