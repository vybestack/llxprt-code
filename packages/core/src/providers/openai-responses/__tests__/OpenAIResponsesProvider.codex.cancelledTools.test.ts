/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { OpenAIResponsesProvider } from '../OpenAIResponsesProvider.js';
import type { NormalizedGenerateChatOptions } from '../../BaseProvider.js';

function buildCodexOptions(overrides?: Partial<NormalizedGenerateChatOptions>) {
  const base: NormalizedGenerateChatOptions = {
    contents: [],
    tools: undefined,
    resolved: {
      baseURL: 'https://chatgpt.com/backend-api/codex',
      model: 'gpt-5.2',
      authToken: undefined,
    },
    invocation: {
      metadata: {},
      ephemerals: undefined,
      userMemory: undefined,
    },
    settings: undefined,
    userMemory: undefined,
  };

  return { ...base, ...(overrides ?? {}) } as NormalizedGenerateChatOptions;
}

function buildProviderWithOAuth() {
  const oauthManager = {
    getOAuthToken: vi.fn(async () => ({
      access_token: 'test',
      token_type: 'Bearer',
      expires_in: 3600,
      expiry: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'test-refresh',
      scope: 'openid',
      account_id: 'acct_test_123',
    })),
  };

  return new OpenAIResponsesProvider(
    'test-api-key',
    'https://chatgpt.com/backend-api/codex',
    undefined,
    oauthManager as unknown as object,
  );
}

describe('OpenAIResponsesProvider Codex Mode - cancelled tool calls', () => {
  it('should synthesize tool responses for cancelled tool calls so next request stays valid', async () => {
    const provider = buildProviderWithOAuth();

    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const bodyText =
        init?.body instanceof Blob
          ? await init.body.text()
          : String(init?.body);
      const parsed = JSON.parse(bodyText) as { input: unknown[] };

      // Ensure we are including a function_call_output for the cancelled tool
      const outputs = parsed.input.filter((item) => {
        if (item === null || typeof item !== 'object') return false;
        return (item as { type?: unknown }).type === 'function_call_output';
      });
      expect(outputs.length).toBe(1);

      const output = outputs[0];
      expect(output).toBeTypeOf('object');
      expect((output as { call_id?: unknown }).call_id).toBe('call_abc123');

      // Minimal streaming response body (empty stream is ok for this unit)
      return new Response('', { status: 200 });
    });

    // @ts-expect-error - override global fetch for test
    globalThis.fetch = fetchMock;

    const options = buildCodexOptions({
      contents: [
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'hist_tool_abc123',
              name: 'read_file',
              parameters: { absolute_path: '/tmp/x' },
            },
          ],
        },
        // No tool response block (simulates cancelled execution)
      ],
    });

    const iterator = (
      provider as unknown as {
        generateChatCompletionWithOptions: (
          options: NormalizedGenerateChatOptions,
        ) => AsyncIterableIterator<unknown>;
      }
    ).generateChatCompletionWithOptions(options);
    // Drain one step to trigger request
    await iterator.next();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
