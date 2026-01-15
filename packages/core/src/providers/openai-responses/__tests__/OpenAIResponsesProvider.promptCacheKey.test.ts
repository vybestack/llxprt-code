/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for OpenAI Responses Provider prompt_cache_key support (Issue #1145)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { OpenAIResponsesProvider } from '../OpenAIResponsesProvider.js';
import { SettingsService } from '../../../settings/SettingsService.js';
import {
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
  clearActiveProviderRuntimeContext,
} from '../../../runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '../../../runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '../../../test-utils/runtime.js';
import {
  createProviderCallOptions,
  type ProviderCallOptionsInit,
} from '../../../test-utils/providerCallOptions.js';
import type { CodexOAuthToken } from '../../../auth/types.js';

function buildCodexCallOptions(
  provider: OpenAIResponsesProvider,
  overrides: Omit<ProviderCallOptionsInit, 'providerName'> & {
    codexToken?: CodexOAuthToken;
  } = {},
) {
  const { contents = [], codexToken, invocation, ...rest } = overrides;

  const invocationWithToken =
    invocation && codexToken
      ? {
          ...invocation,
          metadata: {
            ...(invocation.metadata ?? {}),
            codexToken,
          },
        }
      : invocation;

  const options = createProviderCallOptions({
    providerName: provider.name,
    contents,
    invocation: invocationWithToken,
    ...rest,
  });

  return options;
}

const originalFetch = global.fetch;
const mockFetch = vi.fn();

function createMockStreamingResponse() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode('data: {"type":"content.delta","delta":"test"}\n\n'),
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

describe('OpenAIResponsesProvider prompt_cache_key @issue:1145', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
    global.fetch = mockFetch as unknown as typeof fetch;

    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({
        settingsService: new SettingsService(),
        runtimeId: 'test-runtime-id-123',
      }),
    );
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
    global.fetch = originalFetch;
  });

  it('should include prompt_cache_key in request body when in Codex mode with runtimeId', async () => {
    const mockCodexToken: CodexOAuthToken = {
      provider: 'codex',
      access_token: 'test-access-token',
      token_type: 'Bearer',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      account_id: 'test-account-id',
    };

    const mockOAuthManager = {
      getOAuthToken: vi.fn().mockResolvedValue(mockCodexToken),
    };

    const provider = new OpenAIResponsesProvider(
      'test-access-token',
      'https://chatgpt.com/backend-api/codex',
      undefined,
      mockOAuthManager as never,
    );

    let capturedBody: string | undefined;
    mockFetch.mockImplementation(
      async (
        _input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        if (init?.body) {
          capturedBody =
            typeof init.body === 'string'
              ? init.body
              : await new Response(init.body).text();
        }
        return createMockStreamingResponse();
      },
    );

    const settings = new SettingsService();
    settings.set('activeProvider', provider.name);
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');

    const config = createRuntimeConfigStub(settings);
    const runtime = createProviderRuntimeContext({
      settingsService: settings,
      runtimeId: 'test-runtime-id-123',
      config,
    });

    const invocation = createRuntimeInvocationContext({
      runtime,
      settings,
      providerName: provider.name,
      ephemeralsSnapshot: {},
    });

    const options = buildCodexCallOptions(provider, {
      settings,
      config,
      runtime,
      invocation,
      contents: [
        { speaker: 'human', blocks: [{ type: 'text', text: 'test message' }] },
      ],
      codexToken: mockCodexToken,
    });

    const generator = provider.generateChatCompletion(options);
    const results = [];
    for await (const content of generator) {
      results.push(content);
    }

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(capturedBody).toBeDefined();
    const requestBody = JSON.parse(capturedBody!);

    expect(requestBody.prompt_cache_key).toBe('test-runtime-id-123');
  });

  it('should include prompt_cache_retention in request body when ephemeral setting is present', async () => {
    const mockCodexToken: CodexOAuthToken = {
      provider: 'codex',
      access_token: 'test-access-token',
      token_type: 'Bearer',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      account_id: 'test-account-id',
    };

    const mockOAuthManager = {
      getOAuthToken: vi.fn().mockResolvedValue(mockCodexToken),
    };

    const provider = new OpenAIResponsesProvider(
      'test-access-token',
      'https://chatgpt.com/backend-api/codex',
      undefined,
      mockOAuthManager as never,
    );

    let capturedBody: string | undefined;
    mockFetch.mockImplementation(
      async (
        _input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        if (init?.body) {
          capturedBody =
            typeof init.body === 'string'
              ? init.body
              : await new Response(init.body).text();
        }
        return createMockStreamingResponse();
      },
    );

    const settings = new SettingsService();
    settings.set('activeProvider', provider.name);
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');

    const config = createRuntimeConfigStub(settings);
    const runtime = createProviderRuntimeContext({
      settingsService: settings,
      runtimeId: 'test-runtime-id-123',
      config,
    });

    const invocation = createRuntimeInvocationContext({
      runtime,
      settings,
      providerName: provider.name,
      ephemeralsSnapshot: {
        prompt_cache_retention: '24h',
      },
    });

    const options = buildCodexCallOptions(provider, {
      settings,
      config,
      runtime,
      invocation,
      contents: [
        { speaker: 'human', blocks: [{ type: 'text', text: 'test message' }] },
      ],
      codexToken: mockCodexToken,
      ephemeralSettings: {
        prompt_cache_retention: '24h',
      },
    });

    const generator = provider.generateChatCompletion(options);
    const results = [];
    for await (const content of generator) {
      results.push(content);
    }

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(capturedBody).toBeDefined();
    const requestBody = JSON.parse(capturedBody!);

    expect(requestBody.prompt_cache_retention).toBe('24h');
  });

  it('should NOT include prompt_cache_key when not in Codex mode', async () => {
    const provider = new OpenAIResponsesProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );

    let capturedBody: string | undefined;
    mockFetch.mockImplementation(
      async (
        _input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        if (init?.body) {
          capturedBody =
            typeof init.body === 'string'
              ? init.body
              : await new Response(init.body).text();
        }
        return createMockStreamingResponse();
      },
    );

    const settings = new SettingsService();
    settings.set('activeProvider', provider.name);
    settings.setProviderSetting(provider.name, 'model', 'gpt-4');

    const config = createRuntimeConfigStub(settings);
    const runtime = createProviderRuntimeContext({
      settingsService: settings,
      runtimeId: 'test-runtime-id-123',
      config,
    });

    const invocation = createRuntimeInvocationContext({
      runtime,
      settings,
      providerName: provider.name,
      ephemeralsSnapshot: {},
    });

    const options = createProviderCallOptions({
      settings,
      config,
      runtime,
      invocation,
      providerName: provider.name,
      contents: [
        { speaker: 'human', blocks: [{ type: 'text', text: 'test message' }] },
      ],
    });

    const generator = provider.generateChatCompletion(options);
    const results = [];
    for await (const content of generator) {
      results.push(content);
    }

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(capturedBody).toBeDefined();
    const requestBody = JSON.parse(capturedBody!);

    expect(requestBody.prompt_cache_key).toBeUndefined();
  });

  it('should allow ephemeral settings to override prompt_cache_key', async () => {
    const mockCodexToken: CodexOAuthToken = {
      provider: 'codex',
      access_token: 'test-access-token',
      token_type: 'Bearer',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      account_id: 'test-account-id',
    };

    const mockOAuthManager = {
      getOAuthToken: vi.fn().mockResolvedValue(mockCodexToken),
    };

    const provider = new OpenAIResponsesProvider(
      'test-access-token',
      'https://chatgpt.com/backend-api/codex',
      undefined,
      mockOAuthManager as never,
    );

    let capturedBody: string | undefined;
    mockFetch.mockImplementation(
      async (
        _input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        if (init?.body) {
          capturedBody =
            typeof init.body === 'string'
              ? init.body
              : await new Response(init.body).text();
        }
        return createMockStreamingResponse();
      },
    );

    const settings = new SettingsService();
    settings.set('activeProvider', provider.name);
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');

    const config = createRuntimeConfigStub(settings);
    const runtime = createProviderRuntimeContext({
      settingsService: settings,
      runtimeId: 'test-runtime-id-123',
      config,
    });

    const invocation = createRuntimeInvocationContext({
      runtime,
      settings,
      providerName: provider.name,
      ephemeralsSnapshot: {
        prompt_cache_key: 'custom-cache-key',
      },
    });

    const options = buildCodexCallOptions(provider, {
      settings,
      config,
      runtime,
      invocation,
      contents: [
        { speaker: 'human', blocks: [{ type: 'text', text: 'test message' }] },
      ],
      codexToken: mockCodexToken,
      ephemeralSettings: {
        prompt_cache_key: 'custom-cache-key',
      },
    });

    const generator = provider.generateChatCompletion(options);
    const results = [];
    for await (const content of generator) {
      results.push(content);
    }

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(capturedBody).toBeDefined();
    const requestBody = JSON.parse(capturedBody!);

    expect(requestBody.prompt_cache_key).toBe('custom-cache-key');
  });

  it('should fallback to runtimeId when ephemeral prompt_cache_key is empty', async () => {
    const mockCodexToken: CodexOAuthToken = {
      provider: 'codex',
      access_token: 'test-access-token',
      token_type: 'Bearer',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      account_id: 'test-account-id',
    };

    const mockOAuthManager = {
      getOAuthToken: vi.fn().mockResolvedValue(mockCodexToken),
    };

    const provider = new OpenAIResponsesProvider(
      'test-access-token',
      'https://chatgpt.com/backend-api/codex',
      undefined,
      mockOAuthManager as never,
    );

    let capturedBody: string | undefined;
    mockFetch.mockImplementation(
      async (
        _input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        if (init?.body) {
          capturedBody =
            typeof init.body === 'string'
              ? init.body
              : await new Response(init.body).text();
        }
        return createMockStreamingResponse();
      },
    );

    const settings = new SettingsService();
    settings.set('activeProvider', provider.name);
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');

    const config = createRuntimeConfigStub(settings);
    const runtime = createProviderRuntimeContext({
      settingsService: settings,
      runtimeId: 'fallback-runtime-id',
      config,
    });

    const invocation = createRuntimeInvocationContext({
      runtime,
      settings,
      providerName: provider.name,
      ephemeralsSnapshot: {
        prompt_cache_key: '',
      },
    });

    const options = buildCodexCallOptions(provider, {
      settings,
      config,
      runtime,
      invocation,
      contents: [
        { speaker: 'human', blocks: [{ type: 'text', text: 'test message' }] },
      ],
      codexToken: mockCodexToken,
      ephemeralSettings: {
        prompt_cache_key: '',
      },
    });

    const generator = provider.generateChatCompletion(options);
    const results = [];
    for await (const content of generator) {
      results.push(content);
    }

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(capturedBody).toBeDefined();
    const requestBody = JSON.parse(capturedBody!);

    expect(requestBody.prompt_cache_key).toBe('fallback-runtime-id');
  });
});
