import { parseOutputLimits, type IContent } from '@vybestack/llxprt-code-core';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, type Mock } from 'bun:test';
import { bindDumpManager } from './__tests__/dumpcontext-owner-fixture.js';
import { createDumpcontextCommand } from './dumpcontextCommand.js';
import { bindDumpcontextCommand } from './dumpcontextCommandHost.js';
import type { CommandOwnerFixture as CommandContext } from '../../__tests__/mockCommandContext.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import {
  snapshotFixture,
  fixtureRows,
  captureStreamingDump,
} from './dumpcontext-test-helpers.js';

import {
  createOpenAIDumpHistory,
  createAnthropicDumpHistory,
} from './dumpcontext-command-test-helpers-fixtures.js';

const actual = { ...(await import('@vybestack/llxprt-code-providers')) };
void vi.mock('@vybestack/llxprt-code-providers', () => ({
  ...actual,
  dumpRequestContextStream: (
    ...args: Parameters<typeof actual.dumpRequestContextStream>
  ) => captureStreamingDump(dumpRequestContext)(...args),
  dumpRequestContext: vi.fn().mockResolvedValue({
    baseId: '20260101-120000-anthropic-abc123',
    requestFilename: '20260101-120000-anthropic-abc123-request.json',
    dumpDir: '/tmp/.llxprt/dumps',
  }),
}));

import { dumpRequestContext } from '@vybestack/llxprt-code-providers';

const getRuntimeApi = vi.fn<() => Record<string, unknown>>(() => ({
  getSessionSetting: vi.fn((key: string) => {
    if (key === 'dumpcontext') {
      return 'off';
    }
    return undefined;
  }),
  setSessionSetting: vi.fn(),
}));
import { assertDefined } from '../../__tests__/assertions.js';

function createOwnedCommandContext(
  ...args: Parameters<typeof createMockCommandContext>
): CommandContext {
  const context = createMockCommandContext(...args);
  Object.defineProperty(context, 'runtimeApi', {
    configurable: true,
    get: () => getRuntimeApi(),
  });
  bindDumpManager(context, getRuntimeApi, () => undefined);
  return context;
}

async function dumpcontextAction(context: CommandContext, args: string) {
  const command = createDumpcontextCommand(
    bindDumpcontextCommand({
      readMode: () => context.runtimeApi.getSessionSetting('dumpcontext'),
      writeMode: (mode) =>
        context.runtimeApi.setSessionSetting('dumpcontext', mode),
      readHistory: async () =>
        context.services.agent === null
          ? null
          : context.services.agent.session.openDumpSnapshot(),
      readProvider: () => context.runtimeApi.getProviderDumpMetadata(),
      readOutputSettings: () =>
        context.services.config?.getEphemeralSettings() ?? {},
    }),
  );
  assertDefined(command.action);
  return command.action(context, args);
}

describe('dumpcontextCommand now subcommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (dumpRequestContext as Mock<typeof dumpRequestContext>).mockResolvedValue({
      baseId: '20260101-120000-anthropic-abc123',
      requestFilename: '20260101-120000-anthropic-abc123-request.json',
      dumpDir: '/tmp/.llxprt/dumps',
    });
  });
  registerNowTests();
});

