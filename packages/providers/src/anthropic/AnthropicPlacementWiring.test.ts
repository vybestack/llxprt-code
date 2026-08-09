/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral test (issue #3172): the live Anthropic request path must select
 * system-context placement from the provider's declared capability (resolved
 * through the shared placement policy) based on the RESOLVED token string,
 * never from a local auth flag or the unresolved provider object's shape.
 *
 * Coverage:
 *  - Placement wiring for direct API-key and OAuth strings.
 *  - Runtime-provider parity: deep-compare complete finalized SDK payloads
 *    between direct strings and runtime-provider equivalents.
 *  - Blocker-fix proof: a test provider that declares context-prefix while
 *    auth is API-key — declaration controls placement but does NOT emit the
 *    OAuth-only Claude Code system string.
 *  - Prompt-envelope transport flow: projectPromptEnvelope followed by
 *    generateChatCompletion with the prepared transport token for both token
 *    classes, using rotating values to prove single resolution.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import { AnthropicProvider } from './AnthropicProvider.js';
import Anthropic from '@anthropic-ai/sdk';
import type {
  ResolvedAuthToken,
  RuntimeAuthTokenProvider,
} from '../types/providerRuntime.js';
import type { SystemPromptPlacement } from '../utils/systemPromptPlacement.js';

void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(async () => 'core-prompt'),
}));

