/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as dumpSDKContextModule from '../utils/dumpSDKContext.js';
import {
  executeApiRequest,
  type ApiExecutionOptions,
} from './OpenAIApiExecution.js';

function createMockClient(response: unknown) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue(response),
      },
    },
  } as unknown as Parameters<typeof executeApiRequest>[0]['client'];
}

function createBaseOptions(
  overrides: Partial<ApiExecutionOptions> = {},
): ApiExecutionOptions {
  return {
    client: createMockClient({ id: 'chatcmpl-test', choices: [] }),
    requestBody: {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
    } as unknown as Parameters<typeof executeApiRequest>[0]['requestBody'],
    abortSignal: undefined,
    mergedHeaders: undefined,
    dumpMode: 'on',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    formattedTools: undefined,
    streamingEnabled: false,
    logger: { error: vi.fn(), debug: vi.fn() } as unknown as Parameters<
      typeof executeApiRequest
    >[0]['logger'],
    getBaseURL: () => 'https://api.openai.com/v1',
    ...overrides,
  };
}

describe('OpenAI executeApiRequest separate request/response dump', () => {
  let dumpSDKRequestContextSpy: ReturnType<typeof vi.spyOn>;
  let dumpSDKResponseContextSpy: ReturnType<typeof vi.spyOn>;
  let dumpSDKContextSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dumpSDKRequestContextSpy = vi.spyOn(
      dumpSDKContextModule,
      'dumpSDKRequestContext',
    );
    dumpSDKRequestContextSpy.mockResolvedValue({
      baseId: '20260101-120000-openai-test12',
      requestFilename: '20260101-120000-openai-test12-request.json',
      dumpDir: '/tmp/.llxprt/dumps',
    });

    dumpSDKResponseContextSpy = vi.spyOn(
      dumpSDKContextModule,
      'dumpSDKResponseContext',
    );
    dumpSDKResponseContextSpy.mockResolvedValue(
      '20260101-120000-openai-test12-response.json',
    );

    dumpSDKContextSpy = vi.spyOn(dumpSDKContextModule, 'dumpSDKContext');
    dumpSDKContextSpy.mockResolvedValue('legacy-dump.json');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should dump request before API call and response after in on mode (non-streaming)', async () => {
    const callOrder: string[] = [];

    dumpSDKRequestContextSpy.mockImplementation(async () => {
      callOrder.push('requestDump');
      return {
        baseId: '20260101-120000-openai-test12',
        requestFilename: '20260101-120000-openai-test12-request.json',
        dumpDir: '/tmp/.llxprt/dumps',
      };
    });

    dumpSDKResponseContextSpy.mockImplementation(async () => {
      callOrder.push('responseDump');
      return '20260101-120000-openai-test12-response.json';
    });

    const mockResponse = { id: 'chatcmpl-test', choices: [] };
    const client = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(async () => {
            callOrder.push('apiCall');
            return mockResponse;
          }),
        },
      },
    } as unknown as Parameters<typeof executeApiRequest>[0]['client'];

    const opts = createBaseOptions({ client, streamingEnabled: false });
    await executeApiRequest(opts);

    expect(callOrder).toStrictEqual(['requestDump', 'apiCall', 'responseDump']);

    expect(dumpSDKRequestContextSpy).toHaveBeenCalledOnce();
    const [reqProvider, reqEndpoint, , reqBaseURL] =
      dumpSDKRequestContextSpy.mock.calls[0];
    expect(reqProvider).toBe('openai');
    expect(reqEndpoint).toBe('/chat/completions');
    expect(reqBaseURL).toBe('https://api.openai.com/v1');

    expect(dumpSDKResponseContextSpy).toHaveBeenCalledOnce();
    const [respBaseId, respProvider, , respIsError] =
      dumpSDKResponseContextSpy.mock.calls[0];
    expect(respBaseId).toBe('20260101-120000-openai-test12');
    expect(respProvider).toBe('openai');
    expect(respIsError).toBe(false);

    expect(dumpSDKContextSpy).not.toHaveBeenCalled();
  });

  it('should wrap streaming response to capture chunks and dump after stream completes', async () => {
    const chunks = [
      { id: 'chatcmpl-test', choices: [{ delta: { content: 'Hello' } }] },
      { id: 'chatcmpl-test', choices: [{ delta: { content: ' world' } }] },
    ];

    const mockStream = (async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
    })();

    const client = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue(mockStream),
        },
      },
    } as unknown as Parameters<typeof executeApiRequest>[0]['client'];

    const opts = createBaseOptions({ client, streamingEnabled: true });
    const result = await executeApiRequest(opts);

    // Request dump should have been called before stream creation
    expect(dumpSDKRequestContextSpy).toHaveBeenCalledOnce();

    // Response dump should NOT have been called yet - stream hasn't been consumed
    // (wrapStreamWithDump defers the response dump until after stream completes)
    expect(dumpSDKResponseContextSpy).not.toHaveBeenCalled();

    // Consume the stream
    const received: unknown[] = [];
    for await (const chunk of result as AsyncIterable<unknown>) {
      received.push(chunk);
    }

    // All chunks should pass through unchanged
    expect(received).toStrictEqual(chunks);

    expect(dumpSDKResponseContextSpy).toHaveBeenCalledExactlyOnceWith(
      '20260101-120000-openai-test12',
      'openai',
      { streaming: true, chunks, completed: true },
      false,
    );
    expect(dumpSDKContextSpy).not.toHaveBeenCalled();
  });

  it('should pass through all chunks unchanged even when stream errors mid-iteration', async () => {
    const chunks = [
      { id: 'chatcmpl-test', choices: [{ delta: { content: 'partial' } }] },
    ];

    const mockStream = (async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
      throw new Error('Stream interrupted');
    })();

    const client = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue(mockStream),
        },
      },
    } as unknown as Parameters<typeof executeApiRequest>[0]['client'];

    const opts = createBaseOptions({ client, streamingEnabled: true });
    const result = await executeApiRequest(opts);

    const received: unknown[] = [];
    await expect(async () => {
      for await (const chunk of result as AsyncIterable<unknown>) {
        received.push(chunk);
      }
    }).rejects.toThrow('Stream interrupted');

    // All chunks yielded before the error should pass through
    expect(received).toStrictEqual(chunks);

    expect(dumpSDKResponseContextSpy).toHaveBeenCalledExactlyOnceWith(
      '20260101-120000-openai-test12',
      'openai',
      {
        streaming: true,
        chunks,
        error: 'Error: Stream interrupted',
        completed: false,
      },
      true,
    );
  });

  it('should not dump request or response when mode is off', async () => {
    const opts = createBaseOptions({ dumpMode: 'off' });
    await executeApiRequest(opts);

    expect(dumpSDKRequestContextSpy).not.toHaveBeenCalled();
    expect(dumpSDKResponseContextSpy).not.toHaveBeenCalled();
    expect(dumpSDKContextSpy).not.toHaveBeenCalled();
  });

  it('should write separate related request and error response dumps in error mode', async () => {
    const callOrder: string[] = [];

    const client = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(async () => {
            callOrder.push('apiCall');
            throw new Error('Rate limit');
          }),
        },
      },
    } as unknown as Parameters<typeof executeApiRequest>[0]['client'];

    dumpSDKRequestContextSpy.mockImplementation(async () => {
      callOrder.push('errorRequestDump');
      return {
        baseId: '20260101-120000-openai-test12',
        requestFilename: '20260101-120000-openai-test12-request.json',
        dumpDir: '/tmp',
      };
    });
    dumpSDKResponseContextSpy.mockImplementation(async () => {
      callOrder.push('errorResponseDump');
      return '20260101-120000-openai-test12-response.json';
    });

    const opts = createBaseOptions({
      client,
      dumpMode: 'error',
      streamingEnabled: false,
    });

    await expect(executeApiRequest(opts)).rejects.toThrow('Rate limit');

    expect(callOrder).toStrictEqual([
      'apiCall',
      'errorRequestDump',
      'errorResponseDump',
    ]);
    expect(dumpSDKRequestContextSpy).toHaveBeenCalledOnce();
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledWith(
      '20260101-120000-openai-test12',
      'openai',
      { error: 'Rate limit' },
      true,
    );
    expect(dumpSDKContextSpy).not.toHaveBeenCalled();
  });

  it('should write linked error response dump instead of legacy dump in on mode (non-streaming)', async () => {
    const client = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(new Error('Rate limit')),
        },
      },
    } as unknown as Parameters<typeof executeApiRequest>[0]['client'];

    const opts = createBaseOptions({
      client,
      dumpMode: 'on',
      streamingEnabled: false,
    });

    await expect(executeApiRequest(opts)).rejects.toThrow('Rate limit');

    expect(dumpSDKRequestContextSpy).toHaveBeenCalledOnce();
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledOnce();
    const [baseId, provider, responseBody, isError] =
      dumpSDKResponseContextSpy.mock.calls[0];
    expect(baseId).toBe('20260101-120000-openai-test12');
    expect(provider).toBe('openai');
    expect(responseBody).toStrictEqual({ error: 'Rate limit' });
    expect(isError).toBe(true);
    expect(dumpSDKContextSpy).not.toHaveBeenCalled();
  });

  it('should write linked error response dump instead of legacy dump in on mode when streaming request creation fails', async () => {
    const client = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(new Error('Stream setup failed')),
        },
      },
    } as unknown as Parameters<typeof executeApiRequest>[0]['client'];

    const opts = createBaseOptions({
      client,
      dumpMode: 'on',
      streamingEnabled: true,
    });

    await expect(executeApiRequest(opts)).rejects.toThrow(
      'Stream setup failed',
    );

    expect(dumpSDKRequestContextSpy).toHaveBeenCalledOnce();
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledOnce();
    const [baseId, provider, responseBody, isError] =
      dumpSDKResponseContextSpy.mock.calls[0];
    expect(baseId).toBe('20260101-120000-openai-test12');
    expect(provider).toBe('openai');
    expect(responseBody).toStrictEqual({ error: 'Stream setup failed' });
    expect(isError).toBe(true);
    expect(dumpSDKContextSpy).not.toHaveBeenCalled();
  });

  it('should use request-scoped baseURL for streaming Cerebras/Qwen tool error handling', async () => {
    const apiError = new Error(
      '400 Tool is not present in the tools list: lookup_weather',
    );
    const client = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(apiError),
        },
      },
    } as unknown as Parameters<typeof executeApiRequest>[0]['client'];

    const opts = createBaseOptions({
      client,
      dumpMode: 'error',
      baseURL: 'https://api.cerebras.ai/v1',
      getBaseURL: () => 'https://api.openai.com/v1',
      model: 'gpt-4o',
      formattedTools: [
        {
          type: 'function',
          function: {
            name: 'lookup_weather',
            description: 'Look up the weather',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
      streamingEnabled: true,
    });

    await expect(executeApiRequest(opts)).rejects.toThrow(
      'Cerebras/Qwen API bug: Tool not found in list. We sent 1 tools. Known API issue.',
    );

    expect(dumpSDKRequestContextSpy).toHaveBeenCalledExactlyOnceWith(
      'openai',
      '/chat/completions',
      opts.requestBody,
      'https://api.cerebras.ai/v1',
    );
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledOnce();
  });

  it('should write separate error dumps before throwing enhanced Cerebras/Qwen tool errors', async () => {
    const apiError = new Error(
      '400 Tool is not present in the tools list: lookup_weather',
    );
    const client = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(apiError),
        },
      },
    } as unknown as Parameters<typeof executeApiRequest>[0]['client'];

    const opts = createBaseOptions({
      client,
      dumpMode: 'error',
      baseURL: 'https://api.cerebras.ai/v1',
      getBaseURL: () => 'https://api.cerebras.ai/v1',
      model: 'qwen-3-coder-480b',
      formattedTools: [
        {
          type: 'function',
          function: {
            name: 'lookup_weather',
            description: 'Look up the weather',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
      streamingEnabled: false,
    });

    await expect(executeApiRequest(opts)).rejects.toThrow(
      'Cerebras/Qwen API bug: Tool not found in list. We sent 1 tools. Known API issue.',
    );

    expect(dumpSDKRequestContextSpy).toHaveBeenCalledExactlyOnceWith(
      'openai',
      '/chat/completions',
      opts.requestBody,
      'https://api.cerebras.ai/v1',
    );
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledExactlyOnceWith(
      '20260101-120000-openai-test12',
      'openai',
      { error: '400 Tool is not present in the tools list: lookup_weather' },
      true,
    );
    expect(dumpSDKContextSpy).not.toHaveBeenCalled();
  });

  it('should use request-scoped baseURL for non-streaming Cerebras/Qwen tool error handling', async () => {
    const apiError = new Error(
      '400 Tool is not present in the tools list: lookup_weather',
    );
    const client = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(apiError),
        },
      },
    } as unknown as Parameters<typeof executeApiRequest>[0]['client'];

    const opts = createBaseOptions({
      client,
      dumpMode: 'error',
      baseURL: 'https://api.cerebras.ai/v1',
      getBaseURL: () => 'https://api.openai.com/v1',
      model: 'gpt-4o',
      formattedTools: [
        {
          type: 'function',
          function: {
            name: 'lookup_weather',
            description: 'Look up the weather',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
      streamingEnabled: false,
    });

    await expect(executeApiRequest(opts)).rejects.toThrow(
      'Cerebras/Qwen API bug: Tool not found in list. We sent 1 tools. Known API issue.',
    );

    expect(dumpSDKRequestContextSpy).toHaveBeenCalledExactlyOnceWith(
      'openai',
      '/chat/completions',
      opts.requestBody,
      'https://api.cerebras.ai/v1',
    );
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledOnce();
  });

  it('should send API request when request dump fails', async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ id: 'chatcmpl-test', choices: [] });
    const client = {
      chat: { completions: { create } },
    } as unknown as Parameters<typeof executeApiRequest>[0]['client'];
    dumpSDKRequestContextSpy.mockRejectedValueOnce(new Error('disk full'));

    const opts = createBaseOptions({ client, dumpMode: 'on' });

    await expect(executeApiRequest(opts)).resolves.toStrictEqual({
      id: 'chatcmpl-test',
      choices: [],
    });

    expect(create).toHaveBeenCalledOnce();
    expect(dumpSDKResponseContextSpy).not.toHaveBeenCalled();
    expect(opts.logger.debug).toHaveBeenCalled();
  });

  it('should dump streaming iteration errors in error mode after passing through chunks', async () => {
    const chunks = [
      { id: 'chatcmpl-test', choices: [{ delta: { content: 'partial' } }] },
    ];
    const mockStream = (async function* () {
      yield chunks[0];
      throw new Error('Stream iteration failed');
    })();
    const client = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue(mockStream),
        },
      },
    } as unknown as Parameters<typeof executeApiRequest>[0]['client'];
    const opts = createBaseOptions({
      client,
      dumpMode: 'error',
      streamingEnabled: true,
    });

    const result = await executeApiRequest(opts);
    const received: unknown[] = [];
    await expect(async () => {
      for await (const chunk of result as AsyncIterable<unknown>) {
        received.push(chunk);
      }
    }).rejects.toThrow('Stream iteration failed');

    expect(received).toStrictEqual(chunks);
    expect(dumpSDKRequestContextSpy).toHaveBeenCalledOnce();
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledExactlyOnceWith(
      '20260101-120000-openai-test12',
      'openai',
      {
        streaming: true,
        chunks,
        error: 'Error: Stream iteration failed',
        completed: false,
      },
      true,
    );
    expect(dumpSDKContextSpy).not.toHaveBeenCalled();
  });

  it('should not dump on success when mode is error', async () => {
    const opts = createBaseOptions({ dumpMode: 'error' });
    await executeApiRequest(opts);

    expect(dumpSDKRequestContextSpy).not.toHaveBeenCalled();
    expect(dumpSDKResponseContextSpy).not.toHaveBeenCalled();
    expect(dumpSDKContextSpy).not.toHaveBeenCalled();
  });
});