function registerNowTests(): void {
  describe('now subcommand', () => {
    it(
      'should dump context immediately and not set session setting',
      dumpsWithoutSettingSession,
    );
    it(
      'should dump context immediately when getAgentClient relies on its receiver (this binding)',
      preservesAgentClientReceiver,
    );
    it(
      'should shape immediate dump body for OpenAI history',
      shapesOpenAIHistory,
    );
    it(
      'should shape immediate dump body for OpenAI-compatible aliases',
      shapesOpenAIAliasHistory,
    );
    it(
      'should shape immediate dump body for Anthropic history',
      shapesAnthropicHistory,
    );
    it(
      'should dump the plugin-built Gemini body verbatim when the active provider owns the conversion',
      preservesGeminiPluginBody,
    );
    it(
      'should pass active config and model into Gemini immediate dump conversion',
      passesGeminiActiveConfigAndModel,
    );
    it(
      'should return an actionable error when a Gemini provider lacks the plugin-owned conversion',
      reportsMissingGeminiPlugin,
    );
    it(
      'should keep raw history for unknown providers',
      preservesUnknownProviderHistory,
    );
    it(
      'should return friendly error when history is unavailable',
      reportsUnavailableHistory,
    );
    it(
      'should return friendly error when agent client is undefined',
      reportsUndefinedAgentClient,
    );
    it(
      'should default provider name to backend when no provider manager',
      defaultsToBackendProvider,
    );
    it(
      'should return friendly error when history service returns null',
      reportsNullHistory,
    );
    it(
      'should return friendly error when getAgentClient is not callable',
      reportsNonCallableAgentClient,
    );
  });
}

async function dumpsWithoutSettingSession(): Promise<void> {
  const mockSetSessionSetting = vi.fn();
  (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
    getSessionSetting: vi.fn(() => 'off'),
    setSessionSetting: mockSetSessionSetting,
  } as never);

  const mockGetHistoryService = vi.fn().mockReturnValue({
    streamRawHistory: () =>
      fixtureRows([
        { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
        { speaker: 'ai', blocks: [{ type: 'text', text: 'Hi there' }] },
      ]),
    getChronologyTrace: vi.fn(async function* () {}),
    openDumpSnapshot: snapshotFixture,
  });
  const mockGetProviderManager = vi.fn().mockReturnValue({
    getActiveProviderName: vi.fn().mockReturnValue('anthropic'),
    getActiveProvider: () => undefined,
  });

  const ctxWithHistory = createOwnedCommandContext({
    services: {
      agent: {
        session: {
          openDumpSnapshot: async () => {
            const read = mockGetHistoryService;
            const selectedHistory = read();
            return selectedHistory === null
              ? null
              : selectedHistory.openDumpSnapshot();
          },
        },
      } as unknown as CommandContext['services']['agent'],
      config: {} as unknown as CommandContext['services']['config'],
    },
  });
  bindDumpManager(ctxWithHistory, getRuntimeApi, mockGetProviderManager);

  const result = await dumpcontextAction(ctxWithHistory, 'now');

  expect(mockSetSessionSetting).not.toHaveBeenCalled();
  expect(dumpRequestContext).toHaveBeenCalledTimes(1);
  expect(dumpRequestContext).toHaveBeenCalledWith(
    expect.objectContaining({ url: 'immediate-context-dump' }),
    'anthropic',
    undefined,
    [],
    { media: 'raw', signal: ctxWithHistory.signal },
  );
  expect(result).toStrictEqual({
    type: 'message',
    messageType: 'info',
    content: expect.stringContaining(
      'Immediate request context dumped to 20260101-120000-anthropic-abc123-request.json',
    ),
  });
  expect(result).toMatchObject({
    content: expect.stringContaining(
      'No model request was sent, so no model response dump was created.',
    ),
  });
}

async function preservesAgentClientReceiver(): Promise<void> {
  (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
    getSessionSetting: vi.fn(() => 'off'),
    setSessionSetting: vi.fn(),
  } as never);

  const historyService = {
    streamRawHistory: () =>
      fixtureRows([
        { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
      ]),
    getChronologyTrace: vi.fn(async function* () {}),
    openDumpSnapshot: snapshotFixture,
  };

  const agentWithReceiverDependentMethod = {
    session: {
      historyService,
      async openDumpSnapshot() {
        return this.historyService.openDumpSnapshot();
      },
    },
  };

  const ctxWithHistory = createOwnedCommandContext();
  ctxWithHistory.services.agent =
    agentWithReceiverDependentMethod as unknown as CommandContext['services']['agent'];
  bindDumpManager(ctxWithHistory, getRuntimeApi, () => ({
    getActiveProviderName: () => 'anthropic',
    getActiveProvider: () => undefined,
  }));

  const result = await dumpcontextAction(ctxWithHistory, 'now');

  expect(dumpRequestContext).toHaveBeenCalledTimes(1);
  expect(dumpRequestContext).toHaveBeenCalledWith(
    expect.objectContaining({ url: 'immediate-context-dump' }),
    'anthropic',
    undefined,
    [],
    { media: 'raw', signal: ctxWithHistory.signal },
  );
  expect(result).toStrictEqual({
    type: 'message',
    messageType: 'info',
    content: expect.stringContaining('Immediate request context dumped to'),
  });
}

