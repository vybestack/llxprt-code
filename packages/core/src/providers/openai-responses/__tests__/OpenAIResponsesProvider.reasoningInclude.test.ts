/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * TDD tests for OpenAI Responses API reasoning support via `include` parameter.
 *
 * Issue: GPT-5.2-Codex thinking blocks not visible even with reasoning.includeInResponse=true
 *
 * Root cause: The Codex/Responses API requires `include: ["reasoning.encrypted_content"]`
 * in the request to receive reasoning content back. Without this, no reasoning events
 * are returned even when `reasoning.effort` is set.
 *
 * Key behaviors to test:
 * 1. When reasoning.enabled=true OR reasoning.effort is set, add include parameter
 * 2. The include parameter should be ["reasoning.encrypted_content"]
 * 3. reasoning.enabled should NOT be sent to the API (stripped before request)
 * 4. Parse reasoning events from SSE stream (response.reasoning_text.*, response.output_item.done with type=reasoning)
 * 5. Handle encrypted_content (base64 encoded reasoning) in responses
 * 6. When sending reasoning back in context, include the encrypted_content blob
 *
 * @plan PLAN-20260117-CODEX-REASONING
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '../../../settings/SettingsService.js';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '../../../runtime/providerRuntimeContext.js';
import { OpenAIResponsesProvider } from '../OpenAIResponsesProvider.js';
import { createProviderCallOptions } from '../../../test-utils/providerCallOptions.js';

const originalFetch = global.fetch;
const mockFetch = vi.fn();

