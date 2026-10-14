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

import { afterEach, describe, expect, it, vi } from 'bun:test';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { createRuntimeTokenizerFactory } from '../../composition/runtimeTokenizerFactory.js';
import { OpenAIProvider } from '../OpenAIProvider.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-test-utils/core/providerCallOptions.js';
import { PROJECTION_REVISION } from '../../runtime/promptEnvelopeProjections.js';

void vi.mock('openai', () => {
  class FakeOpenAI {
    readonly chat = {
      completions: {
        create: vi.fn(async () => ({})),
      },
    };
  }
  return { default: FakeOpenAI };
});

void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
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

const factory = createRuntimeTokenizerFactory();
const unsent: PromptEnvelopeProjection[] = [];

/** Projects and keeps the projection so its files are released after the test. */
async function project(
  provider: OpenAIProvider,
  options: Parameters<OpenAIProvider['projectPromptEnvelope']>[0],
): Promise<PromptEnvelopeProjection> {
  const projection = await provider.projectPromptEnvelope(options);
  unsent.push(projection);
  return projection;
}

async function tokensOf(
  provider: OpenAIProvider,
  projection: PromptEnvelopeProjection,
): Promise<number> {
  const estimate = await estimatePromptEnvelope(
    provider.name,
    projection,
    factory,
  );
  return estimate.estimatedPromptTokens;
}

describe('OpenAIProvider.projectPromptEnvelope (issue #2817 A4)', () => {
  afterEach(async () => {
    for (const projection of unsent.splice(0)) {
      await projection.releaseIfUnsent?.();
    }
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

    const projection = await project(provider, options);

    expect(projection.protocol).toBe('openai-chat');
    expect(projection.method).toBe('chat/completions/v1');
    expect(projection.projectionRevision).toBe(PROJECTION_REVISION);
    expect(projection.model).toBe('gpt-4o');
  });

  it('counts more tokens for a larger conversation history', async () => {
    const provider = new TestOpenAIProvider();

    const small = await project(
      provider,
      buildCallOptions(provider, {
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'Hi' }] },
        ],
      }),
    );
    const large = await project(
      provider,
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

    const smallTokens = await tokensOf(provider, small);
    const largeTokens = await tokensOf(provider, large);
    expect(largeTokens).toBeGreaterThan(smallTokens);
  });

  it('counts more tokens when tools are declared', async () => {
    const provider = new TestOpenAIProvider();
    const baseContents = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
    ];

    const withoutTools = await project(
      provider,
      buildCallOptions(provider, { contents: baseContents }),
    );
    const withTools = await project(
      provider,
      buildCallOptions(provider, {
        contents: baseContents,
        tools: [
          {
            name: 'get_weather',
            description: 'Get the weather for a city',
            parametersJsonSchema: {
              type: 'object',
              properties: { city: { type: 'string' } },
            },
          },
        ],
      }),
    );

    const withoutTokens = await tokensOf(provider, withoutTools);
    const withTokens = await tokensOf(provider, withTools);
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

    const projection = await project(provider, optionsWithoutExplicitModel);

    expect(projection.protocol).toBe('openai-chat');
    expect(projection.model).toBe('gpt-4o');
  });

  it('does not count transport controls (stream, temperature) — only messages/tools', async () => {
    const provider = new TestOpenAIProvider();
    const contents = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'Hello world' }] },
    ];

    const baseline = await project(
      provider,
      buildCallOptions(provider, {
        contents,
        settingsOverrides: {
          provider: { openai: { stream: false, temperature: 0.1 } },
        },
      }),
    );
    const withEphemeralControls = await project(
      provider,
      buildCallOptions(provider, {
        contents,
        ephemerals: { openai: { stream: true, temperature: 0.9 } },
      }),
    );

    const baselineTokens = await tokensOf(provider, baseline);
    const controlledTokens = await tokensOf(provider, withEphemeralControls);
    expect(controlledTokens).toBe(baselineTokens);
  });

  it('fails fast when transport receives an unknown Chat prepared token', async () => {
    const provider = new TestOpenAIProvider();
    const options = buildCallOptions(provider, {
      contents: [
        { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
      ],
    });

    const drain = async (): Promise<void> => {
      for await (const _chunk of provider.generateChatCompletion({
        ...options,
        promptEnvelopeTransportToken: Object.freeze({}),
      })) {
        // drain
      }
    };

    await expect(drain()).rejects.toThrow(/Unknown.*Chat.*transport token/i);
  });
});