async function shapesOpenAIHistory(): Promise<void> {
  (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
    getSessionSetting: vi.fn(() => 'off'),
    setSessionSetting: vi.fn(),
  } as never);

  const ctxWithHistory = createOwnedCommandContext({
    services: {
      agent: {
        session: {
          openDumpSnapshot: async () => {
            const read = vi.fn().mockReturnValue({
              streamRawHistory: () => fixtureRows(createOpenAIDumpHistory()),
              getChronologyTrace: vi.fn(async function* () {}),
              openDumpSnapshot: snapshotFixture,
            });
            const selectedHistory = read();
            return selectedHistory === null
              ? null
              : selectedHistory.openDumpSnapshot();
          },
        },
      } as unknown as CommandContext['services']['agent'],
      config: {
        getEphemeralSettings: vi.fn().mockReturnValue({}),
      } as unknown as CommandContext['services']['config'],
    },
  });
  bindDumpManager(
    ctxWithHistory,
    getRuntimeApi,
    vi.fn().mockReturnValue({
      getActiveProviderName: vi.fn().mockReturnValue('openai'),
      getActiveProvider: vi.fn().mockReturnValue({
        getCurrentModel: vi.fn().mockReturnValue('gpt-4.1'),
      }),
    }),
  );

  await dumpcontextAction(ctxWithHistory, 'now');

  const requestArg = (dumpRequestContext as ReturnType<typeof vi.fn>).mock
    .calls[0][0];
  expect(requestArg.body.model).toBe('gpt-4.1');

  expect(requestArg.body.messages[0].content).toStrictEqual([
    { type: 'text', text: 'Hello' },
    {
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,abc123' },
    },
  ]);
  expect(requestArg.body.messages[1]).toMatchObject({
    role: 'assistant',
    tool_calls: [
      {
        id: 'call_1',
        type: 'function',
        function: {
          name: 'read_file',
          arguments: '{"path":"README.md"}',
        },
      },
    ],
  });
  expect(requestArg.body.messages[2]).toMatchObject({
    role: 'tool',
    tool_call_id: 'call_1',
  });
}

async function shapesOpenAIAliasHistory(): Promise<void> {
  (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
    getSessionSetting: vi.fn(() => 'off'),
    setSessionSetting: vi.fn(),
  } as never);

  const history: IContent[] = [
    { speaker: 'human', blocks: [{ type: 'text', text: 'Hello alias' }] },
  ];
  const ctxWithHistory = createOwnedCommandContext({
    services: {
      agent: {
        session: {
          openDumpSnapshot: async () => {
            const read = vi.fn().mockReturnValue({
              streamRawHistory: () => fixtureRows(history),
              getChronologyTrace: vi.fn(async function* () {}),
              openDumpSnapshot: snapshotFixture,
            });
            const selectedHistory = read();
            return selectedHistory === null
              ? null
              : selectedHistory.openDumpSnapshot();
          },
        },
      } as unknown as CommandContext['services']['agent'],
      config: {
        getEphemeralSettings: vi.fn().mockReturnValue({}),
      } as unknown as CommandContext['services']['config'],
    },
  });
  bindDumpManager(
    ctxWithHistory,
    getRuntimeApi,
    vi.fn().mockReturnValue({
      getActiveProviderName: vi.fn().mockReturnValue('openaivercel'),
      getActiveProvider: () => undefined,
    }),
  );

  await dumpcontextAction(ctxWithHistory, 'now');

  const requestArg = (dumpRequestContext as ReturnType<typeof vi.fn>).mock
    .calls[0][0];
  expect(requestArg.body).toHaveProperty('messages');
  expect(requestArg.body).not.toHaveProperty('history');
  expect(requestArg.body.messages[0]).toMatchObject({
    role: 'user',
    content: 'Hello alias',
  });
}

