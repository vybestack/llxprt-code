/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * TDD tests for OpenAIResponsesProvider reasoning.summary support
 * @issue #922 - GPT-5.2-Codex thinking blocks not visible
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

describe('OpenAIResponsesProvider reasoning.summary @issue:922', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
    global.fetch = mockFetch as unknown as typeof fetch;

    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({
        settingsService: new SettingsService(),
        runtimeId: 'openai-responses-reasoning-summary-test',
      }),
    );
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
    global.fetch = originalFetch;
  });

  it('should include reasoning.summary=auto in request body when set', async () => {
    const provider = new OpenAIResponsesProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );

    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');

    settings.set('reasoning.effort', 'high');
    settings.set('reasoning.summary', 'auto');

    const runtime = createProviderRuntimeContext({
      runtimeId: 'openai-responses-reasoning-summary-runtime',
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

    expect(parsedBody.reasoning).toBeDefined();
    expect(parsedBody.reasoning?.effort).toBe('high');
    expect(parsedBody.reasoning?.summary).toBe('auto');
  });

  it('should include reasoning.summary=concise in request body', async () => {
    const provider = new OpenAIResponsesProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );

    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');

    settings.set('reasoning.effort', 'medium');
    settings.set('reasoning.summary', 'concise');

    const runtime = createProviderRuntimeContext({
      runtimeId: 'openai-responses-reasoning-summary-runtime-2',
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

    expect(parsedBody.reasoning?.summary).toBe('concise');
  });

  it('should include reasoning.summary=detailed in request body', async () => {
    const provider = new OpenAIResponsesProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );

    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');

    settings.set('reasoning.effort', 'high');
    settings.set('reasoning.summary', 'detailed');

    const runtime = createProviderRuntimeContext({
      runtimeId: 'openai-responses-reasoning-summary-runtime-3',
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

    expect(parsedBody.reasoning?.summary).toBe('detailed');
  });

  it('should NOT include reasoning.summary when set to none', async () => {
    const provider = new OpenAIResponsesProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );

    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');

    settings.set('reasoning.effort', 'high');
    settings.set('reasoning.summary', 'none');

    const runtime = createProviderRuntimeContext({
      runtimeId: 'openai-responses-reasoning-summary-runtime-4',
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

    // When summary=none, it should not be included in the request
    expect(parsedBody.reasoning?.effort).toBe('high');
    expect(parsedBody.reasoning?.summary).toBeUndefined();
  });

  it('should NOT include reasoning.summary when not set at all', async () => {
    const provider = new OpenAIResponsesProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );

    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');

    settings.set('reasoning.effort', 'high');
    // Do NOT set reasoning.summary

    const runtime = createProviderRuntimeContext({
      runtimeId: 'openai-responses-reasoning-summary-runtime-5',
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

    // When summary is not set, it should not be in the request
    expect(parsedBody.reasoning?.effort).toBe('high');
    expect(parsedBody.reasoning?.summary).toBeUndefined();
  });
});
