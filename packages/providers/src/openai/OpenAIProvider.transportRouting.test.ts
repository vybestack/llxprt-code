/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests proving that OpenAIProvider routes GPT-5.6+ to the
 * Responses API (/responses) and GPT-5.5 and earlier to Chat Completions
 * (/chat/completions) — fixing the core defect in issue #2483 where the
 * classifier was UI-only.
 *
 * These tests intercept `fetch` at the HTTP boundary so no real network
 * calls are made. Both code paths converge on `global.fetch`:
 *  - The Responses path (`openAIResponsesExecutor`) calls `fetch` directly.
 *  - The Chat Completions path uses the OpenAI SDK client, which defaults
 *    to `global.fetch`.
 *
 * Each test verifies the actual URL the provider calls, proving that the
 * execution-path transport decision matches the shared policy in
 * `openaiModelPolicy.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { OpenAIProvider } from './OpenAIProvider.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';

const originalFetch = global.fetch;

function makeSseResponse(): Response {
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
}

function makeChatCompletionResponse(): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const chunk = JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        choices: [
          {
            delta: { content: '' },
            index: 0,
            finish_reason: 'stop',
          },
        ],
      });
      controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('OpenAIProvider transport routing @issue:2483', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({
        settingsService: new SettingsService(),
        runtimeId: 'openai-transport-routing-test',
      }),
    );
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
    global.fetch = originalFetch;
  });

  it('routes GPT-5.6 to the /responses endpoint on canonical OpenAI', async () => {
    const provider = new OpenAIProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );
    const settings = new SettingsService();
    settings.setProviderSetting('openai', 'model', 'gpt-5.6');
    const runtime = createProviderRuntimeContext({
      runtimeId: 'openai-gpt56-responses-runtime',
      settingsService: settings,
    });

    let capturedUrl: string | undefined;
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return makeSseResponse();
    });

    const options = createProviderCallOptions({
      providerName: 'openai',
      settings,
      runtime,
      resolved: {
        model: 'gpt-5.6',
        baseURL: 'https://api.openai.com/v1',
        authToken: 'test-api-key',
      },
      contents: [{ speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] }],
    });

    for await (const _ of provider.generateChatCompletion(options)) {
      void _;
    }

    expect(capturedUrl).toBeDefined();
    expect(capturedUrl).toContain('/responses');
    expect(capturedUrl).not.toContain('/chat/completions');
  });

  it('routes GPT-5.6-sol to the /responses endpoint on canonical OpenAI', async () => {
    const provider = new OpenAIProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );
    const settings = new SettingsService();
    settings.setProviderSetting('openai', 'model', 'gpt-5.6-sol');
    const runtime = createProviderRuntimeContext({
      runtimeId: 'openai-gpt56-sol-responses-runtime',
      settingsService: settings,
    });

    let capturedUrl: string | undefined;
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return makeSseResponse();
    });

    const options = createProviderCallOptions({
      providerName: 'openai',
      settings,
      runtime,
      resolved: {
        model: 'gpt-5.6-sol',
        baseURL: 'https://api.openai.com/v1',
        authToken: 'test-api-key',
      },
      contents: [{ speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] }],
    });

    for await (const _ of provider.generateChatCompletion(options)) {
      void _;
    }

    expect(capturedUrl).toBeDefined();
    expect(capturedUrl).toContain('/responses');
    expect(capturedUrl).not.toContain('/chat/completions');
  });

  it('keeps GPT-5.5 on the /chat/completions endpoint', async () => {
    const provider = new OpenAIProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );
    const settings = new SettingsService();
    settings.setProviderSetting('openai', 'model', 'gpt-5.5');
    const runtime = createProviderRuntimeContext({
      runtimeId: 'openai-gpt55-chat-runtime',
      settingsService: settings,
    });

    let capturedUrl: string | undefined;
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return makeChatCompletionResponse();
    });

    const options = createProviderCallOptions({
      providerName: 'openai',
      settings,
      runtime,
      resolved: {
        model: 'gpt-5.5',
        baseURL: 'https://api.openai.com/v1',
        authToken: 'test-api-key',
      },
      contents: [{ speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] }],
    });

    for await (const _ of provider.generateChatCompletion(options)) {
      void _;
    }

    expect(capturedUrl).toBeDefined();
    expect(capturedUrl).toContain('/chat/completions');
    expect(capturedUrl).not.toContain('/responses');
  });

  it('keeps GPT-5.6 on Chat Completions when using a custom OpenAI-compatible base URL', async () => {
    const provider = new OpenAIProvider(
      'test-api-key',
      'https://custom.openai-proxy.com/v1',
    );
    const settings = new SettingsService();
    settings.setProviderSetting('openai', 'model', 'gpt-5.6');
    const runtime = createProviderRuntimeContext({
      runtimeId: 'openai-gpt56-custom-url-runtime',
      settingsService: settings,
    });

    let capturedUrl: string | undefined;
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return makeChatCompletionResponse();
    });

    const options = createProviderCallOptions({
      providerName: 'openai',
      settings,
      runtime,
      resolved: {
        model: 'gpt-5.6',
        baseURL: 'https://custom.openai-proxy.com/v1',
        authToken: 'test-api-key',
      },
      contents: [{ speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] }],
    });

    for await (const _ of provider.generateChatCompletion(options)) {
      void _;
    }

    expect(capturedUrl).toBeDefined();
    expect(capturedUrl).toContain('/chat/completions');
    expect(capturedUrl).not.toContain('/responses');
  });

  it('forwards reasoning.effort=max on the Responses request for GPT-5.6', async () => {
    const provider = new OpenAIProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );
    const settings = new SettingsService();
    settings.setProviderSetting('openai', 'model', 'gpt-5.6-sol');
    settings.set('reasoning.effort', 'max');
    settings.set('reasoning.enabled', true);
    const runtime = createProviderRuntimeContext({
      runtimeId: 'openai-gpt56-max-effort-runtime',
      settingsService: settings,
    });

    let capturedBody: string | undefined;
    mockFetch.mockImplementation(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.body instanceof Blob) {
          capturedBody = await init.body.text();
        }
        return makeSseResponse();
      },
    );

    const options = createProviderCallOptions({
      providerName: 'openai',
      settings,
      runtime,
      resolved: {
        model: 'gpt-5.6-sol',
        baseURL: 'https://api.openai.com/v1',
        authToken: 'test-api-key',
      },
      contents: [{ speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] }],
    });

    for await (const _ of provider.generateChatCompletion(options)) {
      void _;
    }

    expect(capturedBody).toBeDefined();
    const parsed: unknown = JSON.parse(capturedBody ?? '');
    expect(parsed).toMatchObject({ reasoning: { effort: 'max' } });
  });

  it('maps reasoning.effort=minimal to wire effort=none for GPT-5.6 on the Responses path', async () => {
    const provider = new OpenAIProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );
    const settings = new SettingsService();
    settings.setProviderSetting('openai', 'model', 'gpt-5.6-sol');
    settings.set('reasoning.effort', 'minimal');
    settings.set('reasoning.enabled', true);
    const runtime = createProviderRuntimeContext({
      runtimeId: 'openai-gpt56-minimal-effort-runtime',
      settingsService: settings,
    });

    let capturedBody: string | undefined;
    mockFetch.mockImplementation(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.body instanceof Blob) {
          capturedBody = await init.body.text();
        }
        return makeSseResponse();
      },
    );

    const options = createProviderCallOptions({
      providerName: 'openai',
      settings,
      runtime,
      resolved: {
        model: 'gpt-5.6-sol',
        baseURL: 'https://api.openai.com/v1',
        authToken: 'test-api-key',
      },
      contents: [{ speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] }],
    });

    for await (const _ of provider.generateChatCompletion(options)) {
      void _;
    }

    expect(capturedBody).toBeDefined();
    const parsed: unknown = JSON.parse(capturedBody ?? '');
    expect(parsed).toMatchObject({ reasoning: { effort: 'none' } });
  });

  it.each(['gpt-5.6-latest', 'gpt-5.6-20260115', 'gpt-6.0-latest'])(
    'routes bare 5.6+ model %s to the /responses endpoint on canonical OpenAI',
    async (model) => {
      const provider = new OpenAIProvider(
        'test-api-key',
        'https://api.openai.com/v1',
      );
      const settings = new SettingsService();
      settings.setProviderSetting('openai', 'model', model);
      const runtime = createProviderRuntimeContext({
        runtimeId: `openai-${model}-responses-runtime`,
        settingsService: settings,
      });

      let capturedUrl: string | undefined;
      mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
        capturedUrl = String(input);
        return makeSseResponse();
      });

      const options = createProviderCallOptions({
        providerName: 'openai',
        settings,
        runtime,
        resolved: {
          model,
          baseURL: 'https://api.openai.com/v1',
          authToken: 'test-api-key',
        },
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] },
        ],
      });

      for await (const _ of provider.generateChatCompletion(options)) {
        void _;
      }

      expect(capturedUrl).toBeDefined();
      expect(capturedUrl).toContain('/responses');
      expect(capturedUrl).not.toContain('/chat/completions');
    },
  );

  it.each(['gpt-5.6-mini', 'gpt-5.6-preview', 'gpt-5.6-solar'])(
    'keeps lookalike %s on /chat/completions (no minimal→none mapping)',
    async (model) => {
      const provider = new OpenAIProvider(
        'test-api-key',
        'https://api.openai.com/v1',
      );
      const settings = new SettingsService();
      settings.setProviderSetting('openai', 'model', model);
      const runtime = createProviderRuntimeContext({
        runtimeId: `openai-${model}-chat-runtime`,
        settingsService: settings,
      });

      let capturedUrl: string | undefined;
      mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
        capturedUrl = String(input);
        return makeChatCompletionResponse();
      });

      const options = createProviderCallOptions({
        providerName: 'openai',
        settings,
        runtime,
        resolved: {
          model,
          baseURL: 'https://api.openai.com/v1',
          authToken: 'test-api-key',
        },
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] },
        ],
      });

      for await (const _ of provider.generateChatCompletion(options)) {
        void _;
      }

      expect(capturedUrl).toBeDefined();
      expect(capturedUrl).toContain('/chat/completions');
      expect(capturedUrl).not.toContain('/responses');
    },
  );

  it('routes gpt-5.5 to /responses when apiMode=responses is explicitly set', async () => {
    const provider = new OpenAIProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );
    const settings = new SettingsService();
    settings.setProviderSetting('openai', 'model', 'gpt-5.5');
    settings.setProviderSetting('openai', 'apiMode', 'responses');
    const runtime = createProviderRuntimeContext({
      runtimeId: 'openai-gpt55-explicit-responses-runtime',
      settingsService: settings,
    });

    let capturedUrl: string | undefined;
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return makeSseResponse();
    });

    const options = createProviderCallOptions({
      providerName: 'openai',
      settings,
      runtime,
      resolved: {
        model: 'gpt-5.5',
        baseURL: 'https://api.openai.com/v1',
        authToken: 'test-api-key',
      },
      contents: [{ speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] }],
    });

    for await (const _ of provider.generateChatCompletion(options)) {
      void _;
    }

    expect(capturedUrl).toBeDefined();
    expect(capturedUrl).toContain('/responses');
  });

  it('routes gpt-5.6 to /responses on custom endpoint when apiMode=responses', async () => {
    const provider = new OpenAIProvider(
      'test-api-key',
      'https://custom.openai-proxy.com/v1',
    );
    const settings = new SettingsService();
    settings.setProviderSetting('openai', 'model', 'gpt-5.6');
    settings.setProviderSetting('openai', 'apiMode', 'responses');
    const runtime = createProviderRuntimeContext({
      runtimeId: 'openai-gpt56-custom-explicit-responses-runtime',
      settingsService: settings,
    });

    let capturedUrl: string | undefined;
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return makeSseResponse();
    });

    const options = createProviderCallOptions({
      providerName: 'openai',
      settings,
      runtime,
      resolved: {
        model: 'gpt-5.6',
        baseURL: 'https://custom.openai-proxy.com/v1',
        authToken: 'test-api-key',
      },
      contents: [{ speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] }],
    });

    for await (const _ of provider.generateChatCompletion(options)) {
      void _;
    }

    expect(capturedUrl).toBeDefined();
    expect(capturedUrl).toContain('/responses');
  });

  it('routes hyphenated date snapshot gpt-5.6-2026-01-15 to /responses', async () => {
    const provider = new OpenAIProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );
    const model = 'gpt-5.6-2026-01-15';
    const settings = new SettingsService();
    settings.setProviderSetting('openai', 'model', model);
    const runtime = createProviderRuntimeContext({
      runtimeId: 'openai-hyphenated-date-runtime',
      settingsService: settings,
    });

    let capturedUrl: string | undefined;
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return makeSseResponse();
    });

    const options = createProviderCallOptions({
      providerName: 'openai',
      settings,
      runtime,
      resolved: {
        model,
        baseURL: 'https://api.openai.com/v1',
        authToken: 'test-api-key',
      },
      contents: [{ speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] }],
    });

    for await (const _ of provider.generateChatCompletion(options)) {
      void _;
    }

    expect(capturedUrl).toBeDefined();
    expect(capturedUrl).toContain('/responses');
  });

  it('uses the current provider setting instead of a stale constructor snapshot', async () => {
    const provider = new OpenAIProvider(
      'test-api-key',
      'https://custom.openai-proxy.com/v1',
      { openaiResponsesEnabled: false },
    );
    const settings = new SettingsService();
    settings.setProviderSetting('openai', 'model', 'gpt-5.6');
    settings.setProviderSetting('openai', 'openaiResponsesEnabled', true);
    const runtime = createProviderRuntimeContext({
      runtimeId: 'openai-runtime-setting-precedence-runtime',
      settingsService: settings,
    });

    let capturedUrl: string | undefined;
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return makeSseResponse();
    });

    const options = createProviderCallOptions({
      providerName: 'openai',
      settings,
      runtime,
      resolved: {
        model: 'gpt-5.6',
        baseURL: 'https://custom.openai-proxy.com/v1',
        authToken: 'test-api-key',
      },
      contents: [{ speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] }],
    });

    for await (const _ of provider.generateChatCompletion(options)) {
      void _;
    }

    expect(capturedUrl).toContain('/responses');
    expect(capturedUrl).not.toContain('/chat/completions');
  });

  it('keeps malformed hyphenated date gpt-5.6-2026-13-01 on /chat/completions', async () => {
    const provider = new OpenAIProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );
    const model = 'gpt-5.6-2026-13-01';
    const settings = new SettingsService();
    settings.setProviderSetting('openai', 'model', model);
    const runtime = createProviderRuntimeContext({
      runtimeId: 'openai-bad-date-runtime',
      settingsService: settings,
    });

    let capturedUrl: string | undefined;
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return makeChatCompletionResponse();
    });

    const options = createProviderCallOptions({
      providerName: 'openai',
      settings,
      runtime,
      resolved: {
        model,
        baseURL: 'https://api.openai.com/v1',
        authToken: 'test-api-key',
      },
      contents: [{ speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] }],
    });

    for await (const _ of provider.generateChatCompletion(options)) {
      void _;
    }

    expect(capturedUrl).toBeDefined();
    expect(capturedUrl).toContain('/chat/completions');
    expect(capturedUrl).not.toContain('/responses');
  });

  describe('transport-selector keys never leak into request body @issue:2483', () => {
    it('omits apiMode/responsesMode/openaiResponsesEnabled from the Responses request body', async () => {
      const provider = new OpenAIProvider(
        'test-api-key',
        'https://api.openai.com/v1',
      );
      const settings = new SettingsService();
      settings.setProviderSetting('openai', 'model', 'gpt-5.6-sol');
      settings.setProviderSetting('openai', 'apiMode', 'responses');
      settings.setProviderSetting('openai', 'responsesMode', 'responses');
      settings.setProviderSetting('openai', 'openaiResponsesEnabled', true);
      settings.set('responses-mode', 'responses');
      settings.set('openaiResponsesEnabled', true);
      const runtime = createProviderRuntimeContext({
        runtimeId: 'openai-selector-leak-responses-runtime',
        settingsService: settings,
      });

      let capturedBody: string | undefined;
      mockFetch.mockImplementation(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          if (init?.body instanceof Blob) {
            capturedBody = await init.body.text();
          }
          return makeSseResponse();
        },
      );

      const options = createProviderCallOptions({
        providerName: 'openai',
        settings,
        runtime,
        resolved: {
          model: 'gpt-5.6-sol',
          baseURL: 'https://api.openai.com/v1',
          authToken: 'test-api-key',
        },
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] },
        ],
      });

      for await (const _ of provider.generateChatCompletion(options)) {
        void _;
      }

      expect(capturedBody).toBeDefined();
      const parsed = JSON.parse(capturedBody ?? '{}') as Record<
        string,
        unknown
      >;
      expect(parsed).not.toHaveProperty('apiMode');
      expect(parsed).not.toHaveProperty('responsesMode');
      expect(parsed).not.toHaveProperty('responses-mode');
      expect(parsed).not.toHaveProperty('openaiResponsesEnabled');
    });

    it('omits apiMode/responsesMode/openaiResponsesEnabled from the Chat Completions request body', async () => {
      const provider = new OpenAIProvider(
        'test-api-key',
        'https://api.openai.com/v1',
      );
      const settings = new SettingsService();
      settings.setProviderSetting('openai', 'model', 'gpt-5.5');
      settings.setProviderSetting('openai', 'apiMode', 'chat');
      settings.setProviderSetting('openai', 'responsesMode', 'chat');
      settings.setProviderSetting('openai', 'openaiResponsesEnabled', true);
      settings.set('responses-mode', 'chat');
      settings.set('openaiResponsesEnabled', true);
      const runtime = createProviderRuntimeContext({
        runtimeId: 'openai-selector-leak-chat-runtime',
        settingsService: settings,
      });

      let capturedBody: string | undefined;
      mockFetch.mockImplementation(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          if (init?.body !== undefined && init.body !== null) {
            capturedBody =
              typeof init.body === 'string'
                ? init.body
                : await new Blob([init.body]).text();
          }
          return makeChatCompletionResponse();
        },
      );

      const options = createProviderCallOptions({
        providerName: 'openai',
        settings,
        runtime,
        resolved: {
          model: 'gpt-5.5',
          baseURL: 'https://api.openai.com/v1',
          authToken: 'test-api-key',
        },
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] },
        ],
      });

      for await (const _ of provider.generateChatCompletion(options)) {
        void _;
      }

      // The SDK sends body as a string for Chat Completions
      expect(capturedBody).toBeDefined();
      const parsed = JSON.parse(capturedBody ?? '{}') as Record<
        string,
        unknown
      >;
      expect(parsed).not.toHaveProperty('apiMode');
      expect(parsed).not.toHaveProperty('responsesMode');
      expect(parsed).not.toHaveProperty('responses-mode');
      expect(parsed).not.toHaveProperty('openaiResponsesEnabled');
    });

    it('proves explicit apiMode=responses selects the /responses endpoint while selector is absent from body', async () => {
      const provider = new OpenAIProvider(
        'test-api-key',
        'https://api.openai.com/v1',
      );
      const settings = new SettingsService();
      settings.setProviderSetting('openai', 'model', 'gpt-5.5');
      settings.setProviderSetting('openai', 'apiMode', 'responses');
      const runtime = createProviderRuntimeContext({
        runtimeId: 'openai-selector-endpoint-proof-runtime',
        settingsService: settings,
      });

      let capturedUrl: string | undefined;
      let capturedBody: string | undefined;
      mockFetch.mockImplementation(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          capturedUrl = String(input);
          if (init?.body instanceof Blob) {
            capturedBody = await init.body.text();
          }
          return makeSseResponse();
        },
      );

      const options = createProviderCallOptions({
        providerName: 'openai',
        settings,
        runtime,
        resolved: {
          model: 'gpt-5.5',
          baseURL: 'https://api.openai.com/v1',
          authToken: 'test-api-key',
        },
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] },
        ],
      });

      for await (const _ of provider.generateChatCompletion(options)) {
        void _;
      }

      // Explicit mode selected the Responses endpoint
      expect(capturedUrl).toContain('/responses');

      // But the selector key itself is absent from the body
      expect(capturedBody).toBeDefined();
      const parsed = JSON.parse(capturedBody ?? '{}') as Record<
        string,
        unknown
      >;
      expect(parsed).not.toHaveProperty('apiMode');
      expect(parsed).not.toHaveProperty('responsesMode');
    });
  });
});
