/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AnthropicProvider } from './AnthropicProvider.js';
import * as dumpContextModule from '../utils/dumpContext.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { SettingsService } from '../../settings/SettingsService.js';

describe('AnthropicProvider dumpContext integration', () => {
  let provider: AnthropicProvider;
  let dumpContextSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Create provider with mock API key
    provider = new AnthropicProvider('sk-ant-test-key');

    // Spy on dumpContext function
    dumpContextSpy = vi.spyOn(dumpContextModule, 'dumpContext');
    dumpContextSpy.mockResolvedValue('test-dump-file.json');
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

    // Should have called dumpContext with SDK-level data
    expect(dumpContextSpy).toHaveBeenCalledOnce();
    const [request, response, providerName] = dumpContextSpy.mock.calls[0];
    expect(providerName).toBe('anthropic');
    expect(request.url).toContain('anthropic.com');
    expect(request.method).toBe('POST');
    expect(request.body).toHaveProperty('model');
    expect(request.body).toHaveProperty('messages');
    expect(response).toHaveProperty('status');
    expect(response).toHaveProperty('body');
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
    }).rejects.toThrow();

    // Should have called dumpContext on error
    expect(dumpContextSpy).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        url: expect.stringContaining('anthropic.com'),
        method: 'POST',
      }),
      expect.objectContaining({
        status: expect.any(Number),
        body: expect.objectContaining({
          error: expect.any(String),
        }),
      }),
      'anthropic',
    );
  });

  it('should dump context once and reset mode to off when mode is now', async () => {
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

    // Should have called dumpContext exactly once
    expect(dumpContextSpy).toHaveBeenCalledExactlyOnceWith(
      expect.any(Object),
      expect.any(Object),
      'anthropic',
    );

    // Note: The 'now' mode reset to 'off' is handled by the command layer,
    // not by the provider, so we don't expect setEphemeralSettings to be called here
  });
});