async function shapesAnthropicHistory(): Promise<void> {
  (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
    getSessionSetting: vi.fn(() => 'off'),
    setSessionSetting: vi.fn(),
  } as never);

  const ctxWithHistory = createOwnedCommandContext({
    services: {
      agent: {
        session: {
          openDumpSnapshot: async () => {
            const read = vi.fn().mockReturnValue({
              streamRawHistory: () => fixtureRows(createAnthropicDumpHistory()),
              getChronologyTrace: vi.fn(async function* () {}),
              openDumpSnapshot: snapshotFixture,
            });
            const selectedHistory = read();
            return selectedHistory === null
              ? null
              : selectedHistory.openDumpSnapshot();
          },
        },
      } as unknown as CommandContext['services']['agent'],
      config: {
        getEphemeralSettings: vi.fn().mockReturnValue({}),
      } as unknown as CommandContext['services']['config'],
    },
  });
  bindDumpManager(
    ctxWithHistory,
    getRuntimeApi,
    vi.fn().mockReturnValue({
      getActiveProviderName: vi.fn().mockReturnValue('anthropic'),
      getActiveProvider: () => undefined,
    }),
  );

  await dumpcontextAction(ctxWithHistory, 'now');

  const requestArg = (dumpRequestContext as ReturnType<typeof vi.fn>).mock
    .calls[0][0];
  expect(requestArg.body.messages[0]).toMatchObject({
    role: 'user',
    content: [
      { type: 'text', text: 'Question' },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'abc123' },
      },
    ],
  });
  expect(requestArg.body.messages[1]).toMatchObject({
    role: 'assistant',
    content: [
      { type: 'text', text: 'Answer' },
      {
        type: 'tool_use',
        id: 'toolu_1',
        name: 'search',
        input: { q: 'docs' },
      },
    ],
  });
  expect(requestArg.body.messages[2]).toMatchObject({
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'toolu_1',
      },
    ],
  });
}

async function preservesGeminiPluginBody(): Promise<void> {
  (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
    getSessionSetting: vi.fn(() => 'off'),
    setSessionSetting: vi.fn(),
  } as never);

  // Since #2763 the Gemini wire shaping lives in
  // @vybestack/llxprt-plugin-google-gemini and reaches the command as the
  // active provider's buildContextDumpBody seam (the shaping itself is
  // covered by the plugin's own suite). The body below is a stand-in for
  // what the plugin builds; the command must write it through unmodified.
  const pluginBuiltBody = {
    model: 'gemini-2.5-pro',
    contents: [
      {
        role: 'user',
        parts: [
          { text: 'Ping' },
          { inlineData: { mimeType: 'image/png', data: 'abc123' } },
        ],
      },
      {
        role: 'model',
        parts: [
          { text: 'Pong' },
          {
            functionCall: { id: 'call_1', name: 'lookup', args: { id: 7 } },
          },
        ],
      },
    ],
  };
  const ctxWithHistory = createOwnedCommandContext({
    services: {
      agent: {
        session: {
          openDumpSnapshot: async () => {
            const read = vi.fn().mockReturnValue({
              streamRawHistory: () =>
                fixtureRows([
                  {
                    speaker: 'human',
                    blocks: [{ type: 'text', text: 'Ping' }],
                  },
                ]),
              getChronologyTrace: vi.fn(async function* () {}),
              openDumpSnapshot: snapshotFixture,
            });
            const selectedHistory = read();
            return selectedHistory === null
              ? null
              : selectedHistory.openDumpSnapshot();
          },
        },
      } as unknown as CommandContext['services']['agent'],
      config: {} as unknown as CommandContext['services']['config'],
    },
  });
  bindDumpManager(
    ctxWithHistory,
    getRuntimeApi,
    vi.fn().mockReturnValue({
      getActiveProviderName: vi.fn().mockReturnValue('gemini'),
      getActiveProvider: vi.fn().mockReturnValue({
        getCurrentModel: vi.fn().mockReturnValue('gemini-2.5-pro'),
        contextDumpVersion: 2,
        buildContextDumpBody: vi.fn().mockResolvedValue(pluginBuiltBody),
      }),
    }),
  );

  await dumpcontextAction(ctxWithHistory, 'now');

  const requestArg = (dumpRequestContext as ReturnType<typeof vi.fn>).mock
    .calls[0][0];
  expect(requestArg.body).toStrictEqual(pluginBuiltBody);
}

