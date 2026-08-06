/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral test: projection and transport must select the same OpenAI
 * transport (Chat vs Responses) when per-call settings differ from ambient
 * settings (issue #2817).
 *
 * The two seams reach their settings by different routes. Projection runs
 * outside the provider's active-call context and therefore passes the
 * per-call `normalized.settings` to `resolveTransport` explicitly. Transport
 * runs inside that context, so `resolveSettingsService()` resolves the same
 * per-call settings from `activeCallContext`. They agree today only because
 * the active-call context is established before transport resolves.
 *
 * This test pins that invariant: it asserts on the URL transport actually
 * requests, so it fails if either seam stops honouring per-call settings —
 * for example if the active-call context were no longer established before
 * transport selection, leaving transport on ambient settings and tripping the
 * protocol-mismatch envelope guard.
 *
 * @requirement:REQ-PE-001 (issue #2817)
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { OpenAIProvider } from '../OpenAIProvider.js';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';

vi.mock('openai', () => ({
  default: class FakeOpenAI {
    readonly chat = {
      completions: { create: vi.fn(async () => ({})) },
    };
    readonly responses = {
      create: vi.fn(async () => ({ output: [] })),
    };
  },
}));

vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(async () => 'core-prompt'),
}));

const BASE_URL = 'https://api.openai.com/v1';

/**
 * Model is chosen so it does NOT auto-select the Responses transport; the
 * explicit `responsesMode` setting is therefore the sole transport selector.
 */
class TransportParityProvider extends OpenAIProvider {
  constructor() {
    super('token-test', BASE_URL);
  }

  protected override async getAuthToken(): Promise<string> {
    return 'token-test';
  }

  protected override async getAuthTokenForPrompt(): Promise<string> {
    return 'token-test';
  }
}

function streamingFetchStub(requestedUrls: string[]): typeof global.fetch {
  return vi.fn(async (input: unknown) => {
    requestedUrls.push(String(input));
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: {"type":"response.completed","response":{"id":"r1","status":"completed"}}\n\n',
            ),
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );
  }) as unknown as typeof global.fetch;
}

describe('OpenAI transport selection parity (issue #2817)', () => {
  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  it('routes both projection and transport to Responses when only per-call settings request it', async () => {
    // Ambient settings resolve no responses mode -> would select Chat.
    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({
        settingsService: new SettingsService(),
        runtimeId: 'openai-transport-parity-test',
      }),
    );

    const provider = new TransportParityProvider();

    // Per-call settings explicitly request the Responses transport.
    const perCallSettings = new SettingsService();
    perCallSettings.setProviderSetting('openai', 'responsesMode', 'responses');

    const options = createProviderCallOptions({
      providerName: 'openai',
      settings: perCallSettings,
      contents: [
        { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
      ],
      resolved: {
        model: 'gpt-4o',
        baseURL: BASE_URL,
        telemetry: { providerName: 'openai' },
      },
    });

    const projection = await provider.projectPromptEnvelope(options);
    expect(projection.protocol).toBe('openai-responses');

    const requestedUrls: string[] = [];
    const originalFetch = global.fetch;
    global.fetch = streamingFetchStub(requestedUrls);
    try {
      for await (const _chunk of provider.generateChatCompletion({
        ...options,
        promptEnvelopeTransportToken: projection.transportToken,
      })) {
        // drain
      }
    } finally {
      global.fetch = originalFetch;
    }

    // Transport must have used the Responses endpoint, matching projection.
    // Reading ambient settings instead would dispatch to /chat/completions.
    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]).toContain('/responses');
    expect(requestedUrls[0]).not.toContain('/chat/completions');
  });
});
