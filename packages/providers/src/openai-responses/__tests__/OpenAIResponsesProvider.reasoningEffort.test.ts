/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { OpenAIResponsesProvider } from '../OpenAIResponsesProvider.js';
import { toOpenAIResponsesWireEffort } from '../OpenAIResponsesProviderCore.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';

const originalFetch = global.fetch;
const mockFetch = vi.fn();

describe('OpenAIResponsesProvider reasoning.effort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
    global.fetch = mockFetch as unknown as typeof fetch;

    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({
        settingsService: new SettingsService(),
        runtimeId: 'openai-responses-reasoning-effort-test',
      }),
    );
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
    global.fetch = originalFetch;
  });

  it('forwards reasoning.effort=xhigh and strips non-API reasoning keys', async () => {
    const provider = new OpenAIResponsesProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );

    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');

    settings.set('reasoning.effort', 'xhigh');
    settings.set('reasoning.enabled', true);
    settings.set('reasoning.includeInContext', true);
    settings.set('reasoning.includeInResponse', true);
    settings.set('reasoning.format', 'field');
    settings.set('reasoning.stripFromContext', 'none');

    const runtime = createProviderRuntimeContext({
      runtimeId: 'openai-responses-reasoning-runtime',
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

    expect(parsedBody.reasoning).toStrictEqual({ effort: 'xhigh' });
  });

  it('forwards reasoning.effort=max verbatim on the Responses API request path for GPT-5.6', async () => {
    const provider = new OpenAIResponsesProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );
    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.6-sol');
    settings.set('reasoning.effort', 'max');
    settings.set('reasoning.enabled', true);
    const runtime = createProviderRuntimeContext({
      runtimeId: 'openai-responses-max-effort-runtime',
      settingsService: settings,
    });
    let capturedBody: string | undefined;
    let capturedUrl: string | undefined;

    mockFetch.mockImplementation(
      async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        capturedUrl = String(input);
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

    expect(capturedUrl).toBeDefined();
    expect(capturedUrl).toContain('/responses');
    expect(capturedBody).toBeDefined();
    const parsedBody: unknown = JSON.parse(capturedBody ?? '');
    expect(parsedBody).toMatchObject({
      model: 'gpt-5.6-sol',
      reasoning: { effort: 'max' },
    });
  });

  it('maps project effort=minimal to wire effort=none for GPT-5.6 models @issue:2483', async () => {
    const provider = new OpenAIResponsesProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );
    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.6-sol');
    settings.set('reasoning.effort', 'minimal');
    settings.set('reasoning.enabled', true);
    const runtime = createProviderRuntimeContext({
      runtimeId: 'openai-responses-minimal-5x6-runtime',
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
    const parsedBody: unknown = JSON.parse(capturedBody ?? '');
    expect(parsedBody).toMatchObject({ reasoning: { effort: 'none' } });
  });

  it('preserves effort=minimal for pre-5.6 Responses models @issue:2483', async () => {
    const provider = new OpenAIResponsesProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );
    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'o3');
    settings.set('reasoning.effort', 'minimal');
    settings.set('reasoning.enabled', true);
    const runtime = createProviderRuntimeContext({
      runtimeId: 'openai-responses-minimal-pre5x6-runtime',
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
    const parsedBody: unknown = JSON.parse(capturedBody ?? '');
    expect(parsedBody).toMatchObject({ reasoning: { effort: 'minimal' } });
  });
});

describe('toOpenAIResponsesWireEffort @issue:2483', () => {
  it.each([
    ['gpt-5.6', 'none'],
    ['gpt-5.6-sol', 'none'],
    ['gpt-5.7-terra', 'none'],
    ['gpt-6.0-luna', 'none'],
  ])('maps minimal to none for model %s', (model, expected) => {
    expect(toOpenAIResponsesWireEffort('minimal', model)).toBe(expected);
  });

  it.each(['o3', 'o3-mini', 'gpt-5.5', 'gpt-5.4'])(
    'preserves minimal for pre-5.6 model %s',
    (model) => {
      expect(toOpenAIResponsesWireEffort('minimal', model)).toBe('minimal');
    },
  );

  it.each(['low', 'medium', 'high', 'xhigh', 'max'])(
    'passes through non-minimal effort %s unchanged',
    (effort) => {
      expect(toOpenAIResponsesWireEffort(effort, 'gpt-5.6-sol')).toBe(effort);
    },
  );
});
