/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @issue #3218 — hooksConfig (llxprt hooks-system config) was leaking into
 * the outbound API request body, causing `400 Unsupported parameter:
 * hooksConfig` from the Codex / OpenAI Responses backend.
 *
 * Root cause: separateSettings() treated unknown settings keys as model
 * params (pass-through). hooksConfig was not registered, so it landed in
 * modelParams and was serialized into the request body.
 *
 * Fix: classify hooksConfig and hooks as INTERNAL_SETTINGS_KEYS so they
 * route to cliSettings, never modelParams.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'bun:test';
import { OpenAIResponsesProvider } from '../OpenAIResponsesProvider.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
  clearActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import type {
  CodexOAuthToken,
  OAuthManager,
} from '@vybestack/llxprt-code-auth';

const originalFetch = global.fetch;
const mockFetch = vi.fn();

function createMockStreamingResponse() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode('data: {"type":"content.delta","delta":"test"}\n\n'),
      );
      controller.enqueue(
        encoder.encode(
          'data: {"type":"response.completed","response":{"id":"r1","status":"completed"}}\n\n',
        ),
      );
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

const MOCK_CODEX_TOKEN: CodexOAuthToken = {
  access_token: 'test-access-token',
  token_type: 'Bearer',
  expiry: Math.floor(Date.now() / 1000) + 3600,
  account_id: 'test-account-id',
};

describe('OpenAIResponsesProvider hooksConfig leak @issue:3218', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
    global.fetch = mockFetch as unknown as typeof fetch;

    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({
        settingsService: new SettingsService(),
        runtimeId: 'test-runtime-id-3218',
      }),
    );
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
    global.fetch = originalFetch;
  });

  async function generateAndCaptureBody(
    provider: OpenAIResponsesProvider,
    settings: SettingsService,
    ephemeralsSnapshot: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let capturedBody: string | undefined;
    mockFetch.mockImplementation(
      async (
        _input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        if (init?.body != null) {
          capturedBody =
            typeof init.body === 'string'
              ? init.body
              : await new Response(init.body).text();
        }
        return createMockStreamingResponse();
      },
    );

    const config = createRuntimeConfigStub(settings);
    const runtime = createProviderRuntimeContext({
      settingsService: settings,
      runtimeId: 'test-runtime-id-3218',
      config,
    });

    const invocation = createRuntimeInvocationContext({
      runtime,
      settings,
      providerName: provider.name,
      ephemeralsSnapshot,
    });

    const options = createProviderCallOptions({
      settings,
      config,
      runtime,
      invocation,
      providerName: provider.name,
      contents: [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'hi' }],
        },
      ],
    });

    const generator = provider.generateChatCompletion(options);
    for await (const _content of generator) {
      // drain
    }

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(capturedBody).toBeDefined();
    return JSON.parse(capturedBody!);
  }

  it('does not send hooksConfig in the Codex request body', async () => {
    const provider = new OpenAIResponsesProvider(
      'test-access-token',
      'https://chatgpt.com/backend-api/codex',
      undefined,
      {
        getOAuthToken: vi.fn().mockResolvedValue(MOCK_CODEX_TOKEN),
      } as unknown as OAuthManager,
    );

    const settings = new SettingsService();
    settings.set('activeProvider', provider.name);
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.6-sol');

    const requestBody = await generateAndCaptureBody(provider, settings, {
      hooksConfig: { enabled: true, notifications: false },
      temperature: 0.7,
    });

    expect(requestBody.hooksConfig).toBeUndefined();
    // Legitimate model params still pass through
    expect(requestBody.temperature).toBe(0.7);
  });

  it('does not send hooks (event definitions) in the Codex request body', async () => {
    const provider = new OpenAIResponsesProvider(
      'test-access-token',
      'https://chatgpt.com/backend-api/codex',
      undefined,
      {
        getOAuthToken: vi.fn().mockResolvedValue(MOCK_CODEX_TOKEN),
      } as unknown as OAuthManager,
    );

    const settings = new SettingsService();
    settings.set('activeProvider', provider.name);
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.6-sol');

    const requestBody = await generateAndCaptureBody(provider, settings, {
      hooks: { beforeModel: [{ command: 'echo hi', type: 'command' }] },
    });

    expect(requestBody.hooks).toBeUndefined();
  });

  it('does not send hooksConfig in a non-Codex Responses request body', async () => {
    const provider = new OpenAIResponsesProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );

    const settings = new SettingsService();
    settings.set('activeProvider', provider.name);
    settings.setProviderSetting(provider.name, 'model', 'o3-mini');

    const requestBody = await generateAndCaptureBody(provider, settings, {
      hooksConfig: { enabled: true },
    });

    expect(requestBody.hooksConfig).toBeUndefined();
  });
});
