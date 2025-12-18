/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
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

    expect(parsedBody.reasoning).toEqual({ effort: 'xhigh' });
  });
});
