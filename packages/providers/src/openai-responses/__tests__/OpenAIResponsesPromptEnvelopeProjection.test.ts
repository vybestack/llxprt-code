/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral test: OpenAIResponsesProvider.projectPromptEnvelope must project
 * the SAME finalized request that transport sends (issue #2817 acceptance A5).
 *
 * Exercises the REAL provider preparation path (buildRequestContext) through
 * projectPromptEnvelope, proving the estimate reflects history, pending
 * content, instructions, and tools without rebuilding the payload outside
 * the provider.
 *
 * @requirement:REQ-PE-001 (issue #2817 acceptance A5, A10)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { OpenAIResponsesProvider } from '../OpenAIResponsesProvider.js';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';

vi.mock('openai', () => ({
  default: class FakeOpenAI {
    readonly responses = {
      create: vi.fn(async () => ({ output: [] })),
    };
  },
}));

vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(async () => 'core-prompt'),
}));

class TestResponsesProvider extends OpenAIResponsesProvider {
  constructor() {
    super('token-test', 'https://api.openai.com/v1');
  }

  protected override async getAuthToken(): Promise<string> {
    return 'token-test';
  }

  readonly promptAuthResolutions: string[] = [];

  protected override async getAuthTokenForPrompt(): Promise<string> {
    const token = `token-${this.promptAuthResolutions.length + 1}`;
    this.promptAuthResolutions.push(token);
    return token;
  }
}

function buildCallOptions(
  provider: OpenAIResponsesProvider,
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

describe('OpenAIResponsesProvider.projectPromptEnvelope (issue #2817 A5)', () => {
  beforeEach(() => {
    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({
        settingsService: new SettingsService(),
        runtimeId: 'openai-responses-envelope-test',
      }),
    );
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  it('projects without resolving transport authentication', async () => {
    const provider = new TestResponsesProvider();
    const projection = await provider.projectPromptEnvelope(
      buildCallOptions(provider, {
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
        ],
      }),
    );

    expect(await projection.countProjectedTokens()).toBeGreaterThan(0);
    expect(provider.promptAuthResolutions).toStrictEqual([]);
  });

  it('identifies openai-responses protocol, responses/v1 method, and the model', async () => {
    const provider = new TestResponsesProvider();
    const options = buildCallOptions(provider, {
      contents: [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ],
    });

    const projection = await provider.projectPromptEnvelope(options);

    expect(projection.protocol).toBe('openai-responses');
    expect(projection.method).toBe('responses/v1');
    expect(projection.projectionRevision).toBe(2);
    expect(projection.model).toBe('gpt-4o');
  });

  it('counts more tokens for a larger conversation history', async () => {
    const provider = new TestResponsesProvider();

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
                text: 'Please explain in great detail the entire theory of relativity.',
              },
            ],
          },
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'text',
                text: 'The theory of relativity transformed our understanding of physics.',
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
    const provider = new TestResponsesProvider();
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

  it('counts a longer system instruction as more finalized instructions', async () => {
    const provider = new TestResponsesProvider();
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

  it('resolves fresh authentication only when transporting the prepared body', async () => {
    const provider = new TestResponsesProvider();
    const options = buildCallOptions(provider, {
      contents: [
        { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
      ],
    });
    const projection = await provider.projectPromptEnvelope(options);
    const transportedBodies: string[] = [];
    const authorizationHeaders: string[] = [];
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (_input, init) => {
      const requestBody = init?.body;
      if (requestBody === undefined || requestBody === null) {
        throw new Error('Expected Responses transport to send a body');
      }
      transportedBodies.push(await new Response(requestBody).text());
      authorizationHeaders.push(
        new Headers(init?.headers).get('authorization') ?? '',
      );
      const encoder = new TextEncoder();
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    });

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

    expect(provider.promptAuthResolutions).toStrictEqual(['token-1']);
    expect(authorizationHeaders).toStrictEqual(['Bearer token-1']);
    expect(transportedBodies).toHaveLength(1);
    expect(JSON.parse(transportedBodies[0])).toMatchObject({
      model: 'gpt-4o',
    });
  });

  it('fails fast when transport receives an unknown prepared token', async () => {
    const provider = new TestResponsesProvider();
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

    await expect(drain()).rejects.toThrow(
      'Unknown OpenAI Responses prompt-envelope transport token',
    );
    expect(provider.promptAuthResolutions).toStrictEqual([]);
  });

  it('requires fresh preparation when the prepared endpoint changes', async () => {
    const provider = new TestResponsesProvider();
    const options = buildCallOptions(provider, {
      contents: [
        { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
      ],
    });
    const projection = await provider.projectPromptEnvelope(options);

    const drain = async (): Promise<void> => {
      for await (const _chunk of provider.generateChatCompletion({
        ...options,
        resolved: {
          ...options.resolved,
          baseURL: 'https://different.example/v1',
        },
        promptEnvelopeTransportToken: projection.transportToken,
      })) {
        // drain
      }
    };

    await expect(drain()).rejects.toThrow(/freshly prepared prompt envelope/i);
    expect(provider.promptAuthResolutions).toStrictEqual([]);
  });

  it('surfaces disabled PDFs and all unsupported substitutions structurally', async () => {
    const provider = new TestResponsesProvider();
    const projection = await provider.projectPromptEnvelope(
      buildCallOptions(provider, {
        ephemerals: { 'media.pdf.enabled': false },
        contents: [
          {
            speaker: 'human',
            blocks: [
              {
                type: 'media',
                mimeType: 'application/pdf',
                data: 'JVBERi0=',
                encoding: 'base64',
                filename: 'disabled.pdf',
              },
              {
                type: 'media',
                mimeType: 'audio/wav',
                data: 'AAAA',
                encoding: 'base64',
              },
              {
                type: 'media',
                mimeType: 'video/mp4',
                data: 'AAAA',
                encoding: 'base64',
              },
              {
                type: 'media',
                mimeType: 'application/octet-stream',
                data: 'AAAA',
                encoding: 'base64',
              },
            ],
          },
        ],
      }),
    );

    expect(
      projection.unsupportedMedia.map((entry) => entry.mediaType),
    ).toStrictEqual(['pdf', 'audio', 'video', 'unknown']);
  });
});
