/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIResponsesProvider } from '../OpenAIResponsesProvider.js';
import type { NormalizedGenerateChatOptions } from '../../BaseProvider.js';

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
      getModelBehavior: () => undefined,
    },
    settings: undefined,
    userMemory: undefined,
  };

  return { ...base, ...(overrides ?? {}) } as NormalizedGenerateChatOptions;
}

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('OpenAIResponsesProvider Codex Mode - malformed call ids', () => {
  it('should not emit function_call_output for malformed call ids that cannot match a function_call', async () => {
    const provider = buildProviderWithOAuth();

    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const bodyText =
        init?.body instanceof Blob
          ? await init.body.text()
          : String(init?.body);
      const parsed = JSON.parse(bodyText) as { input: unknown[] };

      const functionCallIds = new Set(
        parsed.input
          .filter((item) => {
            if (item === null || typeof item !== 'object') return false;
            return (item as { type?: unknown }).type === 'function_call';
          })
          .map((item) => (item as { call_id?: unknown }).call_id)
          .filter((id): id is string => typeof id === 'string'),
      );

      const functionCallOutputs = parsed.input.filter((item) => {
        if (item === null || typeof item !== 'object') return false;
        return (item as { type?: unknown }).type === 'function_call_output';
      });

      // Every output must reference an existing function_call call_id
      // (this is the invariant the Codex /responses endpoint enforces).
      for (const output of functionCallOutputs) {
        const callId = (output as { call_id?: unknown }).call_id;
        expect(typeof callId).toBe('string');
        if (!functionCallIds.has(callId as string)) {
          throw new Error(
            `orphan function_call_output: call_id=${String(callId)}; function_calls=[${Array.from(functionCallIds).join(', ')}]`,
          );
        }
      }

      return new Response('', { status: 200 });
    });

    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    // Simulate a corrupted/malformed history item where the tool_response has a
    // callId missing the underscore (matches the reported failure mode).
    const options = buildCodexOptions({
      contents: [
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'hist_tool_good123',
              name: 'run_shell_command',
              parameters: { command: 'echo hi' },
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call3or3EL9f1eJ6fimZIHmJRVG2',
              toolName: 'run_shell_command',
              result: { output: 'cancelled' },
            },
          ],
        },
      ],
    });

    const iterator = (
      provider as unknown as {
        generateChatCompletionWithOptions: (
          options: NormalizedGenerateChatOptions,
        ) => AsyncIterableIterator<unknown>;
      }
    ).generateChatCompletionWithOptions(options);

    await iterator.next();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
