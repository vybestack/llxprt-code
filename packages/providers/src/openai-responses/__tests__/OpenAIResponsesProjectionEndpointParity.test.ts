/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral test: Responses projection must resolve the SAME effective
 * endpoint transport resolves (issue #2817).
 *
 * `BaseProvider.getBaseURL()` returns the per-call `resolved.baseURL` only
 * while `activeCallContext` is set, and that context is established
 * exclusively inside `generateChatCompletion`. Projection runs outside it, so
 * `resolveResponsesBaseURL`'s fallback reads AMBIENT provider settings during
 * preparation and the per-call value at transport. When a runtime supplies its
 * own `settings` that resolve no endpoint (e.g. a subagent whose parent ran
 * `/baseurl`), preparation and transport disagree and the prepared envelope is
 * rejected by the endpoint drift guard — the send fails outright.
 *
 * @requirement:REQ-PE-001 (issue #2817 acceptance A5)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { OpenAIProvider } from '../../openai/OpenAIProvider.js';
import { OpenAIResponsesProvider } from '../OpenAIResponsesProvider.js';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import type { GenerateChatOptions } from '../../IProvider.js';

vi.mock('openai', () => ({
  default: class FakeOpenAI {
    readonly responses = {
      create: vi.fn(async () => ({ output: [] })),
    };
    readonly chat = {
      completions: { create: vi.fn(async () => ({})) },
    };
  },
}));

vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(async () => 'core-prompt'),
}));

const AMBIENT_BASE_URL = 'https://ambient.example/v1';
const PER_CALL_BASE_URL = 'https://per-call.example/v1';
const CANONICAL_BASE_URL = 'https://api.openai.com/v1';

interface PreparedResponsesEnvelope {
  readonly rawBaseURL: string;
}

class TestOpenAIProvider extends OpenAIProvider {
  constructor() {
    // No configured endpoint: the canonical OpenAI default applies unless a
    // settings service resolves one.
    super('token-test', undefined);
  }

  protected override async getAuthToken(): Promise<string> {
    return 'token-test';
  }

  protected override async getAuthTokenForPrompt(): Promise<string> {
    return 'token-test';
  }

  readPreparedRawBaseURL(transportToken: object): string | undefined {
    const prepared = (
      this as unknown as {
        preparedPromptEnvelopes: {
          get(
            token: object,
          ): { requestContext?: PreparedResponsesEnvelope } | undefined;
        };
      }
    ).preparedPromptEnvelopes.get(transportToken);
    return prepared?.requestContext?.rawBaseURL;
  }
}

class TestResponsesProvider extends OpenAIResponsesProvider {
  constructor() {
    super('token-test', undefined);
  }

  protected override async getAuthToken(): Promise<string> {
    return 'token-test';
  }

  protected override async getAuthTokenForPrompt(): Promise<string> {
    return 'token-test';
  }

  readPreparedRawBaseURL(transportToken: object): string | undefined {
    return (
      this as unknown as {
        preparedPromptEnvelopes: WeakMap<object, PreparedResponsesEnvelope>;
      }
    ).preparedPromptEnvelopes.get(transportToken)?.rawBaseURL;
  }
}

/** Explicit Responses opt-in keeps the protocol decision constant. */
function buildSettings(
  providerName: string,
  baseURL: string | undefined,
): SettingsService {
  const settings = new SettingsService();
  settings.setProviderSetting(providerName, 'responsesMode', 'responses');
  if (baseURL !== undefined) {
    settings.setProviderSetting(providerName, 'base-url', baseURL);
  }
  return settings;
}

function buildChatSettings(
  providerName: string,
  baseURL: string | undefined,
): SettingsService {
  const settings = new SettingsService();
  settings.setProviderSetting(providerName, 'responsesMode', 'chat');
  if (baseURL !== undefined) {
    settings.setProviderSetting(providerName, 'base-url', baseURL);
  }
  return settings;
}

