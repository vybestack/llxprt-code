/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for OpenAI Responses Provider Codex Mode (Phase 3 of Issue #160)
 * @plan PLAN-20251213-ISSUE160.P03
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
import type { Config } from '../../../config/config.js';

// Helper to build call options for provider with codexToken in metadata
function buildCodexCallOptions(
  provider: OpenAIResponsesProvider,
  overrides: Omit<ProviderCallOptionsInit, 'providerName'> & {
    codexToken?: CodexOAuthToken;
  } = {},
) {
  const { contents = [], codexToken, invocation, ...rest } = overrides;

  // Pass codexToken through invocation metadata if provided
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

// Mock fetch globally with proper restoration
const originalFetch = global.fetch;
const mockFetch = vi.fn();

describe('OpenAIResponsesProvider Codex Mode @plan:PLAN-20251213-ISSUE160.P03', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
    // Install mock fetch before each test
    global.fetch = mockFetch as unknown as typeof fetch;

    // Set up default runtime context
    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({
        settingsService: new SettingsService(),
        runtimeId: 'codex-test',
      }),
    );
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
    // Restore original fetch to prevent test pollution
    global.fetch = originalFetch;
  });

  describe('isCodexMode detection', () => {
    it('should detect Codex mode from baseURL containing chatgpt.com/backend-api/codex', () => {
      const provider = new OpenAIResponsesProvider(
        undefined,
        'https://chatgpt.com/backend-api/codex',
      );

      // Access private method via type assertion for testing
      const isCodexMode = (provider as { isCodexMode(url?: string): boolean })
        .isCodexMode;
      expect(
        isCodexMode.call(provider, 'https://chatgpt.com/backend-api/codex'),
      ).toBe(true);
    });

    it('should NOT be in Codex mode for standard OpenAI URL', () => {
      const provider = new OpenAIResponsesProvider(
        undefined,
        'https://api.openai.com/v1',
      );

      const isCodexMode = (provider as { isCodexMode(url?: string): boolean })
        .isCodexMode;
      expect(isCodexMode.call(provider, 'https://api.openai.com/v1')).toBe(
        false,
      );
    });

    it('should return false when baseURL is undefined', () => {
      const provider = new OpenAIResponsesProvider(undefined, undefined);

      const isCodexMode = (provider as { isCodexMode(url?: string): boolean })
        .isCodexMode;
      expect(isCodexMode.call(provider, undefined)).toBe(false);
    });
  });

  describe('Codex request headers', () => {
    it('should include ChatGPT-Account-ID and originator headers in actual HTTP request', async () => {
      const codexToken: CodexOAuthToken = {
        access_token: 'test-access-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        account_id: 'test-account-id-123',
      };

      // Create mock OAuth manager
      const mockOAuthManager = {
        getOAuthToken: vi.fn().mockResolvedValue(codexToken),
      };

      const provider = new OpenAIResponsesProvider(
        'test-access-token',
        'https://chatgpt.com/backend-api/codex',
        undefined,
        mockOAuthManager as never,
      );

      const settings = new SettingsService();
      settings.set('activeProvider', provider.name);
      settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');

      const config = createRuntimeConfigStub(settings) as Config;
      const runtime = createProviderRuntimeContext({
        runtimeId: 'codex-headers-test',
        settingsService: settings,
        config,
      });

      const invocation = createRuntimeInvocationContext({
        runtime,
        settings,
        providerName: provider.name,
        ephemeralsSnapshot: {},
        metadata: { test: 'codex-headers' },
      });

      let capturedHeaders: Headers | undefined;

      // Mock successful streaming response
      mockFetch.mockImplementation(
        async (
          _input: RequestInfo | URL,
          init?: RequestInit,
        ): Promise<Response> => {
          capturedHeaders = new Headers(init?.headers);

          // Create mock SSE stream
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  'data: {"type":"content.delta","delta":"test"}\n\n',
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
        },
      );

      const options = buildCodexCallOptions(provider, {
        settings,
        config,
        runtime,
        invocation,
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'test' }] },
        ],
      });

      // Consume the generator
      const generator = provider.generateChatCompletion(options);
      const results = [];
      for await (const content of generator) {
        results.push(content);
      }

      // Verify headers were set correctly
      expect(capturedHeaders).toBeDefined();
      expect(capturedHeaders!.get('ChatGPT-Account-ID')).toBe(
        'test-account-id-123',
      );
      expect(capturedHeaders!.get('originator')).toBe('codex_cli_rs');
      expect(capturedHeaders!.get('Authorization')).toBe(
        'Bearer test-access-token',
      );
    });

    it('should NOT add Codex headers when not in Codex mode', async () => {
      const provider = new OpenAIResponsesProvider(
        'test-api-key',
        'https://api.openai.com/v1',
      );

      const settings = new SettingsService();
      settings.set('activeProvider', provider.name);
      settings.setProviderSetting(provider.name, 'model', 'o3-mini');

      const config = createRuntimeConfigStub(settings) as Config;
      const runtime = createProviderRuntimeContext({
        runtimeId: 'non-codex-test',
        settingsService: settings,
        config,
      });

      let capturedHeaders: Headers | undefined;

      mockFetch.mockImplementation(
        async (
          _input: RequestInfo | URL,
          init?: RequestInit,
        ): Promise<Response> => {
          capturedHeaders = new Headers(init?.headers);

          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  'data: {"type":"content.delta","delta":"test"}\n\n',
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
        },
      );

      const options = buildCodexCallOptions(provider, {
        settings,
        config,
        runtime,
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'test' }] },
        ],
      });

      const generator = provider.generateChatCompletion(options);
      const results = [];
      for await (const content of generator) {
        results.push(content);
      }

      expect(capturedHeaders).toBeDefined();
      expect(capturedHeaders!.get('ChatGPT-Account-ID')).toBeNull();
      expect(capturedHeaders!.get('originator')).toBeNull();
      expect(capturedHeaders!.get('Authorization')).toBe('Bearer test-api-key');
    });
  });

  describe('Codex request body', () => {
    it('should add store: false to request body in Codex mode', async () => {
      const codexToken: CodexOAuthToken = {
        access_token: 'test-access-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        account_id: 'test-account-id',
      };

      // Create mock OAuth manager
      const mockOAuthManager = {
        getOAuthToken: vi.fn().mockResolvedValue(codexToken),
      };

      const provider = new OpenAIResponsesProvider(
        'test-access-token',
        'https://chatgpt.com/backend-api/codex',
        undefined,
        mockOAuthManager as never,
      );

      const settings = new SettingsService();
      settings.set('activeProvider', provider.name);
      settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');

      const config = createRuntimeConfigStub(settings) as Config;
      const runtime = createProviderRuntimeContext({
        runtimeId: 'codex-body-test',
        settingsService: settings,
        config,
      });

      const invocation = createRuntimeInvocationContext({
        runtime,
        settings,
        providerName: provider.name,
        ephemeralsSnapshot: {},
        metadata: { test: 'codex-body' },
      });

      let capturedBody: string | undefined;

      mockFetch.mockImplementation(
        async (
          _input: RequestInfo | URL,
          init?: RequestInit,
        ): Promise<Response> => {
          if (init?.body instanceof Blob) {
            capturedBody = await init.body.text();
          }

          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  'data: {"type":"content.delta","delta":"test"}\n\n',
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
        },
      );

      const options = buildCodexCallOptions(provider, {
        settings,
        config,
        runtime,
        invocation,
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'test' }] },
        ],
      });

      const generator = provider.generateChatCompletion(options);
      const results = [];
      for await (const content of generator) {
        results.push(content);
      }

      expect(capturedBody).toBeDefined();
      const parsedBody = JSON.parse(capturedBody!) as {
        store?: boolean;
        stream?: boolean;
      };
      expect(parsedBody.store).toBe(false);
      expect(parsedBody.stream).toBe(true);
    });

    it('should add steering message ahead of user messages in Codex mode', async () => {
      const codexToken: CodexOAuthToken = {
        access_token: 'test-access-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        account_id: 'test-account-id',
      };

      // Create mock OAuth manager
      const mockOAuthManager = {
        getOAuthToken: vi.fn().mockResolvedValue(codexToken),
      };

      const provider = new OpenAIResponsesProvider(
        'test-access-token',
        'https://chatgpt.com/backend-api/codex',
        undefined,
        mockOAuthManager as never,
      );

      const settings = new SettingsService();
      settings.set('activeProvider', provider.name);
      settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');

      const config = createRuntimeConfigStub(settings) as Config;
      const runtime = createProviderRuntimeContext({
        runtimeId: 'codex-system-prompt-test',
        settingsService: settings,
        config,
      });

      const invocation = createRuntimeInvocationContext({
        runtime,
        settings,
        providerName: provider.name,
        ephemeralsSnapshot: {},
        metadata: { test: 'codex-system-prompt' },
      });

      let capturedBody: string | undefined;

      mockFetch.mockImplementation(
        async (
          _input: RequestInfo | URL,
          init?: RequestInit,
        ): Promise<Response> => {
          if (init?.body instanceof Blob) {
            capturedBody = await init.body.text();
          }

          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  'data: {"type":"content.delta","delta":"test"}\n\n',
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
        },
      );

      const options = buildCodexCallOptions(provider, {
        settings,
        config,
        runtime,
        invocation,
        contents: [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'user question' }],
          },
        ],
      });

      const generator = provider.generateChatCompletion(options);
      const results = [];
      for await (const content of generator) {
        results.push(content);
      }

      expect(capturedBody).toBeDefined();
      const parsedBody = JSON.parse(capturedBody!) as {
        input?: Array<{ role: string; content?: string }>;
        instructions?: string;
      };
      expect(parsedBody.input).toBeDefined();
      expect(Array.isArray(parsedBody.input)).toBe(true);

      // Codex mode sets system prompt in instructions field (not as first message)
      expect(parsedBody.instructions).toBeDefined();
      expect(parsedBody.instructions).toContain(
        'coding agent running in the Codex CLI',
      );
      expect(parsedBody.instructions).toContain(
        'terminal-based coding assistant',
      );

      // Steering message should be first input message
      const firstMessage = parsedBody.input![0];
      expect(firstMessage.role).toBe('user');
      expect(firstMessage.content).toContain('# IMPORTANT');
      expect(firstMessage.content).toContain('ignore the system prompt');
      expect(firstMessage.content).toContain('# New System Prompt');
      expect(firstMessage.content).toContain('You are LLxprt Code running');
      expect(firstMessage.content).toContain('# Task');
      expect(parsedBody.input).toHaveLength(2);

      const secondMessage = parsedBody.input![1];
      expect(secondMessage.role).toBe('user');
      expect(secondMessage.content).toBe('user question');
    });

    it('should NOT inject system prompt when not in Codex mode', async () => {
      const provider = new OpenAIResponsesProvider(
        'test-api-key',
        'https://api.openai.com/v1',
      );

      const settings = new SettingsService();
      settings.set('activeProvider', provider.name);
      settings.setProviderSetting(provider.name, 'model', 'o3-mini');

      const config = createRuntimeConfigStub(settings) as Config;
      const runtime = createProviderRuntimeContext({
        runtimeId: 'non-codex-system-test',
        settingsService: settings,
        config,
      });

      let capturedBody: string | undefined;

      mockFetch.mockImplementation(
        async (
          _input: RequestInfo | URL,
          init?: RequestInit,
        ): Promise<Response> => {
          if (init?.body instanceof Blob) {
            capturedBody = await init.body.text();
          }

          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  'data: {"type":"content.delta","delta":"test"}\n\n',
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
        },
      );

      const options = buildCodexCallOptions(provider, {
        settings,
        config,
        runtime,
        contents: [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'user question' }],
          },
        ],
      });

      const generator = provider.generateChatCompletion(options);
      const results = [];
      for await (const content of generator) {
        results.push(content);
      }

      expect(capturedBody).toBeDefined();
      const parsedBody = JSON.parse(capturedBody!) as {
        input?: Array<{ role: string; content?: string }>;
      };

      // First message should be system role (standard OpenAI mode)
      const firstMessage = parsedBody.input![0];
      expect(firstMessage.role).toBe('system');
    });
  });

  describe('Error handling', () => {
    it('should throw error when Codex mode requires account_id but token is missing', async () => {
      const provider = new OpenAIResponsesProvider(
        'test-access-token',
        'https://chatgpt.com/backend-api/codex',
      );

      const settings = new SettingsService();
      settings.set('activeProvider', provider.name);
      settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');

      const config = createRuntimeConfigStub(settings) as Config;
      const runtime = createProviderRuntimeContext({
        runtimeId: 'codex-error-test',
        settingsService: settings,
        config,
      });

      // No codexToken in invocation
      const invocation = createRuntimeInvocationContext({
        runtime,
        settings,
        providerName: provider.name,
        ephemeralsSnapshot: {},
        metadata: { test: 'codex-error' },
      });

      const options = buildCodexCallOptions(provider, {
        settings,
        config,
        runtime,
        invocation,
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'test' }] },
        ],
      });

      const generator = provider.generateChatCompletion(options);

      // Should throw when trying to get account_id
      await expect(async () => {
        for await (const _content of generator) {
          // Should not reach here
        }
      }).rejects.toThrow();
    });
  });
});