describe('OpenAIResponsesProvider reasoning include parameter @plan:PLAN-20260117-CODEX-REASONING', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
    global.fetch = mockFetch as unknown as typeof fetch;

    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({
        settingsService: new SettingsService(),
        runtimeId: 'openai-responses-reasoning-include-test',
      }),
    );
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
    global.fetch = originalFetch;
  });

  describe('include parameter in request', () => {
    it('should add include=["reasoning.encrypted_content"] when reasoning.enabled=true', async () => {
      const provider = new OpenAIResponsesProvider(
        'test-api-key',
        'https://api.openai.com/v1',
      );

      const settings = new SettingsService();
      settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');
      settings.set('reasoning.enabled', true);

      const runtime = createProviderRuntimeContext({
        runtimeId: 'reasoning-include-enabled-test',
        settingsService: settings,
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
        runtime,
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'test' }] },
        ],
      });

      for await (const _content of provider.generateChatCompletion(options)) {
        // Consume generator
      }

      expect(capturedBody).toBeDefined();
      const parsedBody = JSON.parse(capturedBody!) as {
        include?: string[];
      };

      expect(parsedBody.include).toEqual(['reasoning.encrypted_content']);
    });

    it('should add include=["reasoning.encrypted_content"] when reasoning.effort is set (without reasoning.enabled)', async () => {
      const provider = new OpenAIResponsesProvider(
        'test-api-key',
        'https://api.openai.com/v1',
      );

      const settings = new SettingsService();
      settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');
      // Only set effort, not enabled
      settings.set('reasoning.effort', 'high');

      const runtime = createProviderRuntimeContext({
        runtimeId: 'reasoning-include-effort-test',
        settingsService: settings,
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
        runtime,
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'test' }] },
        ],
      });

      for await (const _content of provider.generateChatCompletion(options)) {
        // Consume generator
      }

      expect(capturedBody).toBeDefined();
      const parsedBody = JSON.parse(capturedBody!) as {
        include?: string[];
        reasoning?: { effort?: string };
      };

      expect(parsedBody.include).toEqual(['reasoning.encrypted_content']);
      expect(parsedBody.reasoning?.effort).toBe('high');
    });

    it('should NOT add include parameter when neither reasoning.enabled nor reasoning.effort is set', async () => {
      const provider = new OpenAIResponsesProvider(
        'test-api-key',
        'https://api.openai.com/v1',
      );

      const settings = new SettingsService();
      settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');
      // Don't set any reasoning settings

      const runtime = createProviderRuntimeContext({
        runtimeId: 'reasoning-include-disabled-test',
        settingsService: settings,
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
        runtime,
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'test' }] },
        ],
      });

      for await (const _content of provider.generateChatCompletion(options)) {
        // Consume generator
      }

      expect(capturedBody).toBeDefined();
      const parsedBody = JSON.parse(capturedBody!) as {
        include?: string[];
      };

      // Should not have include parameter when reasoning is not requested
      expect(parsedBody.include).toBeUndefined();
    });

    it('should strip reasoning.enabled from the API request body', async () => {
      const provider = new OpenAIResponsesProvider(
        'test-api-key',
        'https://api.openai.com/v1',
      );

      const settings = new SettingsService();
      settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');
      settings.set('reasoning.enabled', true);
      settings.set('reasoning.effort', 'high');
      settings.set('reasoning.includeInContext', true);
      settings.set('reasoning.includeInResponse', true);

      const runtime = createProviderRuntimeContext({
        runtimeId: 'reasoning-strip-enabled-test',
        settingsService: settings,
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
        runtime,
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'test' }] },
        ],
      });

      for await (const _content of provider.generateChatCompletion(options)) {
        // Consume generator
      }

      expect(capturedBody).toBeDefined();
      const parsedBody = JSON.parse(capturedBody!) as {
        reasoning?: Record<string, unknown>;
      };

      // reasoning.enabled should be stripped (not sent to API)
      expect(parsedBody.reasoning?.enabled).toBeUndefined();
      // reasoning.includeInContext should be stripped
      expect(parsedBody.reasoning?.includeInContext).toBeUndefined();
      // reasoning.includeInResponse should be stripped
      expect(parsedBody.reasoning?.includeInResponse).toBeUndefined();
      // Only effort should remain
      expect(parsedBody.reasoning?.effort).toBe('high');
    });
  });

  describe('parsing reasoning events from SSE stream', () => {
    it('should parse response.output_item.done with type=reasoning and yield ThinkingBlock', async () => {
      const provider = new OpenAIResponsesProvider(
        'test-api-key',
        'https://api.openai.com/v1',
      );

      const settings = new SettingsService();
      settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');
      settings.set('reasoning.enabled', true);

      const runtime = createProviderRuntimeContext({
        runtimeId: 'reasoning-parse-output-item-test',
        settingsService: settings,
      });

      // Base64 encode some reasoning content (simulating encrypted_content)
      const reasoningText = 'Let me think about this problem...';
      const paddedContent = 'x'.repeat(550) + reasoningText; // Add padding like Codex does
      const encryptedContent = Buffer.from(paddedContent).toString('base64');

      mockFetch.mockImplementation(
        async (
          _input: RequestInfo | URL,
          _init?: RequestInit,
        ): Promise<Response> => {
          const encoder = new TextEncoder();
          const sseEvents = [
            `data: {"type":"response.output_item.done","item":{"type":"reasoning","id":"reasoning_1","summary":[{"type":"summary_text","text":"Thinking about the problem"}],"encrypted_content":"${encryptedContent}"}}\n\n`,
            'data: {"type":"response.output_text.delta","delta":"Hello!"}\n\n',
            'data: {"type":"response.completed","response":{"id":"resp_1","usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}}\n\n',
          ];

          const stream = new ReadableStream({
            start(controller) {
              for (const event of sseEvents) {
                controller.enqueue(encoder.encode(event));
              }
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
        runtime,
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'test' }] },
        ],
      });

      const results: Array<{ speaker: string; blocks: unknown[] }> = [];
      for await (const content of provider.generateChatCompletion(options)) {
        results.push(content as { speaker: string; blocks: unknown[] });
      }

      // Should have received a thinking block
      const thinkingContent = results.find((r) =>
        r.blocks.some((b) => (b as { type?: string }).type === 'thinking'),
      );
      expect(thinkingContent).toBeDefined();

      const thinkingBlock = thinkingContent!.blocks.find(
        (b) => (b as { type?: string }).type === 'thinking',
      ) as { type: string; thought: string; encryptedContent?: string };

      expect(thinkingBlock.type).toBe('thinking');
      // The thought should be the summary text (readable version)
      expect(thinkingBlock.thought).toContain('Thinking about the problem');
      // Should preserve encrypted_content for sending back in context
      expect(thinkingBlock.encryptedContent).toBe(encryptedContent);
    });

    it('should parse response.reasoning_summary_text.delta events and accumulate', async () => {
      const provider = new OpenAIResponsesProvider(
        'test-api-key',
        'https://api.openai.com/v1',
      );

      const settings = new SettingsService();
      settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');
      settings.set('reasoning.enabled', true);

      const runtime = createProviderRuntimeContext({
        runtimeId: 'reasoning-parse-summary-delta-test',
        settingsService: settings,
      });

      mockFetch.mockImplementation(
        async (
          _input: RequestInfo | URL,
          _init?: RequestInit,
        ): Promise<Response> => {
          const encoder = new TextEncoder();
          const sseEvents = [
            'data: {"type":"response.reasoning_summary_text.delta","delta":"First part of thinking..."}\n\n',
            'data: {"type":"response.reasoning_summary_text.delta","delta":" Second part..."}\n\n',
            'data: {"type":"response.reasoning_summary_text.done","text":"First part of thinking... Second part..."}\n\n',
            'data: {"type":"response.output_text.delta","delta":"Answer"}\n\n',
            'data: {"type":"response.completed","response":{"id":"resp_1","usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}}\n\n',
          ];

          const stream = new ReadableStream({
            start(controller) {
              for (const event of sseEvents) {
                controller.enqueue(encoder.encode(event));
              }
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
        runtime,
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'test' }] },
        ],
      });

      const results: Array<{ speaker: string; blocks: unknown[] }> = [];
      for await (const content of provider.generateChatCompletion(options)) {
        results.push(content as { speaker: string; blocks: unknown[] });
      }

      const thinkingBlocks = results.flatMap((result) =>
        result.blocks.filter(
          (block): block is { type: 'thinking'; thought: string } =>
            (block as { type?: string }).type === 'thinking',
        ),
      );
      const lastThinkingBlock = thinkingBlocks[thinkingBlocks.length - 1];
      expect(lastThinkingBlock?.thought).toContain('First part of thinking');
      expect(lastThinkingBlock?.thought).toContain('Second part');
    });
  });

  describe('sending reasoning back in context', () => {
    it('should include encrypted_content when sending previous reasoning back to API', async () => {
      const provider = new OpenAIResponsesProvider(
        'test-api-key',
        'https://api.openai.com/v1',
      );

      const settings = new SettingsService();
      settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');
      settings.set('reasoning.enabled', true);
      settings.set('reasoning.includeInContext', true);

      const runtime = createProviderRuntimeContext({
        runtimeId: 'reasoning-context-test',
        settingsService: settings,
      });

      const encryptedContent = Buffer.from(
        'x'.repeat(550) + 'previous reasoning',
      ).toString('base64');

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
        runtime,
        contents: [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'first question' }],
          },
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'thinking',
                thought: 'Let me think about this...',
                encryptedContent,
                sourceField: 'reasoning_content',
              },
              { type: 'text', text: 'Here is my answer' },
            ],
          },
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'follow up question' }],
          },
        ],
      });

      for await (const _content of provider.generateChatCompletion(options)) {
        // Consume generator
      }

      expect(capturedBody).toBeDefined();
      const parsedBody = JSON.parse(capturedBody!) as {
        input?: Array<{
          type?: string;
          encrypted_content?: string;
          summary?: Array<{ type: string; text: string }>;
        }>;
      };

      // Should have a reasoning item in the input with encrypted_content
      const reasoningItem = parsedBody.input?.find(
        (item) => item.type === 'reasoning',
      );
      expect(reasoningItem).toBeDefined();
      expect(reasoningItem?.encrypted_content).toBe(encryptedContent);
    });

    it('should strip reasoning from context when reasoning.includeInContext=false', async () => {
      const provider = new OpenAIResponsesProvider(
        'test-api-key',
        'https://api.openai.com/v1',
      );

      const settings = new SettingsService();
      settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');
      settings.set('reasoning.enabled', true);
      settings.set('reasoning.includeInContext', false);

      const runtime = createProviderRuntimeContext({
        runtimeId: 'reasoning-strip-context-test',
        settingsService: settings,
      });

      const encryptedContent = Buffer.from(
        'x'.repeat(550) + 'previous reasoning',
      ).toString('base64');

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
        runtime,
        contents: [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'first question' }],
          },
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'thinking',
                thought: 'Let me think about this...',
                encryptedContent,
                sourceField: 'reasoning_content',
              },
              { type: 'text', text: 'Here is my answer' },
            ],
          },
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'follow up question' }],
          },
        ],
      });

      for await (const _content of provider.generateChatCompletion(options)) {
        // Consume generator
      }

      expect(capturedBody).toBeDefined();
      const parsedBody = JSON.parse(capturedBody!) as {
        input?: Array<{
          type?: string;
          encrypted_content?: string;
        }>;
      };

      // Should NOT have a reasoning item in the input when includeInContext=false
      const reasoningItem = parsedBody.input?.find(
        (item) => item.type === 'reasoning',
      );
      expect(reasoningItem).toBeUndefined();
    });
  });
});
