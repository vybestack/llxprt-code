/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, type Mock } from 'bun:test';
import { dumpcontextCommand } from './dumpcontextCommand.js';
import { type CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';

const actual = { ...(await import('@vybestack/llxprt-code-providers')) };
void vi.mock('@vybestack/llxprt-code-providers', () => ({
  ...actual,
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

const dumpcontextAction = dumpcontextCommand.action;
assertDefined(dumpcontextAction);

describe('dumpcontextCommand', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    (dumpRequestContext as Mock<typeof dumpRequestContext>).mockResolvedValue({
      baseId: '20260101-120000-anthropic-abc123',
      requestFilename: '20260101-120000-anthropic-abc123-request.json',
      dumpDir: '/tmp/.llxprt/dumps',
    });
    mockContext = createMockCommandContext();
  });

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

  describe('now subcommand', () => {
    it('should dump context immediately and not set session setting', async () => {
      const mockSetSessionSetting = vi.fn();
      (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
        getSessionSetting: vi.fn(() => 'off'),
        setSessionSetting: mockSetSessionSetting,
      } as never);

      const mockGetHistoryService = vi.fn().mockReturnValue({
        getAll: vi.fn().mockReturnValue([
          { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
          { speaker: 'ai', blocks: [{ type: 'text', text: 'Hi there' }] },
        ]),
        getChronologyTrace: vi.fn().mockReturnValue([]),
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
        { media: 'raw' },
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
    });

    it('should dump context immediately when getAgentClient relies on its receiver (this binding)', async () => {
      (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
        getSessionSetting: vi.fn(() => 'off'),
        setSessionSetting: vi.fn(),
      } as never);

      const historyService = {
        getAll: vi
          .fn()
          .mockReturnValue([
            { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
          ]),
        getChronologyTrace: vi.fn().mockReturnValue([]),
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
        { media: 'raw' },
      );
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Immediate request context dumped to'),
      });
    });

    it('should shape immediate dump body for OpenAI history', async () => {
      (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
        getSessionSetting: vi.fn(() => 'off'),
        setSessionSetting: vi.fn(),
      } as never);

      const ctxWithHistory = createMockCommandContext({
        services: {
          config: {
            getAgentClient: vi.fn().mockReturnValue({
              getHistoryService: vi.fn().mockReturnValue({
                getAll: vi.fn().mockReturnValue([
                  {
                    speaker: 'human',
                    blocks: [
                      { type: 'text', text: 'Hello' },
                      {
                        type: 'media',
                        mimeType: 'image/png',
                        encoding: 'base64',
                        data: 'abc123',
                      },
                    ],
                  },
                  {
                    speaker: 'ai',
                    blocks: [
                      { type: 'text', text: 'Hi' },
                      {
                        type: 'tool_call',
                        id: 'call_1',
                        name: 'read_file',
                        parameters: { path: 'README.md' },
                      },
                    ],
                  },
                  {
                    speaker: 'tool',
                    blocks: [
                      {
                        type: 'tool_response',
                        callId: 'call_1',
                        toolName: 'read_file',
                        result: 'contents',
                      },
                    ],
                  },
                ]),
                getChronologyTrace: vi.fn().mockReturnValue([]),
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
    });

    it('should shape immediate dump body for OpenAI-compatible aliases', async () => {
      (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
        getSessionSetting: vi.fn(() => 'off'),
        setSessionSetting: vi.fn(),
      } as never);

      const history = [
        { speaker: 'human', blocks: [{ type: 'text', text: 'Hello alias' }] },
      ];
      const ctxWithHistory = createMockCommandContext({
        services: {
          config: {
            getAgentClient: vi.fn().mockReturnValue({
              getHistoryService: vi.fn().mockReturnValue({
                getAll: vi.fn().mockReturnValue(history),
                getChronologyTrace: vi.fn().mockReturnValue([]),
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
    });

    it('should shape immediate dump body for Anthropic history', async () => {
      (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
        getSessionSetting: vi.fn(() => 'off'),
        setSessionSetting: vi.fn(),
      } as never);

      const ctxWithHistory = createMockCommandContext({
        services: {
          config: {
            getAgentClient: vi.fn().mockReturnValue({
              getHistoryService: vi.fn().mockReturnValue({
                getAll: vi.fn().mockReturnValue([
                  {
                    speaker: 'human',
                    blocks: [
                      { type: 'text', text: 'Question' },
                      {
                        type: 'media',
                        mimeType: 'image/png',
                        encoding: 'base64',
                        data: 'abc123',
                      },
                    ],
                  },
                  {
                    speaker: 'ai',
                    blocks: [
                      { type: 'text', text: 'Answer' },
                      {
                        type: 'tool_call',
                        id: 'toolu_1',
                        name: 'search',
                        parameters: { q: 'docs' },
                      },
                    ],
                  },
                  {
                    speaker: 'tool',
                    blocks: [
                      {
                        type: 'tool_response',
                        callId: 'toolu_1',
                        toolName: 'search',
                        result: 'found',
                      },
                    ],
                  },
                ]),
                getChronologyTrace: vi.fn().mockReturnValue([]),
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
    });

    it('should dump the plugin-built Gemini body verbatim when the active provider owns the conversion', async () => {
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
                getAll: vi.fn().mockReturnValue([
                  {
                    speaker: 'human',
                    blocks: [{ type: 'text', text: 'Ping' }],
                  },
                ]),
                getChronologyTrace: vi.fn().mockReturnValue([]),
              }),
            }),
            getProviderManager: vi.fn().mockReturnValue({
              getActiveProviderName: vi.fn().mockReturnValue('gemini'),
              getActiveProvider: vi.fn().mockReturnValue({
                getCurrentModel: vi.fn().mockReturnValue('gemini-2.5-pro'),
                buildContextDumpBody: vi.fn().mockReturnValue(pluginBuiltBody),
              }),
            }),
          } as unknown as CommandContext['services']['config'],
        },
      });

      await dumpcontextAction(ctxWithHistory, 'now');

      const requestArg = (dumpRequestContext as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(requestArg.body).toStrictEqual(pluginBuiltBody);
    });

    it('should pass active config and model into Gemini immediate dump conversion', async () => {
      (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
        getSessionSetting: vi.fn(() => 'off'),
        setSessionSetting: vi.fn(),
      } as never);

      const history = [
        { speaker: 'human', blocks: [{ type: 'text', text: 'Ping' }] },
      ];
      const config = {
        getAgentClient: vi.fn().mockReturnValue({
          getHistoryService: vi.fn().mockReturnValue({
            getAll: vi.fn().mockReturnValue(history),
            getChronologyTrace: vi.fn().mockReturnValue([]),
          }),
        }),
        getProviderManager: vi.fn().mockReturnValue({
          getActiveProviderName: vi.fn().mockReturnValue('gemini'),
          getActiveProvider: vi.fn().mockReturnValue({
            getCurrentModel: vi.fn().mockReturnValue('gemini-3-pro'),
            buildContextDumpBody: vi.fn().mockReturnValue({ contents: [] }),
          }),
        }),
      } as unknown as CommandContext['services']['config'];
      const ctxWithHistory = createMockCommandContext({
        services: { config },
      });

      await dumpcontextAction(ctxWithHistory, 'now');

      const buildContextDumpBody = (
        ctxWithHistory.services.config
          .getProviderManager()
          .getActiveProvider() as unknown as {
          buildContextDumpBody: Mock;
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
      const [historyArg, modelArg, configArg] =
        buildContextDumpBody.mock.calls[0];
      expect(historyArg).toBe(history);
      expect(modelArg).toBe('gemini-3-pro');
      expect(configArg).toBe(ctxWithHistory.services.config);
      // The derived config still carries this test's provider-manager wiring.
      expect(configArg.getProviderManager).toBe(config.getProviderManager);
      const requestArg = (dumpRequestContext as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(requestArg.body).toStrictEqual({ contents: [] });
    });

    it('should return an actionable error when a Gemini provider lacks the plugin-owned conversion', async () => {
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
                getAll: vi.fn().mockReturnValue([
                  {
                    speaker: 'human',
                    blocks: [{ type: 'text', text: 'Hi' }],
                  },
                ]),
                getChronologyTrace: vi.fn().mockReturnValue([]),
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
        content: expect.stringContaining(
          '@vybestack/llxprt-plugin-google-gemini',
        ),
      });
    });

    it('should keep raw history for unknown providers', async () => {
      const history = [
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
                getAll: vi.fn().mockReturnValue(history),
                getChronologyTrace: vi.fn().mockReturnValue([]),
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
    });

    it('should return friendly error when history is unavailable', async () => {
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
    });

    it('should return friendly error when agent client is undefined', async () => {
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
    });

    it('should default provider name to backend when no provider manager', async () => {
      const mockSetSessionSetting = vi.fn();
      (getRuntimeApi as Mock<typeof getRuntimeApi>).mockReturnValue({
        getSessionSetting: vi.fn(() => 'off'),
        setSessionSetting: mockSetSessionSetting,
      } as never);

      const mockGetHistoryService = vi.fn().mockReturnValue({
        getAll: vi
          .fn()
          .mockReturnValue([
            { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
          ]),
        getChronologyTrace: vi.fn().mockReturnValue([]),
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
    });

    it('should return friendly error when history service returns null', async () => {
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
    });

    it('should return friendly error when getAgentClient is not callable', async () => {
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

      const result = await dumpcontextAction(
        ctxWithoutCallableAgentClient,
        'now',
      );

      expect(dumpRequestContext).not.toHaveBeenCalled();
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('not available'),
      });
    });
  });

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
});
