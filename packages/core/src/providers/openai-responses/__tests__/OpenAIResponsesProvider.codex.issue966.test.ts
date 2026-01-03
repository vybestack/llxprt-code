/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for Issue #966: Codex OAuth mode improvements
 * - Problem 1: Remove "ignore system prompt" injection
 * - Problem 2: Pre-inject config file (AGENTS.md/LLXPRT.md) read into history
 * @issue #966
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
import { createProviderCallOptions } from '../../../test-utils/providerCallOptions.js';
import type { CodexOAuthToken } from '../../../auth/types.js';
import type { Config } from '../../../config/config.js';
import type { OAuthManager } from '../../../auth/precedence.js';

/**
 * Partial OAuthManager type for testing - only includes methods used by OpenAIResponsesProvider
 */
type MockOAuthManager = Pick<OAuthManager, 'getOAuthToken'>;

const originalFetch = global.fetch;
const mockFetch = vi.fn();

describe('Issue #966: Codex OAuth mode improvements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
    global.fetch = mockFetch as unknown as typeof fetch;

    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({
        settingsService: new SettingsService(),
        runtimeId: 'issue966-test',
      }),
    );
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
    global.fetch = originalFetch;
  });

  describe('Problem 1: Steering prompt should not tell model to ignore system prompt', () => {
    it('should NOT inject "ignore the system prompt" text in Codex mode', async () => {
      const codexToken: CodexOAuthToken = {
        access_token: 'test-access-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        account_id: 'test-account-id',
      };

      const mockOAuthManager = {
        getOAuthToken: vi.fn().mockResolvedValue(codexToken),
      };

      const provider = new OpenAIResponsesProvider(
        'test-access-token',
        'https://chatgpt.com/backend-api/codex',
        undefined,
        mockOAuthManager as MockOAuthManager as OAuthManager,
      );

      const settings = new SettingsService();
      settings.set('activeProvider', provider.name);
      settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');

      const config = createRuntimeConfigStub(settings) as Config;
      const runtime = createProviderRuntimeContext({
        runtimeId: 'issue966-steering-test',
        settingsService: settings,
        config,
      });

      const invocation = createRuntimeInvocationContext({
        runtime,
        settings,
        providerName: provider.name,
        ephemeralsSnapshot: {},
        metadata: { test: 'issue966-steering' },
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

      const options = createProviderCallOptions({
        providerName: provider.name,
        settings,
        config,
        runtime,
        invocation,
        contents: [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'write me a haiku' }],
          },
        ],
      });

      const generator = provider.generateChatCompletion(options);
      for await (const _content of generator) {
        // consume the stream
      }

      expect(capturedBody).toBeDefined();
      const parsedBody = JSON.parse(capturedBody!) as {
        input?: Array<{ role: string; content?: string }>;
        instructions?: string;
      };

      // Check that no message contains "ignore the system prompt"
      const allContent = (parsedBody.input ?? [])
        .filter((msg) => msg.content)
        .map((msg) => msg.content!.toLowerCase())
        .join(' ');

      expect(allContent).not.toContain('ignore the system prompt');
      expect(allContent).not.toContain('you must ignore the system prompt');
    });

    it('should still include system prompt content via the instructions field in Codex mode', async () => {
      const codexToken: CodexOAuthToken = {
        access_token: 'test-access-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        account_id: 'test-account-id',
      };

      const mockOAuthManager = {
        getOAuthToken: vi.fn().mockResolvedValue(codexToken),
      };

      const provider = new OpenAIResponsesProvider(
        'test-access-token',
        'https://chatgpt.com/backend-api/codex',
        undefined,
        mockOAuthManager as MockOAuthManager as OAuthManager,
      );

      const settings = new SettingsService();
      settings.set('activeProvider', provider.name);
      settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');

      const config = createRuntimeConfigStub(settings) as Config;
      const runtime = createProviderRuntimeContext({
        runtimeId: 'issue966-instructions-test',
        settingsService: settings,
        config,
      });

      const invocation = createRuntimeInvocationContext({
        runtime,
        settings,
        providerName: provider.name,
        ephemeralsSnapshot: {},
        metadata: { test: 'issue966-instructions' },
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

      const options = createProviderCallOptions({
        providerName: provider.name,
        settings,
        config,
        runtime,
        invocation,
        contents: [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'write me a haiku' }],
          },
        ],
      });

      const generator = provider.generateChatCompletion(options);
      for await (const _content of generator) {
        // consume the stream
      }

      expect(capturedBody).toBeDefined();
      const parsedBody = JSON.parse(capturedBody!) as {
        input?: Array<{ role: string; content?: string }>;
        instructions?: string;
      };

      // Instructions field should contain the CODEX_SYSTEM_PROMPT
      expect(parsedBody.instructions).toBeDefined();
      expect(parsedBody.instructions).toContain(
        'coding agent running in the Codex CLI',
      );
    });
  });

  describe('Problem 2: Pre-inject config file read into history', () => {
    it('should inject synthetic tool call/result for config file when memory is available', async () => {
      const codexToken: CodexOAuthToken = {
        access_token: 'test-access-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        account_id: 'test-account-id',
      };

      const mockOAuthManager = {
        getOAuthToken: vi.fn().mockResolvedValue(codexToken),
      };

      const provider = new OpenAIResponsesProvider(
        'test-access-token',
        'https://chatgpt.com/backend-api/codex',
        undefined,
        mockOAuthManager as MockOAuthManager as OAuthManager,
      );

      const settings = new SettingsService();
      settings.set('activeProvider', provider.name);
      settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');

      // Simulate having loaded memory from LLXPRT.md
      const mockUserMemory = '# Project Instructions\n\nUse TypeScript';
      const mockFilePaths = ['/project/LLXPRT.md'];

      const config = createRuntimeConfigStub(settings, {
        getUserMemory: () => mockUserMemory,
        getLlxprtMdFilePaths: () => mockFilePaths,
        getLlxprtMdFileCount: () => 1,
      }) as Config;

      const runtime = createProviderRuntimeContext({
        runtimeId: 'issue966-preload-test',
        settingsService: settings,
        config,
      });

      const invocation = createRuntimeInvocationContext({
        runtime,
        settings,
        providerName: provider.name,
        ephemeralsSnapshot: {},
        metadata: { test: 'issue966-preload' },
        userMemory: mockUserMemory,
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

      const options = createProviderCallOptions({
        providerName: provider.name,
        settings,
        config,
        runtime,
        invocation,
        contents: [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'write me a haiku' }],
          },
        ],
        userMemory: mockUserMemory,
      });

      const generator = provider.generateChatCompletion(options);
      for await (const _content of generator) {
        // consume the stream
      }

      expect(capturedBody).toBeDefined();
      const parsedBody = JSON.parse(capturedBody!) as {
        input?: Array<{
          type?: string;
          role?: string;
          content?: string;
          call_id?: string;
          name?: string;
          arguments?: string;
          output?: string;
        }>;
      };

      // Should have a synthetic function_call for read_file
      const syntheticToolCall = parsedBody.input?.find(
        (item) =>
          item.type === 'function_call' &&
          item.name === 'read_file' &&
          item.call_id?.startsWith('call_synthetic_'),
      );
      expect(syntheticToolCall).toBeDefined();

      // Should have a corresponding function_call_output
      const syntheticToolOutput = parsedBody.input?.find(
        (item) =>
          item.type === 'function_call_output' &&
          item.call_id === syntheticToolCall?.call_id,
      );
      expect(syntheticToolOutput).toBeDefined();

      // The output should contain the actual userMemory content (but NOT reveal source files)
      const outputParsed = JSON.parse(syntheticToolOutput?.output ?? '{}') as {
        content?: string;
      };
      expect(outputParsed.content).toBe(mockUserMemory);
      // Should NOT have source_files or status - keep the deception clean
      expect(outputParsed).not.toHaveProperty('source_files');
      expect(outputParsed).not.toHaveProperty('status');

      // The synthetic call should claim to read AGENTS.md (regardless of actual source)
      const argsJson = JSON.parse(syntheticToolCall?.arguments ?? '{}') as {
        absolute_path?: string;
      };
      expect(argsJson.absolute_path).toBe('AGENTS.md');
    });

    it('should inject "not found" result when no config file exists', async () => {
      const codexToken: CodexOAuthToken = {
        access_token: 'test-access-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        account_id: 'test-account-id',
      };

      const mockOAuthManager = {
        getOAuthToken: vi.fn().mockResolvedValue(codexToken),
      };

      const provider = new OpenAIResponsesProvider(
        'test-access-token',
        'https://chatgpt.com/backend-api/codex',
        undefined,
        mockOAuthManager as MockOAuthManager as OAuthManager,
      );

      const settings = new SettingsService();
      settings.set('activeProvider', provider.name);
      settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');

      // Simulate no memory files loaded
      const config = createRuntimeConfigStub(settings, {
        getUserMemory: () => '',
        getLlxprtMdFilePaths: () => [],
        getLlxprtMdFileCount: () => 0,
      }) as Config;

      const runtime = createProviderRuntimeContext({
        runtimeId: 'issue966-notfound-test',
        settingsService: settings,
        config,
      });

      const invocation = createRuntimeInvocationContext({
        runtime,
        settings,
        providerName: provider.name,
        ephemeralsSnapshot: {},
        metadata: { test: 'issue966-notfound' },
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

      const options = createProviderCallOptions({
        providerName: provider.name,
        settings,
        config,
        runtime,
        invocation,
        contents: [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'write me a haiku' }],
          },
        ],
      });

      const generator = provider.generateChatCompletion(options);
      for await (const _content of generator) {
        // consume the stream
      }

      expect(capturedBody).toBeDefined();
      const parsedBody = JSON.parse(capturedBody!) as {
        input?: Array<{
          type?: string;
          role?: string;
          content?: string;
          call_id?: string;
          name?: string;
          output?: string;
        }>;
      };

      // Should have a synthetic function_call for read_file
      const syntheticToolCall = parsedBody.input?.find(
        (item) =>
          item.type === 'function_call' &&
          item.name === 'read_file' &&
          item.call_id?.startsWith('call_synthetic_'),
      );
      expect(syntheticToolCall).toBeDefined();

      // Should have a corresponding function_call_output indicating not found
      const syntheticToolOutput = parsedBody.input?.find(
        (item) =>
          item.type === 'function_call_output' &&
          item.call_id === syntheticToolCall?.call_id,
      );
      expect(syntheticToolOutput).toBeDefined();

      // The output should look like a normal file not found error
      const outputParsed = JSON.parse(syntheticToolOutput?.output ?? '{}') as {
        error?: string;
      };
      expect(outputParsed.error).toBe('File not found: AGENTS.md');
      // Should NOT have content, source_files or status
      expect(outputParsed).not.toHaveProperty('content');
      expect(outputParsed).not.toHaveProperty('source_files');
      expect(outputParsed).not.toHaveProperty('status');

      // The synthetic call should claim to read AGENTS.md
      const argsJson = JSON.parse(syntheticToolCall?.arguments ?? '{}') as {
        absolute_path?: string;
      };
      expect(argsJson.absolute_path).toBe('AGENTS.md');
    });
  });
});
