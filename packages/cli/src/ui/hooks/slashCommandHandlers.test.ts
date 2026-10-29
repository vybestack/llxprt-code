import { installFixtureRawResume } from '../../__tests__/command-raw-resume-fixture.js';
import {
  performResume,
  type RecordingSwapCallbacks,
} from '../../services/performResume.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CommandHandlerFixture as SlashCommandHandlerDeps } from './slash-command-handler-deps-test-helpers.js';
import type {
  CommandContext,
  SlashCommandActionReturn,
} from '../commands/types.js';

import { installWorkspaceRuntimeFixture } from '../../__tests__/workspace-runtime-fixture.js';
const composeFixtureRuntime = installWorkspaceRuntimeFixture();
import {
  filterHistoryItems,
  createEmojiFilter,
  resolveEmojiFilterMode,
} from '../utils/iContentToHistoryItems.js';
import { withRecordingLifetimeFixture } from '../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { readJournalItems } from '../stores/turn/journal-turn-test-helpers.js';
import {
  assertNativeSlashEvent,
  assertNativeDirectories,
  useRecordingLogCapture,
} from './__tests__/support/slashRecordingAssertions.js';
import {
  bindFixtureOwnerResume,
  createCommands,
} from '../../__tests__/command-history-result-fixture.js';
import { bindCommandErrorRecorder } from './commandErrorRecorderHost.js';
import {
  createDeps,
  errorTexts,
} from './slash-command-handler-deps-test-helpers.js';
import { createDirectoryCommand } from '../commands/directoryCommand.js';
import {
  bindDirectoryCommand,
  bindDirectoryChangeRecording,
} from '../commands/directoryCommandHost.js';
import { mkdtemp, readFile, rm, realpath } from 'node:fs/promises';
import { buildSlashCommandRuntimeForTest } from '../../__tests__/slash-command-runtime-fixture.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CliSessionPersistence } from '../../cliSessionPersistence.js';

import { describe, expect, it, vi } from 'bun:test';
import { openRouteAAgent } from '../../../../agents/src/api/__tests__/helpers/route-a-agent.js';
import { useFakeResponsesReplay } from '../../../../agents/src/api/__tests__/helpers/fake-responses-replay.js';
import { createFakeAgent } from './agentStream/__tests__/helpers/createFakeAgent.js';
import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { getProjectHash, LocalMediaStore } from '@vybestack/llxprt-code-core';
import type { IContent } from '@vybestack/llxprt-code-core';

import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { appendJournalUiItem } from './command-journal-output.js';
import { CommandKind } from '../commands/types.js';
import { MessageType } from '../types.js';
import { processSlashCommand } from './slashCommandHandlers.js';
import { createSlashCommandCancellation } from './useSlashCommandCancellation.js';
import { computeIsAwaitingSlashCommandConfirmation } from '../containers/AppContainer/hooks/inputActivity.js';
import type { HistoryItemWithoutId } from '../types.js';

