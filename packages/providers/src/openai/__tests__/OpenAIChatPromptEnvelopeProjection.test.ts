/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral test: OpenAIProvider.projectPromptEnvelope must project the SAME
 * finalized request body that transport sends (issue #2817 acceptance A4).
 *
 * Exercises the real request-shaping path (prepareRequest) through
 * projectPromptEnvelope while mocking the external OpenAI SDK boundary. This
 * proves the estimate reflects history, pending content, system instructions,
 * and tools without rebuilding the payload outside the provider.
 *
 * @requirement:REQ-PE-001 (issue #2817 acceptance A4, A10)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { OpenAIProvider } from '../OpenAIProvider.js';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';

vi.mock('openai', () => {
  class FakeOpenAI {
    readonly chat = {
      completions: {
        create: vi.fn(async () => ({})),
      },
    };
  }
  return { default: FakeOpenAI };
});

vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(async () => 'core-prompt'),
}));

class TestOpenAIProvider extends OpenAIProvider {
  constructor() {
    super('token-test', 'https://api.openai.com/v1');
  }

  override getCurrentModel(): string {
    return 'gpt-4o';
  }

  protected override getModel(): string {
    return 'gpt-4o';
  }

  protected override async getAuthToken(): Promise<string> {
    return 'token-test';
  }
}

function buildCallOptions(
  provider: OpenAIProvider,
  overrides: Parameters<typeof createProviderCallOptions>[0],
) {
  return createProviderCallOptions({
    providerName: provider.name,
    resolved: {
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      telemetry: { providerName: provider.name },
    },
    ...overrides,
  });
}

describe('OpenAIProvider.projectPromptEnvelope (issue #2817 A4)', () => {
  beforeEach(() => {
    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({
        settingsService: new SettingsService(),
        runtimeId: 'openai-envelope-test',
      }),
    );
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  it('identifies openai-chat protocol, chat/completions/v1 method, and the model', async () => {
    const provider = new TestOpenAIProvider();
    const options = buildCallOptions(provider, {
      contents: [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ],
    });

    const projection = await provider.projectPromptEnvelope(options);

    expect(projection.protocol).toBe('openai-chat');
    expect(projection.method).toBe('chat/completions/v1');
    expect(projection.projectionRevision).toBe(2);
    expect(projection.model).toBe('gpt-4o');
  });

  it('counts more tokens for a larger conversation history', async () => {
    const provider = new TestOpenAIProvider();

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
                text: 'Please explain in great detail the entire history of computing.',
              },
            ],
          },
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'text',
                text: 'The history of computing spans many decades of innovation.',
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
    const provider = new TestOpenAIProvider();
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

  it('uses the provider model fallback before selecting transport', async () => {
    const provider = new TestOpenAIProvider();
    const options = buildCallOptions(provider, {
      contents: [
        { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
      ],
    });
    const optionsWithoutExplicitModel = {
      ...options,
      resolved: { ...options.resolved, model: '' },
    };

    const projection = await provider.projectPromptEnvelope(
      optionsWithoutExplicitModel,
    );

    expect(projection.protocol).toBe('openai-chat');
    expect(projection.model).toBe('gpt-4o');
  });

  it('does not count transport controls (stream, temperature) — only messages/tools', async () => {
    const provider = new TestOpenAIProvider();
    const contents = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'Hello world' }] },
    ];

    const baseline = await provider.projectPromptEnvelope(
      buildCallOptions(provider, {
        contents,
        settingsOverrides: {
          provider: { openai: { stream: false, temperature: 0.1 } },
        },
      }),
    );
    const withEphemeralControls = await provider.projectPromptEnvelope(
      buildCallOptions(provider, {
        contents,
        ephemerals: { openai: { stream: true, temperature: 0.9 } },
      }),
    );

    const baselineTokens = await baseline.countProjectedTokens();
    const controlledTokens = await withEphemeralControls.countProjectedTokens();
    expect(controlledTokens).toBe(baselineTokens);
  });
});