function buildCallOptions(
  providerName: string,
  settings: SettingsService,
): GenerateChatOptions {
  return createProviderCallOptions({
    providerName,
    settings,
    contents: [{ speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] }],
    resolved: {
      model: 'gpt-4o',
      telemetry: { providerName },
    },
  });
}

function streamingFetchStub(requestedUrls: string[]): typeof global.fetch {
  return vi.fn(async (input: unknown) => {
    requestedUrls.push(String(input));
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );
  }) as unknown as typeof global.fetch;
}

async function sendPreparedEnvelope(
  provider: OpenAIProvider | OpenAIResponsesProvider,
  options: GenerateChatOptions,
  transportToken: object,
): Promise<string[]> {
  const requestedUrls: string[] = [];
  const originalFetch = global.fetch;
  global.fetch = streamingFetchStub(requestedUrls);
  try {
    for await (const _chunk of provider.generateChatCompletion({
      ...options,
      promptEnvelopeTransportToken: transportToken,
    })) {
      // drain
    }
  } finally {
    global.fetch = originalFetch;
  }
  return requestedUrls;
}

describe('Responses projection endpoint parity (issue #2817)', () => {
  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  describe('per-call settings resolve no endpoint while ambient settings do', () => {
    beforeEach(() => {
      setActiveProviderRuntimeContext(
        createProviderRuntimeContext({
          settingsService: buildSettings('openai', AMBIENT_BASE_URL),
          runtimeId: 'openai-endpoint-parity-test',
        }),
      );
    });

    it('prepares the canonical endpoint transport will use, not the ambient one', async () => {
      const provider = new TestOpenAIProvider();
      const options = buildCallOptions(
        'openai',
        buildSettings('openai', undefined),
      );

      const projection = await provider.projectPromptEnvelope(options);

      expect(projection.protocol).toBe('openai-responses');
      expect(provider.readPreparedRawBaseURL(projection.transportToken)).toBe(
        CANONICAL_BASE_URL,
      );
    });

    it('selects projection transport from per-call settings', async () => {
      const provider = new TestOpenAIProvider();
      const options = buildCallOptions(
        'openai',
        buildChatSettings('openai', undefined),
      );

      const projection = await provider.projectPromptEnvelope(options);

      expect(projection.protocol).toBe('openai-chat');
    });

    it('sends the prepared envelope without an endpoint drift rejection', async () => {
      const provider = new TestOpenAIProvider();
      const options = buildCallOptions(
        'openai',
        buildSettings('openai', undefined),
      );
      const projection = await provider.projectPromptEnvelope(options);

      const requestedUrls = await sendPreparedEnvelope(
        provider,
        options,
        projection.transportToken,
      );

      expect(requestedUrls).toHaveLength(1);
      expect(requestedUrls[0]).toContain('api.openai.com');
    });
  });

  describe.each([
    { providerName: 'openai', create: () => new TestOpenAIProvider() },
    {
      providerName: 'openai-responses',
      create: () => new TestResponsesProvider(),
    },
  ])('$providerName per-call endpoint override', ({ providerName, create }) => {
    beforeEach(() => {
      setActiveProviderRuntimeContext(
        createProviderRuntimeContext({
          settingsService: buildSettings(providerName, AMBIENT_BASE_URL),
          runtimeId: `${providerName}-endpoint-override-test`,
        }),
      );
    });

    it('prepares and sends the per-call endpoint', async () => {
      const provider = create();
      const options = buildCallOptions(
        providerName,
        buildSettings(providerName, PER_CALL_BASE_URL),
      );

      const projection = await provider.projectPromptEnvelope(options);
      expect(provider.readPreparedRawBaseURL(projection.transportToken)).toBe(
        PER_CALL_BASE_URL,
      );

      const requestedUrls = await sendPreparedEnvelope(
        provider,
        options,
        projection.transportToken,
      );
      expect(requestedUrls).toHaveLength(1);
      expect(requestedUrls[0]).toContain('per-call.example');
    });
  });
});
