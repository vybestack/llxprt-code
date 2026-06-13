/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { dumpcontextCommand } from './dumpcontextCommand.js';
import { type CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';

vi.mock('@vybestack/llxprt-code-providers', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-providers')>();
  return {
    ...actual,
    dumpRequestContext: vi.fn().mockResolvedValue({
      baseId: '20260101-120000-anthropic-abc123',
      requestFilename: '20260101-120000-anthropic-abc123-request.json',
      dumpDir: '/tmp/.llxprt/dumps',
    }),
  };
});

import { dumpRequestContext } from '@vybestack/llxprt-code-providers';

vi.mock('../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: vi.fn(() => ({
    getEphemeralSetting: vi.fn((key: string) => {
      if (key === 'dumpcontext') {
        return 'off';
      }
      return undefined;
    }),
    setEphemeralSetting: vi.fn(),
  })),
}));

import { getRuntimeApi } from '../contexts/RuntimeContext.js';

const dumpcontextAction = dumpcontextCommand.action;
if (!dumpcontextAction) {
  throw new Error('dumpcontextCommand must have an action');
}

describe('dumpcontextCommand', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(dumpRequestContext).mockResolvedValue({
      baseId: '20260101-120000-anthropic-abc123',
      requestFilename: '20260101-120000-anthropic-abc123-request.json',
      dumpDir: '/tmp/.llxprt/dumps',
    });
    mockContext = createMockCommandContext();
  });

  describe('status subcommand', () => {
    it('should show current dumpcontext status when mode is off', async () => {
      vi.mocked(getRuntimeApi).mockReturnValue({
        getEphemeralSetting: vi.fn(() => 'off'),
        setEphemeralSetting: vi.fn(),
      } as never);

      // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
      if (!dumpcontextCommand.action) {
        throw new Error('dumpcontextCommand must have an action');
      }

      const result = await dumpcontextCommand.action(mockContext, 'status');

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Context dumping: off'),
      });
    });

    it('should show current dumpcontext status when mode is on', async () => {
      vi.mocked(getRuntimeApi).mockReturnValue({
        getEphemeralSetting: vi.fn(() => 'on'),
        setEphemeralSetting: vi.fn(),
      } as never);

      // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
      if (!dumpcontextCommand.action) {
        throw new Error('dumpcontextCommand must have an action');
      }

      const result = await dumpcontextCommand.action(mockContext, 'status');

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Context dumping: on'),
      });
    });

    it('should default to status when no args provided', async () => {
      vi.mocked(getRuntimeApi).mockReturnValue({
        getEphemeralSetting: vi.fn(() => 'error'),
        setEphemeralSetting: vi.fn(),
      } as never);

      // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
      if (!dumpcontextCommand.action) {
        throw new Error('dumpcontextCommand must have an action');
      }

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
      const mockSetEphemeralSetting = vi.fn();
      vi.mocked(getRuntimeApi).mockReturnValue({
        getEphemeralSetting: vi.fn(() => 'off'),
        setEphemeralSetting: mockSetEphemeralSetting,
      } as never);

      // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
      if (!dumpcontextCommand.action) {
        throw new Error('dumpcontextCommand must have an action');
      }

      const result = await dumpcontextCommand.action(mockContext, 'on');

      expect(mockSetEphemeralSetting).toHaveBeenCalledWith('dumpcontext', 'on');
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Context dumping enabled'),
      });
    });
  });

  describe('error subcommand', () => {
    it('should enable context dumping only for errors', async () => {
      const mockSetEphemeralSetting = vi.fn();
      vi.mocked(getRuntimeApi).mockReturnValue({
        getEphemeralSetting: vi.fn(() => 'off'),
        setEphemeralSetting: mockSetEphemeralSetting,
      } as never);

      // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
      if (!dumpcontextCommand.action) {
        throw new Error('dumpcontextCommand must have an action');
      }

      const result = await dumpcontextCommand.action(mockContext, 'error');

      expect(mockSetEphemeralSetting).toHaveBeenCalledWith(
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
      const mockSetEphemeralSetting = vi.fn();
      vi.mocked(getRuntimeApi).mockReturnValue({
        getEphemeralSetting: vi.fn(() => 'on'),
        setEphemeralSetting: mockSetEphemeralSetting,
      } as never);

      // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
      if (!dumpcontextCommand.action) {
        throw new Error('dumpcontextCommand must have an action');
      }

      const result = await dumpcontextCommand.action(mockContext, 'off');

      expect(mockSetEphemeralSetting).toHaveBeenCalledWith(
        'dumpcontext',
        'off',
      );
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Context dumping disabled'),
      });
    });
  });

  describe('now subcommand', () => {
    it('should dump context immediately and not set ephemeral setting', async () => {
      const mockSetEphemeralSetting = vi.fn();
      vi.mocked(getRuntimeApi).mockReturnValue({
        getEphemeralSetting: vi.fn(() => 'off'),
        setEphemeralSetting: mockSetEphemeralSetting,
      } as never);

      const mockGetHistoryService = vi.fn().mockReturnValue({
        getAll: vi.fn().mockReturnValue([
          { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
          { speaker: 'ai', blocks: [{ type: 'text', text: 'Hi there' }] },
        ]),
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

      expect(mockSetEphemeralSetting).not.toHaveBeenCalled();
      expect(dumpRequestContext).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ url: 'immediate-context-dump' }),
        'anthropic',
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

    it('should shape immediate dump body for OpenAI history', async () => {
      vi.mocked(getRuntimeApi).mockReturnValue({
        getEphemeralSetting: vi.fn(() => 'off'),
        setEphemeralSetting: vi.fn(),
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
      vi.mocked(getRuntimeApi).mockReturnValue({
        getEphemeralSetting: vi.fn(() => 'off'),
        setEphemeralSetting: vi.fn(),
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
      vi.mocked(getRuntimeApi).mockReturnValue({
        getEphemeralSetting: vi.fn(() => 'off'),
        setEphemeralSetting: vi.fn(),
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

    it('should shape immediate dump body for Gemini history', async () => {
      vi.mocked(getRuntimeApi).mockReturnValue({
        getEphemeralSetting: vi.fn(() => 'off'),
        setEphemeralSetting: vi.fn(),
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
                      { type: 'text', text: 'Ping' },
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
                      { type: 'text', text: 'Pong' },
                      {
                        type: 'tool_call',
                        id: 'call_1',
                        name: 'lookup',
                        parameters: { id: 7 },
                      },
                    ],
                  },
                  {
                    speaker: 'tool',
                    blocks: [
                      {
                        type: 'tool_response',
                        callId: 'call_1',
                        toolName: 'lookup',
                        result: { ok: true },
                      },
                    ],
                  },
                ]),
              }),
            }),
            getEphemeralSettings: vi.fn().mockReturnValue({}),
            getProviderManager: vi.fn().mockReturnValue({
              getActiveProviderName: vi.fn().mockReturnValue('gemini'),
              getActiveProvider: vi.fn().mockReturnValue({
                getCurrentModel: vi.fn().mockReturnValue('gemini-2.5-pro'),
              }),
            }),
          } as unknown as CommandContext['services']['config'],
        },
      });

      await dumpcontextAction(ctxWithHistory, 'now');

      const requestArg = (dumpRequestContext as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(requestArg.body.model).toBe('gemini-2.5-pro');

      expect(requestArg.body.contents).toStrictEqual([
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
            { functionCall: { id: 'call_1', name: 'lookup', args: { id: 7 } } },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                id: 'call_1',
                name: 'lookup',
                response: expect.objectContaining({ result: '{"ok":true}' }),
              },
            },
          ],
        },
      ]);
    });

    it('should pass active config and model into Gemini immediate dump conversion', async () => {
      vi.mocked(getRuntimeApi).mockReturnValue({
        getEphemeralSetting: vi.fn(() => 'off'),
        setEphemeralSetting: vi.fn(),
      } as never);

      const longResult = Array.from(
        { length: 200 },
        (_, i) => `line-${i}`,
      ).join('\n');
      const config = {
        getAgentClient: vi.fn().mockReturnValue({
          getHistoryService: vi.fn().mockReturnValue({
            getAll: vi.fn().mockReturnValue([
              {
                speaker: 'tool',
                blocks: [
                  {
                    type: 'tool_response',
                    callId: 'call_1',
                    toolName: 'search',
                    result: longResult,
                  },
                  {
                    type: 'media',
                    mimeType: 'image/png',
                    encoding: 'base64',
                    data: 'image-data',
                  },
                ],
              },
            ]),
          }),
        }),
        getProviderManager: vi.fn().mockReturnValue({
          getActiveProviderName: vi.fn().mockReturnValue('gemini'),
          getActiveProvider: vi.fn().mockReturnValue({
            getCurrentModel: vi.fn().mockReturnValue('gemini-3-pro'),
          }),
        }),
        getEphemeralSettings: vi.fn().mockReturnValue({
          'tool-output-max-tokens': 5,
          'tool-output-truncate-mode': 'warn',
        }),
      } as unknown as CommandContext['services']['config'];
      const ctxWithHistory = createMockCommandContext({
        services: { config },
      });

      await dumpcontextAction(ctxWithHistory, 'now');

      const requestArg = (dumpRequestContext as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      const functionResponse =
        requestArg.body.contents[0].parts[0].functionResponse;
      expect(functionResponse.response).toMatchObject({
        status: 'success',
        truncated: true,
        limitMessage: expect.stringContaining(
          'search output exceeded token limit',
        ),
      });
      expect(functionResponse.parts).toStrictEqual([
        { inlineData: { mimeType: 'image/png', data: 'image-data' } },
      ]);
    });

    it('should keep raw history for unknown providers', async () => {
      const history = [
        { speaker: 'human', blocks: [{ type: 'text', text: 'Hi' }] },
      ];
      vi.mocked(getRuntimeApi).mockReturnValue({
        getEphemeralSetting: vi.fn(() => 'off'),
        setEphemeralSetting: vi.fn(),
      } as never);

      const ctxWithHistory = createMockCommandContext({
        services: {
          config: {
            getAgentClient: vi.fn().mockReturnValue({
              getHistoryService: vi.fn().mockReturnValue({
                getAll: vi.fn().mockReturnValue(history),
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
      vi.mocked(getRuntimeApi).mockReturnValue({
        getEphemeralSetting: vi.fn(() => 'off'),
        setEphemeralSetting: vi.fn(),
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
      vi.mocked(getRuntimeApi).mockReturnValue({
        getEphemeralSetting: vi.fn(() => 'off'),
        setEphemeralSetting: vi.fn(),
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
      const mockSetEphemeralSetting = vi.fn();
      vi.mocked(getRuntimeApi).mockReturnValue({
        getEphemeralSetting: vi.fn(() => 'off'),
        setEphemeralSetting: mockSetEphemeralSetting,
      } as never);

      const mockGetHistoryService = vi.fn().mockReturnValue({
        getAll: vi
          .fn()
          .mockReturnValue([
            { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
          ]),
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
      vi.mocked(getRuntimeApi).mockReturnValue({
        getEphemeralSetting: vi.fn(() => 'off'),
        setEphemeralSetting: vi.fn(),
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
      vi.mocked(getRuntimeApi).mockReturnValue({
        getEphemeralSetting: vi.fn(() => 'off'),
        setEphemeralSetting: vi.fn(),
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
      vi.mocked(getRuntimeApi).mockReturnValue({
        getEphemeralSetting: vi.fn(() => 'off'),
        setEphemeralSetting: vi.fn(),
      } as never);

      // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
      if (!dumpcontextCommand.action) {
        throw new Error('dumpcontextCommand must have an action');
      }

      const result = await dumpcontextCommand.action(mockContext, 'invalid');

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('Invalid mode'),
      });
    });
  });
});
