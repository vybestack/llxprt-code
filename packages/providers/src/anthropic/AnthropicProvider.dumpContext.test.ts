/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AnthropicProvider } from './AnthropicProvider.js';
import * as dumpContextModule from '../utils/dumpContext.js';
import * as dumpSDKContextModule from '../utils/dumpSDKContext.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';

describe('AnthropicProvider dumpContext integration', () => {
  let provider: AnthropicProvider;
  let dumpContextSpy: ReturnType<typeof vi.spyOn>;
  let dumpSDKRequestContextSpy: ReturnType<typeof vi.spyOn>;
  let dumpSDKResponseContextSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    provider = new AnthropicProvider('sk-ant-test-key');

    dumpContextSpy = vi.spyOn(dumpContextModule, 'dumpContext');
    dumpContextSpy.mockResolvedValue('test-dump-file.json');

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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should NOT dump context when mode is off', async () => {
    const options: NormalizedGenerateChatOptions = {
      contents: [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ],
      tools: undefined,
      resolved: {
        model: 'claude-sonnet-4-5-20250929',
        authToken: 'sk-ant-test-key',
      },
      settings: new SettingsService(),
      invocation: {
        ephemerals: {
          dumpcontext: 'off',
          streaming: 'disabled',
        },
      },
    };

    // Mock the API call to prevent actual network requests
    vi.spyOn(
      provider as never,
      'buildProviderClient' as never,
    ).mockResolvedValue({
      client: {
        messages: {
          create: vi.fn().mockResolvedValue({
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'Hi' }],
            model: 'claude-sonnet-4-5-20250929',
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        },
      },
      authToken: 'sk-ant-test-key',
    } as never);

    const generator = provider['generateChatCompletionWithOptions'](options);
    const results: unknown[] = [];
    for await (const chunk of generator) {
      results.push(chunk);
    }

    // Should NOT have called dumpContext
    expect(dumpContextSpy).not.toHaveBeenCalled();
  });

  it('should dump context when mode is on', async () => {
    const options: NormalizedGenerateChatOptions = {
      contents: [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ],
      tools: undefined,
      resolved: {
        model: 'claude-sonnet-4-5-20250929',
        authToken: 'sk-ant-test-key',
      },
      settings: new SettingsService(),
      invocation: {
        ephemerals: {
          dumpcontext: 'on',
          streaming: 'disabled',
        },
      },
    };

    // Mock the API call
    vi.spyOn(
      provider as never,
      'buildProviderClient' as never,
    ).mockResolvedValue({
      client: {
        messages: {
          create: vi.fn().mockResolvedValue({
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'Hi' }],
            model: 'claude-sonnet-4-5-20250929',
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        },
      },
      authToken: 'sk-ant-test-key',
    } as never);

    const generator = provider['generateChatCompletionWithOptions'](options);
    const results: unknown[] = [];
    for await (const chunk of generator) {
      results.push(chunk);
    }

    // Should have called separate request and response dumps
    expect(dumpSDKRequestContextSpy).toHaveBeenCalledOnce();
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledOnce();

    const [reqProvider, reqEndpoint] = dumpSDKRequestContextSpy.mock.calls[0];
    expect(reqProvider).toBe('anthropic');
    expect(reqEndpoint).toBe('/v1/messages');

    const [, respProvider, respBody, respIsError] =
      dumpSDKResponseContextSpy.mock.calls[0];
    expect(respProvider).toBe('anthropic');
    expect(respIsError).toBe(false);
    expect(respBody).toBeDefined();
    expect(dumpContextSpy).not.toHaveBeenCalled();
  });

  it('should dump context only on error when mode is error', async () => {
    const options: NormalizedGenerateChatOptions = {
      contents: [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ],
      tools: undefined,
      resolved: {
        model: 'claude-sonnet-4-5-20250929',
        authToken: 'sk-ant-test-key',
      },
      settings: new SettingsService(),
      invocation: {
        ephemerals: {
          dumpcontext: 'error',
          streaming: 'disabled',
        },
      },
    };

    // Mock successful API call
    vi.spyOn(
      provider as never,
      'buildProviderClient' as never,
    ).mockResolvedValue({
      client: {
        messages: {
          create: vi.fn().mockResolvedValue({
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'Hi' }],
            model: 'claude-sonnet-4-5-20250929',
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        },
      },
      authToken: 'sk-ant-test-key',
    } as never);

    const generator = provider['generateChatCompletionWithOptions'](options);
    const results: unknown[] = [];
    for await (const chunk of generator) {
      results.push(chunk);
    }

    // Should NOT have called dumpContext on success
    expect(dumpContextSpy).not.toHaveBeenCalled();
  });

  it('should dump context on error when mode is error', async () => {
    const options: NormalizedGenerateChatOptions = {
      contents: [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ],
      tools: undefined,
      resolved: {
        model: 'claude-sonnet-4-5-20250929',
        authToken: 'sk-ant-test-key',
      },
      settings: new SettingsService(),
      invocation: {
        ephemerals: {
          dumpcontext: 'error',
        },
      },
    };

    // Mock failed API call
    const apiError = new Error('API Error: Rate limit exceeded');
    vi.spyOn(
      provider as never,
      'buildProviderClient' as never,
    ).mockResolvedValue({
      client: {
        messages: {
          create: vi.fn().mockRejectedValue(apiError),
        },
      },
      authToken: 'sk-ant-test-key',
    } as never);

    const generator = provider['generateChatCompletionWithOptions'](options);

    // Expect the error to be thrown
    await expect(async () => {
      for await (const chunk of generator) {
        void chunk;
      }
    }).rejects.toThrow(/API Error/);

    expect(dumpSDKRequestContextSpy).toHaveBeenCalledExactlyOnceWith(
      'anthropic',
      '/v1/messages',
      expect.objectContaining({
        model: 'claude-sonnet-4-5-20250929',
      }),
      'https://api.anthropic.com',
    );
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledExactlyOnceWith(
      '20260101-120000-anthropic-test12',
      'anthropic',
      { error: 'API Error: Rate limit exceeded' },
      true,
    );
    expect(dumpContextSpy).not.toHaveBeenCalled();
  });

  it('should not dump context in provider when mode is now', async () => {
    const options: NormalizedGenerateChatOptions = {
      contents: [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ],
      tools: undefined,
      resolved: {
        model: 'claude-sonnet-4-5-20250929',
        authToken: 'sk-ant-test-key',
      },
      settings: new SettingsService(),
      invocation: {
        ephemerals: {
          dumpcontext: 'now',
          streaming: 'disabled',
        },
      },
      runtime: {
        runtimeId: 'test-runtime',
        setEphemeralSettings: vi.fn(),
      },
    };

    // Mock the API call
    vi.spyOn(
      provider as never,
      'buildProviderClient' as never,
    ).mockResolvedValue({
      client: {
        messages: {
          create: vi.fn().mockResolvedValue({
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'Hi' }],
            model: 'claude-sonnet-4-5-20250929',
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        },
      },
      authToken: 'sk-ant-test-key',
    } as never);

    const generator = provider['generateChatCompletionWithOptions'](options);
    const results: unknown[] = [];
    for await (const chunk of generator) {
      results.push(chunk);
    }

    expect(dumpSDKRequestContextSpy).not.toHaveBeenCalled();
    expect(dumpSDKResponseContextSpy).not.toHaveBeenCalled();
    expect(dumpContextSpy).not.toHaveBeenCalled();
  });
});
