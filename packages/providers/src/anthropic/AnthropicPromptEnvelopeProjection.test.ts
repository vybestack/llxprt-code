/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral test: AnthropicProvider.projectPromptEnvelope must project the
 * SAME finalized request body that transport sends (issue #2817 acceptance A3).
 *
 * This exercises the REAL provider preparation path (prepareAnthropicRequest)
 * through projectPromptEnvelope, proving the estimate reflects history,
 * pending content, system instructions, and tools without rebuilding the
 * payload outside the provider.
 *
 * @requirement:REQ-PE-001 (issue #2817 acceptance A3, A9, A10)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import { AnthropicProvider } from './AnthropicProvider.js';

vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(async () => 'core-prompt'),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class FakeAnthropic {
    readonly messages = {
      create: vi.fn(async () => ({})),
    };
  },
}));

class TestAnthropicProvider extends AnthropicProvider {
  constructor() {
    super(undefined, 'https://api.anthropic.com', {
      getEphemeralSettings: () => ({}),
    });
  }

  protected override async getAuthToken(): Promise<string> {
    return 'token-test';
  }

  protected override async getAuthTokenForPrompt(): Promise<string> {
    return 'token-test';
  }
}

function buildCallOptions(
  provider: AnthropicProvider,
  overrides: Parameters<typeof createProviderCallOptions>[0],
) {
  return createProviderCallOptions({
    providerName: provider.name,
    resolved: {
      model: 'claude-3-5-sonnet-20241022',
      baseURL: 'https://api.anthropic.com',
      telemetry: { providerName: provider.name },
    },
    ...overrides,
  });
}

describe('AnthropicProvider.projectPromptEnvelope (issue #2817 A3)', () => {
  beforeEach(() => {
    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({
        settingsService: new SettingsService(),
        runtimeId: 'anthropic-envelope-test',
      }),
    );
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  it('identifies anthropic-messages protocol, messages/v1 method, and the model', async () => {
    const provider = new TestAnthropicProvider();
    const options = buildCallOptions(provider, {
      contents: [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ],
    });

    const projection = await provider.projectPromptEnvelope(options);

    expect(projection.protocol).toBe('anthropic-messages');
    expect(projection.method).toBe('messages/v1');
    expect(projection.projectionRevision).toBe(2);
    expect(typeof projection.model).toBe('string');
    expect(projection.model.length).toBeGreaterThan(0);
  });

  it('counts more tokens for a larger conversation history', async () => {
    const provider = new TestAnthropicProvider();

    const small = await provider.projectPromptEnvelope(
      buildCallOptions(provider, {
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'Hi' }] },
        ],
      }),
    );
    const large = await provider.projectPromptEnvelope(
      buildCallOptions(provider, {
        contents: [
          {
            speaker: 'human',
            blocks: [
              {
                type: 'text',
                text: 'Please explain in great detail the history of the world.',
              },
            ],
          },
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'text',
                text: 'The history of the world begins with the formation of the planet.',
              },
            ],
          },
        ],
      }),
    );

    const smallTokens = await small.countProjectedTokens();
    const largeTokens = await large.countProjectedTokens();
    expect(largeTokens).toBeGreaterThan(smallTokens);
  });

  it('counts more tokens when tools are declared', async () => {
    const provider = new TestAnthropicProvider();
    const baseContents = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
    ];

    const withoutTools = await provider.projectPromptEnvelope(
      buildCallOptions(provider, { contents: baseContents }),
    );
    const withTools = await provider.projectPromptEnvelope(
      buildCallOptions(provider, {
        contents: baseContents,
        tools: [
          {
            functionDeclarations: [
              {
                name: 'get_weather',
                description: 'Get the weather for a city',
                parametersJsonSchema: {
                  type: 'object',
                  properties: { city: { type: 'string' } },
                },
              },
            ],
          },
        ],
      }),
    );

    const withoutTokens = await withoutTools.countProjectedTokens();
    const withTokens = await withTools.countProjectedTokens();
    expect(withTokens).toBeGreaterThan(withoutTokens);
  });

  it('accepts the un-normalized options the agent send seam actually passes', async () => {
    const provider = new TestAnthropicProvider();

    // The agent send seam (buildProviderChatOptions) supplies config/runtime/
    // settings but NO `resolved` block, and only a malformed `{ signal }`
    // invocation stub. BaseProvider normalizes that shape for
    // generateChatCompletion, so projection must normalize it identically
    // instead of assuming already-normalized options.
    const agentShaped = buildCallOptions(provider, {
      contents: [
        { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
      ],
    }) as Record<string, unknown>;
    delete agentShaped['resolved'];
    agentShaped['invocation'] = { signal: new AbortController().signal };

    const projection = await provider.projectPromptEnvelope(
      agentShaped as Parameters<typeof provider.projectPromptEnvelope>[0],
    );

    expect(projection).toBeDefined();
    expect(projection.protocol).toBe('anthropic-messages');
    expect(await projection.countProjectedTokens()).toBeGreaterThan(0);
  });

  it('reports unsupported media explicitly from the finalized request body', async () => {
    const provider = new TestAnthropicProvider();

    const projection = await provider.projectPromptEnvelope(
      buildCallOptions(provider, {
        contents: [
          {
            speaker: 'human',
            blocks: [
              { type: 'text', text: 'Describe this recording' },
              {
                type: 'media',
                mimeType: 'audio/wav',
                data: 'AAAA',
                encoding: 'base64',
              },
            ],
          },
        ],
      }),
    );

    expect(projection.unsupportedMedia.length).toBeGreaterThan(0);
    expect(projection.unsupportedMedia[0].kind).toBe('unsupported');
    expect(projection.unsupportedMedia[0].mediaType).toBe('audio');
  });

  it('treats PDF documents as supported by the Messages normalizer', async () => {
    const provider = new TestAnthropicProvider();
    const projection = await provider.projectPromptEnvelope(
      buildCallOptions(provider, {
        contents: [
          {
            speaker: 'human',
            blocks: [
              {
                type: 'media',
                mimeType: 'application/pdf',
                data: 'JVBERi0=',
                encoding: 'base64',
                filename: 'document.pdf',
              },
            ],
          },
        ],
      }),
    );

    expect(projection.unsupportedMedia).toStrictEqual([]);
    expect(await projection.countProjectedTokens()).toBeGreaterThan(0);
  });

  it('counts a longer system instruction as more finalized system material', async () => {
    const provider = new TestAnthropicProvider();
    const contents = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
    ];

    const baselineOptions = buildCallOptions(provider, { contents });
    const withoutInstruction = await provider.projectPromptEnvelope({
      ...baselineOptions,
      systemInstruction: 'Be brief.',
    });
    const withLongInstruction = await provider.projectPromptEnvelope({
      ...baselineOptions,
      systemInstruction:
        'Always answer with extensive detail, follow every formatting rule, explain assumptions, and avoid unsupported speculation in every response.',
    });

    const withoutTokens = await withoutInstruction.countProjectedTokens();
    const withTokens = await withLongInstruction.countProjectedTokens();
    expect(withTokens).toBeGreaterThan(withoutTokens);
  });
});