void vi.mock('@anthropic-ai/sdk', () => {
  class FakeAnthropic {
    static created: Array<{
      options: Record<string, unknown>;
    }> = [];

    static requests: Array<{
      request: Record<string, unknown>;
    }> = [];

    static reset(): void {
      FakeAnthropic.created = [];
      FakeAnthropic.requests = [];
    }

    readonly options: Record<string, unknown>;
    readonly messages: {
      create: ReturnType<typeof vi.fn>;
    };

    constructor(opts: Record<string, unknown>) {
      this.options = opts;
      FakeAnthropic.created.push({ options: opts });
      this.messages = {
        create: vi.fn(async (request: Record<string, unknown>) => {
          FakeAnthropic.requests.push({ request });
          const req = request as { stream?: boolean };
          if (req.stream === true) {
            return {
              async *[Symbol.asyncIterator]() {
                yield {
                  type: 'content_block_delta',
                  delta: { type: 'text_delta', text: 'ok' },
                };
              },
            };
          }
          return {
            content: [{ type: 'text', text: 'ok' }],
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        }),
      };
    }
  }
  return { default: FakeAnthropic };
});

const FakeAnthropicClass = Anthropic as unknown as {
  created: Array<{ options: Record<string, unknown> }>;
  requests: Array<{ request: Record<string, unknown> }>;
  reset(): void;
};

const OAUTH_SYSTEM_FIELD =
  "You are Claude Code, Anthropic's official CLI for Claude.";
const ASSEMBLED_PROMPT = 'ASSEMBLED_INSTRUCTION';
const API_KEY = 'sk-ant-api03-example-key';
const OAUTH_TOKEN = 'sk-ant-oat01-example-oauth';

class PlacementTestProvider extends AnthropicProvider {
  constructor() {
    super(undefined, 'https://api.anthropic.com', {
      getEphemeralSettings: () => ({}),
    });
  }

  protected override async getAuthTokenForPrompt(): Promise<string> {
    return 'ambient-unused';
  }
}

class ContextPrefixApiKeyProvider extends PlacementTestProvider {
  override getSystemPromptPlacement(): SystemPromptPlacement {
    return 'context-prefix';
  }
}

class SystemFieldOAuthProvider extends PlacementTestProvider {
  override getSystemPromptPlacement(): SystemPromptPlacement {
    return 'system-field';
  }
}

class InvalidPlacementProvider extends PlacementTestProvider {
  override getSystemPromptPlacement(): SystemPromptPlacement {
    return 'invalid-placement' as SystemPromptPlacement;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function textFromBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) {
    return '';
  }
  return blocks
    .filter(isObject)
    .map((block) => (typeof block['text'] === 'string' ? block['text'] : ''))
    .join('');
}

function systemFieldText(system: unknown): string {
  if (typeof system === 'string') {
    return system;
  }
  return textFromBlocks(system);
}

function firstMessageText(messages: unknown): string {
  if (!Array.isArray(messages) || messages.length === 0) {
    return '';
  }
  const first = messages[0];
  if (!isObject(first)) {
    return '';
  }
  const content = first['content'];
  if (typeof content === 'string') {
    return content;
  }
  return textFromBlocks(content);
}

describe('Anthropic system-prompt placement wiring (issue #3172)', () => {
  let settingsService: SettingsService;

  beforeEach(() => {
    FakeAnthropicClass.reset();
    settingsService = new SettingsService();
    settingsService.setProviderSetting('anthropic', 'prompt-caching', 'off');
    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({
        settingsService,
        runtimeId: 'anthropic-placement-wiring-test',
      }),
    );
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  function buildOptions(
    authToken: ResolvedAuthToken,
    systemInstruction = ASSEMBLED_PROMPT,
  ) {
    return createProviderCallOptions({
      providerName: 'anthropic',
      contents: [{ speaker: 'human', blocks: [{ type: 'text', text: 'Hi' }] }],
      settings: settingsService,
      systemInstruction,
      resolved: {
        model: 'claude-opus-5',
        baseURL: 'https://api.anthropic.com',
        authToken,
        telemetry: { providerName: 'anthropic' },
      },
    });
  }

  async function captureWirePayload(
    authToken: ResolvedAuthToken,
  ): Promise<{ system: unknown; messages: unknown }> {
    const provider = new PlacementTestProvider();
    for await (const _chunk of provider.generateChatCompletion(
      buildOptions(authToken),
    )) {
      void _chunk;
    }
    const request = FakeAnthropicClass.requests.at(-1)?.request;
    if (!isObject(request)) {
      throw new Error('Expected an SDK request payload');
    }
    return {
      system: request['system'],
      messages: request['messages'],
    };
  }

  async function exhaustCompletion(
    provider: AnthropicProvider,
    authToken: ResolvedAuthToken,
  ): Promise<void> {
    for await (const _chunk of provider.generateChatCompletion(
      buildOptions(authToken),
    )) {
      void _chunk;
    }
  }

  // -------------------------------------------------------------------------
  // Placement wiring: direct strings
  // -------------------------------------------------------------------------

  it('places the assembled instruction in the system field for a direct API-key string', async () => {
    const { system } = await captureWirePayload(API_KEY);
    expect(systemFieldText(system)).toBe(ASSEMBLED_PROMPT);
  });

  it('reserves the system field and context-prefixes the instruction for a direct OAuth string', async () => {
    const { system, messages } = await captureWirePayload(OAUTH_TOKEN);
    expect(systemFieldText(system)).toBe(OAUTH_SYSTEM_FIELD);
    expect(firstMessageText(messages)).toContain(
      `<system>\n${ASSEMBLED_PROMPT}\n</system>`,
    );
  });

  it('resolves a rotating runtime provider once before API-key placement', async () => {
    const tokens = [API_KEY, OAUTH_TOKEN];
    let callIndex = 0;
    const runtimeProvider: RuntimeAuthTokenProvider = {
      provide: () =>
        Promise.resolve(tokens[Math.min(callIndex++, tokens.length - 1)]),
    };
    const { system } = await captureWirePayload(runtimeProvider);
    expect(systemFieldText(system)).toBe(ASSEMBLED_PROMPT);
    expect(callIndex).toBe(1);
  });

  it('resolves a rotating runtime provider once before OAuth placement', async () => {
    const tokens = [OAUTH_TOKEN, API_KEY];
    let callIndex = 0;
    const runtimeProvider: RuntimeAuthTokenProvider = {
      provide: () =>
        Promise.resolve(tokens[Math.min(callIndex++, tokens.length - 1)]),
    };
    const { system, messages } = await captureWirePayload(runtimeProvider);
    expect(systemFieldText(system)).toBe(OAUTH_SYSTEM_FIELD);
    expect(firstMessageText(messages)).toContain(
      `<system>\n${ASSEMBLED_PROMPT}\n</system>`,
    );
    expect(callIndex).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Deep-compare parity: direct string vs runtime provider
  // -------------------------------------------------------------------------

  it('produces byte-identical SDK payloads for a direct API-key string and a runtime provider resolving to the same key', async () => {
    const direct = await captureWirePayload(API_KEY);
    const runtimeProvider: RuntimeAuthTokenProvider = {
      provide: () => Promise.resolve(API_KEY),
    };
    const runtime = await captureWirePayload(runtimeProvider);
    expect(runtime).toEqual(direct);
  });

  it('produces byte-identical SDK payloads for a direct OAuth string and a runtime provider resolving to the same token', async () => {
    const direct = await captureWirePayload(OAUTH_TOKEN);
    const runtimeProvider: RuntimeAuthTokenProvider = {
      provide: () => Promise.resolve(OAUTH_TOKEN),
    };
    const runtime = await captureWirePayload(runtimeProvider);
    expect(runtime).toEqual(direct);
  });

  // -------------------------------------------------------------------------
  // Blocker-fix: declaration controls placement, not the vendor system string
  // -------------------------------------------------------------------------

  it('context-prefixes the instruction but does NOT emit the OAuth-only Claude Code system string when declaration is context-prefix and auth is API-key', async () => {
    const provider = new ContextPrefixApiKeyProvider();
    for await (const _chunk of provider.generateChatCompletion(
      buildOptions(API_KEY),
    )) {
      void _chunk;
    }
    const request = FakeAnthropicClass.requests.at(-1)?.request;
    if (!isObject(request)) {
      throw new Error('Expected an SDK request payload');
    }
    // Declaration drove placement: prompt is in the context prefix.
    expect(firstMessageText(request['messages'])).toContain(
      `<system>\n${ASSEMBLED_PROMPT}\n</system>`,
    );
    // Auth classification independently controls the vendor system field:
    // API-key auth does NOT emit the OAuth-only Claude Code string.
    expect(request['system']).toBeUndefined();
  });

  it('fails fast before transport when OAuth is declared as system-field', async () => {
    const provider = new SystemFieldOAuthProvider();
    await expect(exhaustCompletion(provider, OAUTH_TOKEN)).rejects.toThrow(
      'OAuth requires context-prefix placement',
    );
    expect(FakeAnthropicClass.requests).toHaveLength(0);
  });

  it('fails fast before transport for an unsupported placement declaration', async () => {
    const provider = new InvalidPlacementProvider();
    await expect(exhaustCompletion(provider, API_KEY)).rejects.toThrow(
      'unsupported placement declaration invalid-placement',
    );
    expect(FakeAnthropicClass.requests).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Prompt-envelope transport: single resolution and exact transport replay
  // -------------------------------------------------------------------------

  it('resolves the API-key runtime provider once and transports the already-prepared exact request', async () => {
    // Rotating values: if provide() is called twice the constructor receives
    // the second value and the deep comparison fails — proving single
    // resolution without mock-call-count.
    const rotatingTokens = [API_KEY, 'sk-ant-api03-SHOULD-NOT-APPEAR'];
    let callIndex = 0;
    const rotatingProvider: RuntimeAuthTokenProvider = {
      provide: () =>
        Promise.resolve(
          rotatingTokens[Math.min(callIndex++, rotatingTokens.length - 1)],
        ),
    };

    const provider = new PlacementTestProvider();
    const options = buildOptions(rotatingProvider);

    // Projection resolves the token but creates no SDK client.
    const requestsBeforeProjection = FakeAnthropicClass.requests.length;
    const projection = await provider.projectPromptEnvelope(options);
    expect(FakeAnthropicClass.requests.length).toBe(requestsBeforeProjection);

    // Transport uses the prepared token without resolving again.
    await provider
      .generateChatCompletion({
        ...options,
        promptEnvelopeTransportToken: projection.transportToken,
      })
      .next();

    // The SDK constructor received the FIRST token, proving provide() ran once.
    const transportOpts = FakeAnthropicClass.created.at(-1)?.options;
    expect(transportOpts?.['apiKey']).toBe(API_KEY);
    expect(callIndex).toBe(1);

    // Deep-compare against the direct-string baseline.
    const transportRequest = FakeAnthropicClass.requests.at(-1)?.request;
    FakeAnthropicClass.reset();
    const baselineProvider = new PlacementTestProvider();
    await baselineProvider.generateChatCompletion(buildOptions(API_KEY)).next();
    const baselineRequest = FakeAnthropicClass.requests.at(-1)?.request;

    expect(isObject(transportRequest)).toBe(true);
    expect(isObject(baselineRequest)).toBe(true);
    expect(transportRequest).toEqual(baselineRequest);
  });

  it('resolves the OAuth runtime provider once and transports the already-prepared exact request', async () => {
    const rotatingTokens = [OAUTH_TOKEN, 'sk-ant-oat01-SHOULD-NOT-APPEAR'];
    let callIndex = 0;
    const rotatingProvider: RuntimeAuthTokenProvider = {
      provide: () =>
        Promise.resolve(
          rotatingTokens[Math.min(callIndex++, rotatingTokens.length - 1)],
        ),
    };

    const provider = new PlacementTestProvider();
    const options = buildOptions(rotatingProvider);

    const requestsBeforeProjection = FakeAnthropicClass.requests.length;
    const projection = await provider.projectPromptEnvelope(options);
    expect(FakeAnthropicClass.requests.length).toBe(requestsBeforeProjection);

    await provider
      .generateChatCompletion({
        ...options,
        promptEnvelopeTransportToken: projection.transportToken,
      })
      .next();

    // The SDK constructor received the FIRST token (OAuth uses authToken).
    const transportOpts = FakeAnthropicClass.created.at(-1)?.options;
    expect(transportOpts?.['authToken']).toBe(OAUTH_TOKEN);
    expect(callIndex).toBe(1);

    // Deep-compare against the direct-string baseline.
    const transportRequest = FakeAnthropicClass.requests.at(-1)?.request;
    FakeAnthropicClass.reset();
    const baselineProvider = new PlacementTestProvider();
    await baselineProvider
      .generateChatCompletion(buildOptions(OAUTH_TOKEN))
      .next();
    const baselineRequest = FakeAnthropicClass.requests.at(-1)?.request;

    expect(isObject(transportRequest)).toBe(true);
    expect(isObject(baselineRequest)).toBe(true);
    expect(transportRequest).toEqual(baselineRequest);
  });
});
