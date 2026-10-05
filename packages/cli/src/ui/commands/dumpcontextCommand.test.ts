import type { IContent } from '@vybestack/llxprt-code-core';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, type Mock } from 'bun:test';
import { dumpcontextCommand } from './dumpcontextCommand.js';
import { type CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import {
  snapshotFixture,
  fixtureRows,
  captureStreamingDump,
} from './dumpcontext-test-stream.js';

import {
  createOpenAIDumpHistory,
  createAnthropicDumpHistory,
} from './dumpcontext-command-fixtures.js';

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

void vi.mock('../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: vi.fn(() => ({
    getSessionSetting: vi.fn((key: string) => {
      if (key === 'dumpcontext') {
        return 'off';
      }
      return undefined;
    }),
    setSessionSetting: vi.fn(),
  })),
}));

import { getRuntimeApi } from '../contexts/RuntimeContext.js';
import { assertDefined } from '../../test-utils/assertions.js';

let mockContext: CommandContext;

function requireDumpcontextAction(): NonNullable<
  typeof dumpcontextCommand.action
> {
  const action = dumpcontextCommand.action;
  assertDefined(action);
  return action;
}

const dumpcontextAction = requireDumpcontextAction();

describe('dumpcontextCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (dumpRequestContext as Mock<typeof dumpRequestContext>).mockResolvedValue({
      baseId: '20260101-120000-anthropic-abc123',
      requestFilename: '20260101-120000-anthropic-abc123-request.json',
      dumpDir: '/tmp/.llxprt/dumps',
    });
    mockContext = createMockCommandContext();
  });
  registerStatusTests();
  registerOnTests();
  registerErrorTests();
  registerOffTests();
  registerNowTests();
  registerInvalidTests();
});

function registerStatusTests(): void {
  describe('status subcommand', () => {
    it('should show current dumpcontext status when mode is off', async () => {
      (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
        getSessionSetting: vi.fn(() => 'off'),
        setSessionSetting: vi.fn(),
      } as never);

      assertDefined(dumpcontextCommand.action);

      const result = await dumpcontextCommand.action(mockContext, 'status');

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Context dumping: off'),
      });
    });

    it('should show current dumpcontext status when mode is on', async () => {
      (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
        getSessionSetting: vi.fn(() => 'on'),
        setSessionSetting: vi.fn(),
      } as never);

      assertDefined(dumpcontextCommand.action);

      const result = await dumpcontextCommand.action(mockContext, 'status');

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Context dumping: on'),
      });
    });

    it('should default to status when no args provided', async () => {
      (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
        getSessionSetting: vi.fn(() => 'error'),
        setSessionSetting: vi.fn(),
      } as never);

      assertDefined(dumpcontextCommand.action);

      const result = await dumpcontextCommand.action(mockContext, '');

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Context dumping: error'),
      });
    });
  });
}

function registerOnTests(): void {
  describe('on subcommand', () => {
    it('should enable context dumping for all requests', async () => {
      const mockSetSessionSetting = vi.fn();
      (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
        getSessionSetting: vi.fn(() => 'off'),
        setSessionSetting: mockSetSessionSetting,
      } as never);

      assertDefined(dumpcontextCommand.action);

      const result = await dumpcontextCommand.action(mockContext, 'on');

      expect(mockSetSessionSetting).toHaveBeenCalledWith('dumpcontext', 'on');
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Context dumping enabled'),
      });
    });
  });
}

function registerErrorTests(): void {
  describe('error subcommand', () => {
    it('should enable context dumping only for errors', async () => {
      const mockSetSessionSetting = vi.fn();
      (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
        getSessionSetting: vi.fn(() => 'off'),
        setSessionSetting: mockSetSessionSetting,
      } as never);

      assertDefined(dumpcontextCommand.action);

      const result = await dumpcontextCommand.action(mockContext, 'error');

      expect(mockSetSessionSetting).toHaveBeenCalledWith(
        'dumpcontext',
        'error',
      );
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Context dumping enabled for errors'),
      });
    });
  });
}

