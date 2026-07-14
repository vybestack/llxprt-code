/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as dumpSDKContextModule from '../utils/dumpSDKContext.js';
import {
  executeAnthropicApiCall,
  type ApiExecutionParams,
} from './AnthropicApiExecution.js';

describe('AnthropicApiExecution separate request/response dump', () => {
  let dumpSDKRequestContextSpy: ReturnType<typeof vi.spyOn>;
  let dumpSDKResponseContextSpy: ReturnType<typeof vi.spyOn>;
  let dumpSDKContextSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dumpSDKRequestContextSpy = vi.spyOn(
      dumpSDKContextModule,
      'dumpSDKRequestContext',
    );
    dumpSDKRequestContextSpy.mockResolvedValue({
      baseId: '20260101-120000-anthropic-test12',
      requestFilename: '20260101-120000-anthropic-test12-request.json',
      dumpDir: '/tmp/.llxprt/dumps',
    });

    dumpSDKResponseContextSpy = vi.spyOn(
      dumpSDKContextModule,
      'dumpSDKResponseContext',
    );
    dumpSDKResponseContextSpy.mockResolvedValue(
      '20260101-120000-anthropic-test12-response.json',
    );

    dumpSDKContextSpy = vi.spyOn(dumpSDKContextModule, 'dumpSDKContext');
    dumpSDKContextSpy.mockResolvedValue('legacy-dump.json');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should dump request before API call and response after in on mode (non-streaming)', async () => {
    const callOrder: string[] = [];

    const apiCallFn = vi.fn().mockImplementation(async () => {
      callOrder.push('apiCall');
      return {
        data: {
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hi' }],
          model: 'claude-sonnet-4-5-20250929',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        },
        response: undefined,
      };
    });

    dumpSDKRequestContextSpy.mockImplementation(async () => {
      callOrder.push('requestDump');
      return {
        baseId: '20260101-120000-anthropic-test12',
        requestFilename: '20260101-120000-anthropic-test12-request.json',
        dumpDir: '/tmp/.llxprt/dumps',
      };
    });

    dumpSDKResponseContextSpy.mockImplementation(async () => {
      callOrder.push('responseDump');
      return '20260101-120000-anthropic-test12-response.json';
    });

    const params: ApiExecutionParams = {
      apiCallFn,
      dumpMode: 'on',
      baseURL: 'https://api.anthropic.com',
      requestBody: { model: 'claude-sonnet-4-5-20250929', messages: [] },
      streamingEnabled: false,
      rateLimitLogger: { debug: vi.fn() },
    };

    await executeAnthropicApiCall(params);

    expect(callOrder).toStrictEqual(['requestDump', 'apiCall', 'responseDump']);

    expect(dumpSDKRequestContextSpy).toHaveBeenCalledOnce();
    const [reqProvider, reqEndpoint, reqBody, reqBaseURL] =
      dumpSDKRequestContextSpy.mock.calls[0];
    expect(reqProvider).toBe('anthropic');
    expect(reqEndpoint).toBe('/v1/messages');
    expect(reqBody).toStrictEqual(params.requestBody);
    expect(reqBaseURL).toBe('https://api.anthropic.com');

    expect(dumpSDKResponseContextSpy).toHaveBeenCalledOnce();
    const [respBaseId, respProvider, , respIsError] =
      dumpSDKResponseContextSpy.mock.calls[0];
    expect(respBaseId).toBe('20260101-120000-anthropic-test12');
    expect(respProvider).toBe('anthropic');
    expect(respIsError).toBe(false);

    expect(dumpSDKContextSpy).not.toHaveBeenCalled();
  });

  it('should write separate related request and error response dumps in error mode', async () => {
    const callOrder: string[] = [];

    const apiCallFn = vi.fn().mockImplementation(async () => {
      callOrder.push('apiCall');
      throw new Error('Rate limit exceeded');
    });

    dumpSDKRequestContextSpy.mockImplementation(async () => {
      callOrder.push('errorRequestDump');
      return {
        baseId: '20260101-120000-anthropic-test12',
        requestFilename: '20260101-120000-anthropic-test12-request.json',
        dumpDir: '/tmp',
      };
    });
    dumpSDKResponseContextSpy.mockImplementation(async () => {
      callOrder.push('errorResponseDump');
      return '20260101-120000-anthropic-test12-response.json';
    });

    const params: ApiExecutionParams = {
      apiCallFn,
      dumpMode: 'error',
      baseURL: 'https://api.anthropic.com',
      requestBody: { model: 'claude-sonnet-4-5-20250929', messages: [] },
      streamingEnabled: false,
      rateLimitLogger: { debug: vi.fn() },
    };

    await expect(executeAnthropicApiCall(params)).rejects.toThrow(
      'Rate limit exceeded',
    );

    expect(callOrder).toStrictEqual([
      'apiCall',
      'errorRequestDump',
      'errorResponseDump',
    ]);
    expect(dumpSDKRequestContextSpy).toHaveBeenCalledOnce();
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledWith(
      '20260101-120000-anthropic-test12',
      'anthropic',
      { error: 'Rate limit exceeded' },
      true,
    );
    expect(dumpSDKContextSpy).not.toHaveBeenCalled();
  });

  it('should not dump request or response when mode is off', async () => {
    const apiCallFn = vi.fn().mockResolvedValue({
      data: {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hi' }],
      },
      response: undefined,
    });

    const params: ApiExecutionParams = {
      apiCallFn,
      dumpMode: 'off',
      baseURL: 'https://api.anthropic.com',
      requestBody: { model: 'claude-sonnet-4-5-20250929', messages: [] },
      streamingEnabled: false,
      rateLimitLogger: { debug: vi.fn() },
    };

    await executeAnthropicApiCall(params);

    expect(dumpSDKRequestContextSpy).not.toHaveBeenCalled();
    expect(dumpSDKResponseContextSpy).not.toHaveBeenCalled();
    expect(dumpSDKContextSpy).not.toHaveBeenCalled();
  });

  it('should send API request when request dump fails', async () => {
    const apiCallFn = vi.fn().mockResolvedValue({
      data: { id: 'msg_test', type: 'message', role: 'assistant', content: [] },
      response: undefined,
    });
    const logger = { debug: vi.fn() };
    dumpSDKRequestContextSpy.mockRejectedValueOnce(new Error('disk full'));

    const params: ApiExecutionParams = {
      apiCallFn,
      dumpMode: 'on',
      baseURL: 'https://api.anthropic.com',
      requestBody: { model: 'claude-sonnet-4-5-20250929', messages: [] },
      streamingEnabled: false,
      rateLimitLogger: logger,
    };

    await executeAnthropicApiCall(params);

    expect(apiCallFn).toHaveBeenCalledOnce();
    expect(dumpSDKResponseContextSpy).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalled();
  });

  it('should dump streaming iteration errors in error mode after passing through chunks', async () => {
    const chunks = [{ type: 'message_start', message: { id: 'msg_test' } }];
    const stream = (async function* () {
      yield chunks[0];
      throw new Error('Anthropic stream failed');
    })();
    const apiCallFn = vi.fn().mockResolvedValue({
      data: stream,
      response: undefined,
    });
    const params: ApiExecutionParams = {
      apiCallFn,
      dumpMode: 'error',
      baseURL: 'https://api.anthropic.com',
      requestBody: { model: 'claude-sonnet-4-5-20250929', messages: [] },
      streamingEnabled: true,
      rateLimitLogger: { debug: vi.fn() },
    };

    const result = await executeAnthropicApiCall(params);
    const received: unknown[] = [];
    await expect(async () => {
      for await (const chunk of result.response as AsyncIterable<unknown>) {
        received.push(chunk);
      }
    }).rejects.toThrow('Anthropic stream failed');

    expect(received).toStrictEqual(chunks);
    expect(dumpSDKRequestContextSpy).toHaveBeenCalledOnce();
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledExactlyOnceWith(
      '20260101-120000-anthropic-test12',
      'anthropic',
      {
        streaming: true,
        chunks,
        error: 'Error: Anthropic stream failed',
        completed: false,
      },
      true,
    );
    expect(dumpSDKContextSpy).not.toHaveBeenCalled();
  });

  it('should not dump before success when mode is error and request succeeds', async () => {
    const apiCallFn = vi.fn().mockResolvedValue({
      data: {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hi' }],
      },
      response: undefined,
    });

    const params: ApiExecutionParams = {
      apiCallFn,
      dumpMode: 'error',
      baseURL: 'https://api.anthropic.com',
      requestBody: { model: 'claude-sonnet-4-5-20250929', messages: [] },
      streamingEnabled: false,
      rateLimitLogger: { debug: vi.fn() },
    };

    await executeAnthropicApiCall(params);

    expect(dumpSDKRequestContextSpy).not.toHaveBeenCalled();
    expect(dumpSDKResponseContextSpy).not.toHaveBeenCalled();
    expect(dumpSDKContextSpy).not.toHaveBeenCalled();
  });
});