async function passesGeminiActiveConfigAndModel(): Promise<void> {
  (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
    getSessionSetting: vi.fn(() => 'off'),
    setSessionSetting: vi.fn(),
  } as never);

  const history: IContent[] = [
    { speaker: 'human', blocks: [{ type: 'text', text: 'Ping' }] },
  ];
  const config = createMockCommandContext().services.config;
  const ctxWithHistory = createOwnedCommandContext({
    services: {
      config,
      agent: {
        session: {
          openDumpSnapshot: async () => {
            const read = vi.fn().mockReturnValue({
              streamRawHistory: () => fixtureRows(history),
              getChronologyTrace: vi.fn(async function* () {}),
              openDumpSnapshot: snapshotFixture,
            });
            const selectedHistory = read();
            return selectedHistory === null
              ? null
              : selectedHistory.openDumpSnapshot();
          },
        },
      } as unknown as CommandContext['services']['agent'],
    },
  });
  const ctxConfig = ctxWithHistory.services.config;
  if (!ctxConfig) {
    throw new Error('Expected services.config on mock context');
  }

  const dumpManager = vi.fn().mockReturnValue({
    getActiveProviderName: vi.fn().mockReturnValue('gemini'),
    getActiveProvider: vi.fn().mockReturnValue({
      getCurrentModel: vi.fn().mockReturnValue('gemini-3-pro'),
      contextDumpVersion: 2,
      buildContextDumpBody: vi.fn().mockResolvedValue({ contents: [] }),
    }),
  });
  bindDumpManager(ctxWithHistory, getRuntimeApi, dumpManager);

  await dumpcontextAction(ctxWithHistory, 'now');

  const buildContextDumpBody = dumpManager().getActiveProvider()
    .buildContextDumpBody as ReturnType<typeof vi.fn>;
  expect(buildContextDumpBody).toHaveBeenCalledOnce();
  // The command threads the SAME history rows and active model through to
  // the plugin-owned seam, plus the output limits parsed from the context's
  // ACTIVE ephemeral settings (the plugin contract takes limits, not Config).
  const [historyArg, modelArg, limitsArg] = buildContextDumpBody.mock.calls[0];
  const receivedRows = [];
  for await (const row of historyArg.rows()) receivedRows.push(row);
  expect(receivedRows).toStrictEqual(history);
  expect(modelArg).toBe('gemini-3-pro');
  expect(limitsArg).toStrictEqual(
    parseOutputLimits(ctxConfig.getEphemeralSettings()),
  );
  const requestArg = (dumpRequestContext as ReturnType<typeof vi.fn>).mock
    .calls[0][0];
  expect(requestArg.body).toStrictEqual({ contents: [] });
}