function registerOffTests(): void {
  describe('off subcommand', () => {
    it('should disable context dumping', async () => {
      const mockSetSessionSetting = vi.fn();
      (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
        getSessionSetting: vi.fn(() => 'on'),
        setSessionSetting: mockSetSessionSetting,
      } as never);

      assertDefined(dumpcontextCommand.action);

      const result = await dumpcontextCommand.action(mockContext, 'off');

      expect(mockSetSessionSetting).toHaveBeenCalledWith('dumpcontext', 'off');
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Context dumping disabled'),
      });
    });
  });
}

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
  });

  const ctxWithHistory = createMockCommandContext({
    services: {
      config: {
        getAgentClient: vi.fn().mockReturnValue({
          getHistoryService: mockGetHistoryService,
        }),
        getProviderManager: mockGetProviderManager,
      } as unknown as CommandContext['services']['config'],
    },
  });

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

  const configWithReceiverDependentMethod = {
    agentClient: {
      getHistoryService: () => historyService,
    },
    getAgentClient() {
      return this.agentClient;
    },
    getProviderManager() {
      return {
        getActiveProviderName: () => 'anthropic',
      };
    },
  };

  const ctxWithHistory = createMockCommandContext();
  ctxWithHistory.services.config =
    configWithReceiverDependentMethod as unknown as CommandContext['services']['config'];

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

  const ctxWithHistory = createMockCommandContext({
    services: {
      config: {
        getAgentClient: vi.fn().mockReturnValue({
          getHistoryService: vi.fn().mockReturnValue({
            streamRawHistory: () => fixtureRows(createOpenAIDumpHistory()),
            getChronologyTrace: vi.fn(async function* () {}),
            openDumpSnapshot: snapshotFixture,
          }),
        }),
        getEphemeralSettings: vi.fn().mockReturnValue({}),
        getProviderManager: vi.fn().mockReturnValue({
          getActiveProviderName: vi.fn().mockReturnValue('openai'),
          getActiveProvider: vi.fn().mockReturnValue({
            getCurrentModel: vi.fn().mockReturnValue('gpt-4.1'),
          }),
        }),
      } as unknown as CommandContext['services']['config'],
    },
  });

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
  const ctxWithHistory = createMockCommandContext({
    services: {
      config: {
        getAgentClient: vi.fn().mockReturnValue({
          getHistoryService: vi.fn().mockReturnValue({
            streamRawHistory: () => fixtureRows(history),
            getChronologyTrace: vi.fn(async function* () {}),
            openDumpSnapshot: snapshotFixture,
          }),
        }),
        getEphemeralSettings: vi.fn().mockReturnValue({}),
        getProviderManager: vi.fn().mockReturnValue({
          getActiveProviderName: vi.fn().mockReturnValue('openaivercel'),
        }),
      } as unknown as CommandContext['services']['config'],
    },
  });

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

  const ctxWithHistory = createMockCommandContext({
    services: {
      config: {
        getAgentClient: vi.fn().mockReturnValue({
          getHistoryService: vi.fn().mockReturnValue({
            streamRawHistory: () => fixtureRows(createAnthropicDumpHistory()),
            getChronologyTrace: vi.fn(async function* () {}),
            openDumpSnapshot: snapshotFixture,
          }),
        }),
        getEphemeralSettings: vi.fn().mockReturnValue({}),
        getProviderManager: vi.fn().mockReturnValue({
          getActiveProviderName: vi.fn().mockReturnValue('anthropic'),
        }),
      } as unknown as CommandContext['services']['config'],
    },
  });

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
  const ctxWithHistory = createMockCommandContext({
    services: {
      config: {
        getAgentClient: vi.fn().mockReturnValue({
          getHistoryService: vi.fn().mockReturnValue({
            streamRawHistory: () =>
              fixtureRows([
                {
                  speaker: 'human',
                  blocks: [{ type: 'text', text: 'Ping' }],
                },
              ]),
            getChronologyTrace: vi.fn(async function* () {}),
            openDumpSnapshot: snapshotFixture,
          }),
        }),
        getProviderManager: vi.fn().mockReturnValue({
          getActiveProviderName: vi.fn().mockReturnValue('gemini'),
          getActiveProvider: vi.fn().mockReturnValue({
            getCurrentModel: vi.fn().mockReturnValue('gemini-2.5-pro'),
            contextDumpVersion: 2,
            buildContextDumpBody: vi.fn().mockResolvedValue(pluginBuiltBody),
          }),
        }),
      } as unknown as CommandContext['services']['config'],
    },
  });

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
  const config = {
    getAgentClient: vi.fn().mockReturnValue({
      getHistoryService: vi.fn().mockReturnValue({
        streamRawHistory: () => fixtureRows(history),
        getChronologyTrace: vi.fn(async function* () {}),
        openDumpSnapshot: snapshotFixture,
      }),
    }),
    getProviderManager: vi.fn().mockReturnValue({
      getActiveProviderName: vi.fn().mockReturnValue('gemini'),
      getActiveProvider: vi.fn().mockReturnValue({
        getCurrentModel: vi.fn().mockReturnValue('gemini-3-pro'),
        contextDumpVersion: 2,
        buildContextDumpBody: vi.fn().mockResolvedValue({ contents: [] }),
      }),
    }),
  } as unknown as CommandContext['services']['config'];
  if (!config) {
    throw new Error('Expected services.config fixture');
  }
  const ctxWithHistory = createMockCommandContext({
    services: { config },
  });
  const ctxConfig = ctxWithHistory.services.config;
  if (!ctxConfig) {
    throw new Error('Expected services.config on mock context');
  }
  const providerManager = ctxConfig.getProviderManager();
  if (!providerManager) {
    throw new Error('Expected provider manager on mock context config');
  }

  await dumpcontextAction(ctxWithHistory, 'now');

  const buildContextDumpBody = (
    providerManager.getActiveProvider() as unknown as {
      buildContextDumpBody: ReturnType<typeof vi.fn>;
    }
  ).buildContextDumpBody;
  expect(buildContextDumpBody).toHaveBeenCalledOnce();
  // Identity assertions: the command threads the SAME history and active
  // model through to the plugin-owned seam, plus the context's ACTIVE
  // config object. createMockCommandContext deep-merges the config given
  // to the factory with its own defaults into a derived instance, so the
  // seam's config identity is the context's config, not the literal
  // argument passed to the factory; production passes
  // context.services.config unchanged.
  const [historyArg, modelArg, configArg] = buildContextDumpBody.mock.calls[0];
  const receivedRows = [];
  for await (const row of historyArg.rows()) receivedRows.push(row);
  expect(receivedRows).toStrictEqual(history);
  expect(modelArg).toBe('gemini-3-pro');
  expect(configArg).toBe(ctxConfig);
  // The derived config still carries this test's provider-manager wiring.
  expect(configArg.getProviderManager).toBe(config.getProviderManager);
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
  const ctxWithoutPlugin = createMockCommandContext({
    services: {
      config: {
        getAgentClient: vi.fn().mockReturnValue({
          getHistoryService: vi.fn().mockReturnValue({
            streamRawHistory: () =>
              fixtureRows([
                {
                  speaker: 'human',
                  blocks: [{ type: 'text', text: 'Hi' }],
                },
              ]),
            getChronologyTrace: vi.fn(async function* () {}),
            openDumpSnapshot: snapshotFixture,
          }),
        }),
        getProviderManager: vi.fn().mockReturnValue({
          getActiveProviderName: vi.fn().mockReturnValue('gemini'),
          getActiveProvider: vi.fn().mockReturnValue({
            getCurrentModel: vi.fn().mockReturnValue('gemini-2.5-pro'),
          }),
        }),
      } as unknown as CommandContext['services']['config'],
    },
  });

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

  const ctxWithHistory = createMockCommandContext({
    services: {
      config: {
        getAgentClient: vi.fn().mockReturnValue({
          getHistoryService: vi.fn().mockReturnValue({
            streamRawHistory: () => fixtureRows(history),
            getChronologyTrace: vi.fn(async function* () {}),
            openDumpSnapshot: snapshotFixture,
          }),
        }),
        getEphemeralSettings: vi.fn().mockReturnValue({}),
        getProviderManager: vi.fn().mockReturnValue({
          getActiveProviderName: vi.fn().mockReturnValue('custom'),
        }),
      } as unknown as CommandContext['services']['config'],
    },
  });

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

  const ctxWithoutHistory = createMockCommandContext({
    services: {
      config: {
        getAgentClient: vi.fn().mockReturnValue(null),
      } as unknown as CommandContext['services']['config'],
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

  const ctxWithoutAgentClient = createMockCommandContext({
    services: {
      config: {
        getAgentClient: vi.fn().mockReturnValue(undefined),
      } as unknown as CommandContext['services']['config'],
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

  const ctxNoProviderManager = createMockCommandContext({
    services: {
      config: {
        getAgentClient: vi.fn().mockReturnValue({
          getHistoryService: mockGetHistoryService,
        }),
        getProviderManager: vi.fn().mockReturnValue(undefined),
      } as unknown as CommandContext['services']['config'],
    },
  });

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

  const ctxWithNullHistory = createMockCommandContext({
    services: {
      config: {
        getAgentClient: vi.fn().mockReturnValue({
          getHistoryService: vi.fn().mockReturnValue(null),
        }),
      } as unknown as CommandContext['services']['config'],
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

  const ctxWithoutCallableAgentClient = createMockCommandContext({
    services: {
      config: {
        getAgentClient: undefined,
      } as unknown as CommandContext['services']['config'],
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

function registerInvalidTests(): void {
  describe('invalid subcommand', () => {
    it('should return error for invalid mode', async () => {
      (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
        getSessionSetting: vi.fn(() => 'off'),
        setSessionSetting: vi.fn(),
      } as never);

      assertDefined(dumpcontextCommand.action);

      const result = await dumpcontextCommand.action(mockContext, 'invalid');

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('Invalid mode'),
      });
    });
  });
}