describe('slashCommandHandlers', () => {
  const captureRecordingLog = useRecordingLogCapture();
  useFakeResponsesReplay('multi-turn-text.jsonl');

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
        isMcpDiscoveryPending: () => agent.mcp.discoveryState() === 'pending',
        commandContext: createMockCommandContext({
          ...deps.commandContext,
          services: { ...deps.commandContext.services, agent },
        }),
        writeOutput: async (item) => {
          if (item.type === MessageType.ERROR) messages.push(item.text);
        },
      },
      '/arithmetic',
    );
    expect(messages).toStrictEqual([
      'Unknown command: /arithmetic. Command might have been from an MCP server but MCP servers are not done loading.',
    ]);
  });

  it('persists a slash error only through the selected owner recorder', async () => {
    const route = await openRouteAAgent({ config: { interactive: true } });
    try {
      const { agent } = route;
      await agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'start' }] },
      ]);
      await agent.session.setRecording({ enabled: true });
      const path = agent.session.getRecording().path;
      if (!path) throw new Error('No recording path');
      const deps = createDeps(vi.fn());
      const rawWrite = vi.fn();
      const before = new Uint8Array(await readFile(path));
      const logs = captureRecordingLog();
      await processSlashCommand(
        {
          ...deps,
          commandContext: Object.assign({}, deps.commandContext, {
            ...deps.commandContext,
            recordingOwner: 'agent',
            services: { ...deps.commandContext.services, agent },
          }),
          commands: createCommands(() => ({
            type: 'message',
            messageType: 'error',
            content: 'owner slash failure',
          })),
          writeOutput: async (item) => {
            await appendJournalUiItem(agent.session, undefined, item);
          },
          resumeOwnedSession: null,
          isMcpDiscoveryPending: () => false,
          resumeRawSession: null,
          refreshResumedHistory: () => {},
          recordCommandError: bindCommandErrorRecorder(
            agent.session.recordRecordingEvent.bind(agent.session),
            'agent',
            {
              recordSessionEvent: rawWrite,
            },
          ),
        },
        '/help',
      );
      await assertNativeSlashEvent(path, before, 'owner slash failure', logs);
      expect(rawWrite).not.toHaveBeenCalled();
    } finally {
      await route.close();
    }
  }, 30000);
  it('routes slash failures to a resumed different owner, not the closed owner', async () => {
    const route = await openRouteAAgent({ config: { interactive: true } });
    const liveRoute = await openRouteAAgent({ config: { interactive: true } });
    try {
      const { agent } = route;
      await agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'first owner' }] },
      ]);
      await agent.session.setRecording({ enabled: true });
      const firstPath = agent.session.getRecording().path;
      if (!firstPath) throw new Error('No first recording path');
      await agent.session.setRecording({ enabled: false });
      const next = liveRoute.agent;
      await next.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'second owner' }],
        },
      ]);
      await next.session.setRecording({ enabled: true });
      const secondPath = next.session.getRecording().path;
      if (!secondPath) throw new Error('No second recording path');
      const deps = createDeps(vi.fn());
      const before = new Uint8Array(await readFile(secondPath));
      const logs = captureRecordingLog();
      await processSlashCommand(
        {
          ...deps,
          commandContext: createMockCommandContext({
            ...deps.commandContext,
            recordingOwner: 'agent',
            services: { ...deps.commandContext.services, agent: next },
          }),
          resumeOwnedSession: null,
          isMcpDiscoveryPending: () => false,
          resumeRawSession: null,
          refreshResumedHistory: () => {},
          writeOutput: async (item) => {
            await appendJournalUiItem(next.session, undefined, item);
          },
          recordCommandError: bindCommandErrorRecorder(
            next.session.recordRecordingEvent.bind(next.session),
            'agent',
            undefined,
          ),
          commands: createCommands(() => {
            throw new Error('resumed owner failure');
          }),
        },
        '/help',
      );
      expect(await readFile(firstPath, 'utf8')).not.toContain(
        'resumed owner failure',
      );
      await assertNativeSlashEvent(
        secondPath,
        before,
        'resumed owner failure',
        logs,
      );
    } finally {
      await liveRoute.close();
      await route.close();
    }
  }, 30000);

  it('records /directory add once in the owner session JSONL', async () => {
    const route = await openRouteAAgent({ config: { interactive: true } });
    try {
      const { agent, config } = route;
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
        ...buildSlashCommandRuntimeForTest(config, agent),
        getFolderTrust: () => false,
        shouldLoadMemoryFromIncludeDirectories: () => false,
      };
      try {
        await processSlashCommand(
          {
            ...deps,
            commands: [
              createDirectoryCommand(
                bindDirectoryCommand(
                  runtime,
                  () => agent.addDirectoryContext(),
                  bindDirectoryChangeRecording(
                    'agent',
                    (event) => agent.session.recordRecordingEvent(event),
                    undefined,
                  ),
                  deps.commandContext.ui.addItem,
                  deps.commandContext.ui.setLlxprtMdFileCount,
                ),
              ),
            ],
            commandContext: createMockCommandContext({
              ...deps.commandContext,
              recordingOwner: 'agent',
              services: {
                ...deps.commandContext.services,
                agent,
                config: runtime,
              },
            }),
          },
          `/directory add ${addedDirectory}`,
        );
        await assertNativeDirectories(path, addedDirectory);
        expect(agent.workspace.containsPath(addedDirectory)).toBe(true);
      } finally {
        await rm(addedDirectory, { recursive: true, force: true });
      }
    } finally {
      await route.close();
    }
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

  describe('processSlashCommand', () => {
    it('sanitizes whitespace-separated secure commands before adding history', async () => {
      const addItem = vi.fn();

      await processSlashCommand(createDeps(addItem), '/key\tsk-abc123456');

      expect(addItem).toHaveBeenCalled();
      const [historyItem] = addItem.mock.calls[0];
      if (
        typeof historyItem !== 'object' ||
        historyItem === null ||
        !('type' in historyItem) ||
        !('text' in historyItem)
      )
        throw new Error('Missing command history');
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
      await waitFor(() => expect(releaseAction).toBeDefined());
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
      await waitFor(() => expect(rejectAction).toBeDefined());
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
      deps.commands = createCommands(
        async (): Promise<SlashCommandActionReturn> => {
          await new Promise<void>((resolve) => {
            releaseAction = resolve;
          });
          return { type: 'submit_prompt', content: 'partial work' };
        },
      );

      const pending = processSlashCommand(deps, '/help');
      await waitFor(() => expect(releaseAction).toBeDefined());
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
      const setPendingItem =
        vi.fn<(item: HistoryItemWithoutId | null) => void>();
      const { deps } = createCancellableDeps(addItem);
      deps.setPendingItem = setPendingItem;
      deps.commands = createCommands(() => ({
        type: 'confirm_shell_commands',
        commandsToConfirm: ['echo hi'],
        originalInvocation: { raw: '/help' },
      }));

      void processSlashCommand(deps, '/help');
      await waitFor(() => expect(setPendingItem).toHaveBeenCalled());

      const pendingItems = setPendingItem.mock.calls
        .map(([item]) => item)
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
          : createMockCommandContext({
              services: { config: { getEphemeralSetting: () => emojiMode } },
            }).services.config;
      deps.commands = [
        {
          name: 'loadhist',
          description: 'Load history for tests',
          kind: CommandKind.BUILT_IN,
          action: async () => {
            await deps.commandContext.services.agent?.setHistory(clientHistory);
            for (const item of filterHistoryItems(
              history,
              createEmojiFilter(
                resolveEmojiFilterMode(deps.commandContext.services.config),
              ),
            ))
              addItem(item, Date.now());
          },
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
      deps.commandContext.services.config = createMockCommandContext({
        services: { config: { getEphemeralSetting: () => 'auto' } },
      }).services.config;
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
          action: async () => {
            await deps.commandContext.services.agent?.setHistory(clientHistory);
            for (const item of filterHistoryItems(
              history,
              createEmojiFilter(
                resolveEmojiFilterMode(deps.commandContext.services.config),
              ),
            ))
              addItem(item, Date.now());
          },
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
      await withRecordingLifetimeFixture(async ({ agent, borrow, config }) => {
        await agent.setHistory([
          { speaker: 'human', blocks: [{ type: 'text', text: USER_TEXT }] },
          { speaker: 'ai', blocks: [{ type: 'text', text: MODEL_TEXT }] },
        ]);
        await agent.session.setRecording({ enabled: true });
        const id = (await agent.session.listSessions()).at(0)?.id;
        if (!id) throw new Error('Missing source session');
        await agent.session.setRecording({ enabled: false });
        const next = await borrow();
        await next.session.setRecording({ enabled: true });
        const deps = createDeps(vi.fn());
        deps.config = composeFixtureRuntime(config);
        deps.commandContext.services.agent = next;
        deps.commandContext.recordingOwner = 'agent';
        deps.resumeOwnedSession = bindFixtureOwnerResume(
          deps.commandContext,
          deps.commandContext.services.config,
        );
        deps.commands = [
          {
            name: 'resumecmd',
            description: 'Resume',
            kind: CommandKind.BUILT_IN,
            action: async () => ({ type: 'perform_resume', sessionRef: id }),
          },
        ];
        await processSlashCommand(deps, '/resumecmd');
        const items = await readJournalItems(next);
        expect(items.map((item) => [item.type, item.text])).toStrictEqual([
          ['user', USER_TEXT],
          ['gemini', 'Done [OK]'],
        ]);
        const raw = await Array.fromAsync(next.streamHistory());
        expect(
          raw
            .flatMap((row) => row.blocks)
            .filter((block) => block.type === 'text')
            .map((block) => block.text),
        ).toContain(MODEL_TEXT);
      });
    });
  });
  it('resumes legacy slash media through explicit client and recording owners without Config media lookup', async () => {
    const route = await openRouteAAgent({ config: { interactive: true } });
    try {
      const { agent, config } = route;
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
        await agent.session.setRecording({ enabled: true });
        deps.config = composeFixtureRuntime(config);
        deps.commandContext.services.config = composeFixtureRuntime(config);
        deps.commandContext.services.agent = agent;
        const callbacks: RecordingSwapCallbacks = {
          getCurrentRecording: () => null,
          getCurrentIntegration: () => null,
          getCurrentLockHandle: () => null,
          getCurrentMetadata: () => null,
          setRecording: () => {
            throw new Error('Mocked resume must not swap recordings');
          },
        };
        const resume: typeof performResume = async (_sessionRef, context) => {
          const bytes = await context.mediaStore?.readVerified(reference);
          if (bytes === undefined) throw new Error('Missing owner media store');
          await agent.setHistory([
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: new TextDecoder().decode(bytes) }],
            },
          ]);
          return {
            ok: true,
            warnings: [],
            metadata: {
              kind: 'main',
              sessionId: config.getSessionId(),
              projectHash: getProjectHash(config.getProjectRoot()),
              provider: config.getProvider() ?? 'unknown',
              model: config.getModel(),
              workspaceDirs: [...agent.workspace.getDirectories()],
              startTime: new Date().toISOString(),
            },
            history: (async function* (): AsyncGenerator<IContent> {
              yield {
                speaker: 'human',
                blocks: [
                  { type: 'text', text: new TextDecoder().decode(bytes) },
                ],
              };
            })(),
          };
        };
        const persistence = new CliSessionPersistence(
          {
            projectRoot: config.getProjectRoot(),
            chatsDir: config.projectChatsDir,
          },
          { mediaStore: store },
        );
        installFixtureRawResume(
          deps,
          {
            ...composeFixtureRuntime(config),
            getSessionRecordingQueueByteLimit: () => 0,
          },
          persistence,
          callbacks,
          resume,
        );
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

        expect(
          (await readJournalItems(agent))
            .filter((item) => item.type === 'user')
            .map((item) => item.text),
        ).toContain('owned media');
      } finally {
        persistence.close();
        await store.close();
        await rm(root, { recursive: true, force: true });
      }
    } finally {
      await route.close();
    }
  });

  it('routes /continue through a real Agent owner without raw swap callbacks', async () => {
    const route = await openRouteAAgent({ config: { interactive: true } });
    const liveRoute = await openRouteAAgent({
      config: { interactive: true, workingDir: route.directory },
    });
    try {
      const { agent, config } = route;
      await agent.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'slash replay' }],
        },
      ]);
      await agent.session.setRecording({ enabled: true });
      const sourceId = (await agent.session.listSessions()).at(0)?.id;
      if (!sourceId) throw new Error('Missing source');
      await agent.session.setRecording({ enabled: false });
      const next = liveRoute.agent;
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
      deps.resumeOwnedSession = bindFixtureOwnerResume(
        deps.commandContext,
        deps.commandContext.services.config,
      );
      await processSlashCommand(deps, `/continue ${sourceId}`);
      expect(
        (await readJournalItems(next)).some(
          (item) => item.type === 'user' && item.text === 'slash replay',
        ),
      ).toBe(true);
      expect(next.session.getRecording().enabled).toBe(true);
    } finally {
      await liveRoute.close();
      await route.close();
    }
  }, 30000);
});