async function reportsMissingGeminiPlugin(): Promise<void> {
  (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
    getSessionSetting: vi.fn(() => 'off'),
    setSessionSetting: vi.fn(),
  } as never);

  // A base-only install without the google-gemini plugin: the provider
  // name is Gemini-family but no plugin-owned conversion exists.
  const ctxWithoutPlugin = createOwnedCommandContext({
    services: {
      agent: {
        session: {
          openDumpSnapshot: async () => {
            const read = vi.fn().mockReturnValue({
              streamRawHistory: () =>
                fixtureRows([
                  {
                    speaker: 'human',
                    blocks: [{ type: 'text', text: 'Hi' }],
                  },
                ]),
              getChronologyTrace: vi.fn(async function* () {}),
              openDumpSnapshot: snapshotFixture,
            });
            const selectedHistory = read();
            return selectedHistory === null
              ? null
              : selectedHistory.openDumpSnapshot();
          },
        },
      } as unknown as CommandContext['services']['agent'],
      config: {} as unknown as CommandContext['services']['config'],
    },
  });
  bindDumpManager(
    ctxWithoutPlugin,
    getRuntimeApi,
    vi.fn().mockReturnValue({
      getActiveProviderName: vi.fn().mockReturnValue('gemini'),
      getActiveProvider: vi.fn().mockReturnValue({
        getCurrentModel: vi.fn().mockReturnValue('gemini-2.5-pro'),
      }),
    }),
  );

  const result = await dumpcontextAction(ctxWithoutPlugin, 'now');

  expect(dumpRequestContext).not.toHaveBeenCalled();
  expect(result).toStrictEqual({
    type: 'message',
    messageType: 'error',
    content: expect.stringContaining('@vybestack/llxprt-plugin-google-gemini'),
  });
}

async function preservesUnknownProviderHistory(): Promise<void> {
  const history: IContent[] = [
    { speaker: 'human', blocks: [{ type: 'text', text: 'Hi' }] },
  ];
  (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
    getSessionSetting: vi.fn(() => 'off'),
    setSessionSetting: vi.fn(),
  } as never);

  const ctxWithHistory = createOwnedCommandContext({
    services: {
      agent: {
        session: {
          openDumpSnapshot: async () => {
            const read = vi.fn().mockReturnValue({
              streamRawHistory: () => fixtureRows(history),
              getChronologyTrace: vi.fn(async function* () {}),
              openDumpSnapshot: snapshotFixture,
            });
            const selectedHistory = read();
            return selectedHistory === null
              ? null
              : selectedHistory.openDumpSnapshot();
          },
        },
      } as unknown as CommandContext['services']['agent'],
      config: {
        getEphemeralSettings: vi.fn().mockReturnValue({}),
      } as unknown as CommandContext['services']['config'],
    },
  });
  bindDumpManager(
    ctxWithHistory,
    getRuntimeApi,
    vi.fn().mockReturnValue({
      getActiveProviderName: vi.fn().mockReturnValue('custom'),
      getActiveProvider: () => undefined,
    }),
  );

  await dumpcontextAction(ctxWithHistory, 'now');

  const requestArg = (dumpRequestContext as ReturnType<typeof vi.fn>).mock
    .calls[0][0];
  expect(requestArg.body).toStrictEqual({ history });
}

async function reportsUnavailableHistory(): Promise<void> {
  (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
    getSessionSetting: vi.fn(() => 'off'),
    setSessionSetting: vi.fn(),
  } as never);

  const ctxWithoutHistory = createOwnedCommandContext({
    services: {
      agent: null,
      config: {} as unknown as CommandContext['services']['config'],
    },
  });

  const result = await dumpcontextAction(ctxWithoutHistory, 'now');

  expect(dumpRequestContext).not.toHaveBeenCalled();
  expect(result).toStrictEqual({
    type: 'message',
    messageType: 'error',
    content: expect.stringContaining('not available'),
  });
}

