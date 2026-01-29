/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @issue #922 - Enable reasoning/thinking summaries for Codex models
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

describe('OpenAIResponsesProvider text.verbosity (text.verbosity setting)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
    global.fetch = mockFetch as unknown as typeof fetch;

    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({
        settingsService: new SettingsService(),
        runtimeId: 'openai-responses-text-verbosity-test',
      }),
    );
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
    global.fetch = originalFetch;
  });

  it('should add text.verbosity to request when text.verbosity is set to "low"', async () => {
    const provider = new OpenAIResponsesProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );

    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');
    settings.set('text.verbosity', 'low');

    const runtime = createProviderRuntimeContext({
      runtimeId: 'openai-responses-verbosity-runtime',
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
      text?: { verbosity?: string };
    };

    expect(parsedBody.text).toEqual({ verbosity: 'low' });
  });

  it('should add text.verbosity to request when text.verbosity is set to "medium"', async () => {
    const provider = new OpenAIResponsesProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );

    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');
    settings.set('text.verbosity', 'medium');

    const runtime = createProviderRuntimeContext({
      runtimeId: 'openai-responses-verbosity-runtime-medium',
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
      text?: { verbosity?: string };
    };

    expect(parsedBody.text).toEqual({ verbosity: 'medium' });
  });

  it('should add text.verbosity to request when text.verbosity is set to "high"', async () => {
    const provider = new OpenAIResponsesProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );

    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');
    settings.set('text.verbosity', 'high');

    const runtime = createProviderRuntimeContext({
      runtimeId: 'openai-responses-verbosity-runtime-high',
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
      text?: { verbosity?: string };
    };

    expect(parsedBody.text).toEqual({ verbosity: 'high' });
  });

  it('should NOT add text field when text.verbosity is not set', async () => {
    const provider = new OpenAIResponsesProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );

    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');

    const runtime = createProviderRuntimeContext({
      runtimeId: 'openai-responses-verbosity-runtime-none',
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
      text?: { verbosity?: string };
    };

    expect(parsedBody.text).toBeUndefined();
  });

  it('should normalize uppercase verbosity values to lowercase', async () => {
    const provider = new OpenAIResponsesProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );

    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.2');
    settings.set('text.verbosity', 'HIGH');

    const runtime = createProviderRuntimeContext({
      runtimeId: 'openai-responses-verbosity-runtime-uppercase',
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
      text?: { verbosity?: string };
    };

    expect(parsedBody.text).toEqual({ verbosity: 'high' });
  });
});