async function reportsUndefinedAgentClient(): Promise<void> {
  (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
    getSessionSetting: vi.fn(() => 'off'),
    setSessionSetting: vi.fn(),
  } as never);

  const ctxWithoutAgentClient = createOwnedCommandContext({
    services: {
      agent: null,
      config: {} as unknown as CommandContext['services']['config'],
    },
  });

  const result = await dumpcontextAction(ctxWithoutAgentClient, 'now');

  expect(dumpRequestContext).not.toHaveBeenCalled();
  expect(result).toStrictEqual({
    type: 'message',
    messageType: 'error',
    content: expect.stringContaining('not available'),
  });
}

async function defaultsToBackendProvider(): Promise<void> {
  const mockSetSessionSetting = vi.fn();
  (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
    getSessionSetting: vi.fn(() => 'off'),
    setSessionSetting: mockSetSessionSetting,
  } as never);

  const mockGetHistoryService = vi.fn().mockReturnValue({
    streamRawHistory: () =>
      fixtureRows([
        { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
      ]),
    getChronologyTrace: vi.fn(async function* () {}),
    openDumpSnapshot: snapshotFixture,
  });

  const ctxNoProviderManager = createOwnedCommandContext({
    services: {
      agent: {
        session: {
          openDumpSnapshot: async () => {
            const read = mockGetHistoryService;
            const selectedHistory = read();
            return selectedHistory === null
              ? null
              : selectedHistory.openDumpSnapshot();
          },
        },
      } as unknown as CommandContext['services']['agent'],
      config: {} as unknown as CommandContext['services']['config'],
    },
  });
  bindDumpManager(
    ctxNoProviderManager,
    getRuntimeApi,
    vi.fn().mockReturnValue(undefined),
  );

  await dumpcontextAction(ctxNoProviderManager, 'now');

  expect(dumpRequestContext).toHaveBeenCalledOnce();
  const requestArg = (dumpRequestContext as ReturnType<typeof vi.fn>).mock
    .calls[0][0];
  expect(requestArg.method).toBe('DUMP');
  expect(requestArg.url).toBe('immediate-context-dump');
  // Provider should default to 'backend' when no provider manager
  const providerArg = (dumpRequestContext as ReturnType<typeof vi.fn>).mock
    .calls[0][1];
  expect(providerArg).toBe('backend');
}

async function reportsNullHistory(): Promise<void> {
  (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
    getSessionSetting: vi.fn(() => 'off'),
    setSessionSetting: vi.fn(),
  } as never);

  const ctxWithNullHistory = createOwnedCommandContext({
    services: {
      agent: {
        session: {
          openDumpSnapshot: async () => {
            const read = vi.fn().mockReturnValue(null);
            const selectedHistory = read();
            return selectedHistory === null
              ? null
              : selectedHistory.openDumpSnapshot();
          },
        },
      } as unknown as CommandContext['services']['agent'],
      config: {} as unknown as CommandContext['services']['config'],
    },
  });

  const result = await dumpcontextAction(ctxWithNullHistory, 'now');

  expect(dumpRequestContext).not.toHaveBeenCalled();
  expect(result).toStrictEqual({
    type: 'message',
    messageType: 'error',
    content: expect.stringContaining('not available'),
  });
}

async function reportsNonCallableAgentClient(): Promise<void> {
  (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
    getSessionSetting: vi.fn(() => 'off'),
    setSessionSetting: vi.fn(),
  } as never);

  const ctxWithoutCallableAgentClient = createOwnedCommandContext({
    services: {
      agent: null,
      config: {} as unknown as CommandContext['services']['config'],
    },
  });

  const result = await dumpcontextAction(ctxWithoutCallableAgentClient, 'now');

  expect(dumpRequestContext).not.toHaveBeenCalled();
  expect(result).toStrictEqual({
    type: 'message',
    messageType: 'error',
    content: expect.stringContaining('not available'),
  });
}
