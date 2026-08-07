/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for provider prompt-envelope projections (issue #2817).
 *
 * Each provider builds a finalized request body in its preparation path. The
 * projection counts tokens against ONLY the prompt-bearing typed fields
 * (system/messages/tools for Anthropic; messages/tools for OpenAI Chat;
 * instructions/input/tools for OpenAI Responses) — never the full HTTP body,
 * which would inflate counts with transport controls (stream, max_tokens,
 * tool_choice) and raw base64 media.
 *
 * @requirement:REQ-PE-001 (issue #2817 acceptance A3, A4, A5, A9, finding #6)
 */

import { describe, it, expect } from 'bun:test';
import { estimateTokens } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import {
  projectAnthropicPromptEnvelope,
  projectOpenAIChatPromptEnvelope,
  projectOpenAIResponsesPromptEnvelope,
} from './promptEnvelopeProjections.js';

describe('projectAnthropicPromptEnvelope (issue #2817)', () => {
  it('identifies anthropic-messages protocol, messages/v1 method, and model from the finalized request body', () => {
    const requestBody = {
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 8192,
      system: 'You are a helpful assistant.',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const projection = projectAnthropicPromptEnvelope(requestBody);
    expect(projection.protocol).toBe('anthropic-messages');
    expect(projection.method).toBe('messages/v1');
    expect(projection.model).toBe('claude-3-5-sonnet-20241022');
    expect(projection.projectionRevision).toBe(3);
    // Assert immutability before toMatchObject: Bun's expect mutates the
    // received object's properties when resolving asymmetric matchers, which
    // would otherwise unfreeze finalizedProjection before this check runs.
    expect(Object.isFrozen(projection.finalizedProjection)).toBe(true);
    expect(projection.finalizedProjection).toMatchObject({
      kind: 'llxprt-provider-prompt-v3',
      protocol: 'anthropic-messages',
      promptText: expect.any(String),
    });
  });

  it('counts more tokens for a larger prompt (messages+system+tools), not the full HTTP body', async () => {
    const small = {
      model: 'claude-3-5-sonnet',
      max_tokens: 100,
      stream: true,
      messages: [{ role: 'user', content: 'Hi' }],
    };
    const large = {
      model: 'claude-3-5-sonnet',
      max_tokens: 100,
      stream: true,
      messages: [
        {
          role: 'user',
          content:
            'Please write a very long detailed essay about the history of computing.',
        },
      ],
    };

    const smallTokens =
      await projectAnthropicPromptEnvelope(small).legacyEstimate();
    const largeTokens =
      await projectAnthropicPromptEnvelope(large).legacyEstimate();
    expect(largeTokens).toBeGreaterThan(smallTokens);
  });

  it('does NOT count transport controls (stream, max_tokens, tool_choice) — only system/messages/tools', async () => {
    const promptOnly = {
      model: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'Hello world' }],
      system: 'Be helpful.',
    };

    const withTransportControls = {
      model: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'Hello world' }],
      system: 'Be helpful.',
      stream: true,
      max_tokens: 8192,
      tool_choice: { type: 'auto' },
      metadata: { user_id: 'abc123' },
    };

    const a = await projectAnthropicPromptEnvelope(promptOnly).legacyEstimate();
    const b = await projectAnthropicPromptEnvelope(
      withTransportControls,
    ).legacyEstimate();
    // Adding transport controls must NOT change the estimate — only prompt
    // fields are counted.
    expect(b).toBe(a);
  });

  it('counts tools as prompt-bearing material', async () => {
    const withoutTools = {
      model: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'Hello' }],
    };
    const withTools = {
      model: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'Hello' }],
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather for a city',
          input_schema: {
            type: 'object',
            properties: { city: { type: 'string' } },
          },
        },
      ],
    };

    const withoutTokens =
      await projectAnthropicPromptEnvelope(withoutTools).legacyEstimate();
    const withTokens =
      await projectAnthropicPromptEnvelope(withTools).legacyEstimate();
    expect(withTokens).toBeGreaterThan(withoutTokens);
  });

  it('does NOT inflate the count with raw base64 image data', async () => {
    const textOnly = {
      model: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'Describe this' }],
    };
    const withBase64Image = {
      model: 'claude-3-5-sonnet',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'A'.repeat(100_000),
              },
            },
          ],
        },
      ],
    };

    const textTokens =
      await projectAnthropicPromptEnvelope(textOnly).legacyEstimate();
    const imageTokens =
      await projectAnthropicPromptEnvelope(withBase64Image).legacyEstimate();
    // Base64 data should not dominate the count (finding #6: avoid raw base64
    // distortion). The image-bearing message has MORE text fields (the content
    // array wrapper), but the 100k base64 string must not inflate the count
    // proportionally.
    expect(imageTokens).toBeLessThan(textTokens * 50);
  });

  it('counts long prompt-bearing data values that are not marked as base64 media', async () => {
    const build = (size: number) => ({
      model: 'claude-3-5-sonnet',
      messages: [
        {
          role: 'user',
          content: [{ type: 'document', data: 'A'.repeat(size) }],
        },
      ],
    });

    const shortTokens = await projectAnthropicPromptEnvelope(
      build(300),
    ).legacyEstimate();
    const longTokens = await projectAnthropicPromptEnvelope(
      build(10_000),
    ).legacyEstimate();

    expect(longTokens).toBeGreaterThan(shortTokens);
  });

  it('keeps binary-size invariant for RFC 2397 data URLs without a media type', async () => {
    const project = (size: number) =>
      projectAnthropicPromptEnvelope({
        model: 'claude-3-5-sonnet',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe this' },
              { type: 'image', source: `data:;base64,${'A'.repeat(size)}` },
            ],
          },
        ],
      }).legacyEstimate();

    const baselineTokens = await project(1_000);
    const inflatedTokens = await project(100_000);

    expect(baselineTokens).toBeGreaterThan(0);
    expect(inflatedTokens).toBe(baselineTokens);
  });

  it('keeps binary-size invariant for data URLs with MIME parameters', async () => {
    const project = (size: number) =>
      projectAnthropicPromptEnvelope({
        model: 'claude-3-5-sonnet',
        messages: [
          {
            role: 'user',
            content: `Embedded document: data:text/html;charset=utf-8;base64,${'A'.repeat(size)}`,
          },
        ],
      }).legacyEstimate();

    const baselineTokens = await project(1_000);
    const inflatedTokens = await project(100_000);

    expect(baselineTokens).toBeGreaterThan(0);
    expect(inflatedTokens).toBe(baselineTokens);
  });

  it('scrubs all data URIs when a single string field contains multiple data URLs', async () => {
    const build = (bytes: number) => ({
      model: 'claude-3-5-sonnet',
      messages: [
        {
          role: 'user',
          content: `Look at these two images: data:image/png;base64,${'A'.repeat(bytes)} and data:image/jpeg;base64,${'B'.repeat(bytes)}`,
        },
      ],
    });
    const small = await projectAnthropicPromptEnvelope(
      build(1_000),
    ).legacyEstimate();
    const large = await projectAnthropicPromptEnvelope(
      build(100_000),
    ).legacyEstimate();
    expect(small).toBeGreaterThan(0);
    expect(large).toBe(small);
  });

  it('surfaces unsupported media explicitly when passed from preparation', () => {
    const requestBody = {
      model: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'Hello' }],
    };
    const unsupported = [
      {
        kind: 'unsupported' as const,
        reason: 'video not supported',
        mediaType: 'video',
      },
    ];
    const projection = projectAnthropicPromptEnvelope(requestBody, {
      unsupportedMedia: unsupported,
    });
    expect(projection.unsupportedMedia).toHaveLength(1);
    expect(projection.unsupportedMedia[0].kind).toBe('unsupported');
  });
});

describe('projectOpenAIChatPromptEnvelope (issue #2817)', () => {
  it('identifies openai-chat protocol, chat/completions/v1 method, and model', () => {
    const requestBody = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
      ],
      stream: true,
    };

    const projection = projectOpenAIChatPromptEnvelope(requestBody);
    expect(projection.protocol).toBe('openai-chat');
    expect(projection.method).toBe('chat/completions/v1');
    expect(projection.model).toBe('gpt-4o');
    expect(projection.projectionRevision).toBe(3);
  });

  it('counts more tokens for a larger messages payload', async () => {
    const small = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hi' }],
    };
    const large = {
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: 'Please explain quantum computing in great detail.',
        },
      ],
    };

    const smallTokens =
      await projectOpenAIChatPromptEnvelope(small).legacyEstimate();
    const largeTokens =
      await projectOpenAIChatPromptEnvelope(large).legacyEstimate();
    expect(largeTokens).toBeGreaterThan(smallTokens);
  });

  it('does NOT count transport controls (stream, max_tokens, tool_choice) — only messages/tools', async () => {
    const promptOnly = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello world' }],
    };
    const withTransportControls = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello world' }],
      stream: true,
      max_tokens: 4096,
      temperature: 0.7,
      tool_choice: 'auto',
    };

    const a =
      await projectOpenAIChatPromptEnvelope(promptOnly).legacyEstimate();
    const b = await projectOpenAIChatPromptEnvelope(
      withTransportControls,
    ).legacyEstimate();
    expect(b).toBe(a);
  });

  it('counts tools as prompt-bearing material', async () => {
    const withoutTools = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
    };
    const withTools = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
    };

    const withoutTokens =
      await projectOpenAIChatPromptEnvelope(withoutTools).legacyEstimate();
    const withTokens =
      await projectOpenAIChatPromptEnvelope(withTools).legacyEstimate();
    expect(withTokens).toBeGreaterThan(withoutTokens);
  });

  it('counts long tool-schema property names from the complete wire structure', async () => {
    const baseTool = {
      type: 'function',
      function: {
        name: 'inspect',
        parameters: { type: 'object', properties: {} },
      },
    };
    const withLongProperty = {
      ...baseTool,
      function: {
        ...baseTool.function,
        parameters: {
          type: 'object',
          properties: {
            extraordinarily_long_and_semantically_meaningful_schema_property_name:
              { type: 'string' },
          },
        },
      },
    };
    const request = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
    };
    const shortTokens = await projectOpenAIChatPromptEnvelope({
      ...request,
      tools: [baseTool],
    }).legacyEstimate();
    const longTokens = await projectOpenAIChatPromptEnvelope({
      ...request,
      tools: [withLongProperty],
    }).legacyEstimate();
    expect(longTokens).toBeGreaterThan(shortTokens);
  });

  it('does not count inline image_url data URI bytes as text', async () => {
    const build = (bytes: number) => ({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this image' },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${'A'.repeat(bytes)}` },
            },
          ],
        },
      ],
    });
    const small = await projectOpenAIChatPromptEnvelope(
      build(512),
    ).legacyEstimate();
    const large = await projectOpenAIChatPromptEnvelope(
      build(100_000),
    ).legacyEstimate();
    expect(large).toBe(small);
  });
});

describe('projectOpenAIResponsesPromptEnvelope (issue #2817)', () => {
  it('identifies openai-responses protocol, responses/v1 method, and model', () => {
    const request = {
      model: 'gpt-4o',
      input: [{ role: 'user', content: 'Hello' }],
      instructions: 'You are a helpful assistant.',
    };

    const projection = projectOpenAIResponsesPromptEnvelope(request);
    expect(projection.protocol).toBe('openai-responses');
    expect(projection.method).toBe('responses/v1');
    expect(projection.model).toBe('gpt-4o');
    expect(projection.projectionRevision).toBe(3);
  });

  it('counts more tokens for a larger input payload', async () => {
    const small = {
      model: 'gpt-4o',
      input: [{ type: 'message', role: 'user', content: 'Hi' }],
    };
    const large = {
      model: 'gpt-4o',
      input: [
        {
          type: 'message',
          role: 'user',
          content: 'Explain the theory of relativity in detail.',
        },
      ],
    };

    const smallTokens =
      await projectOpenAIResponsesPromptEnvelope(small).legacyEstimate();
    const largeTokens =
      await projectOpenAIResponsesPromptEnvelope(large).legacyEstimate();
    expect(largeTokens).toBeGreaterThan(smallTokens);
  });

  it('counts instructions (system prompt) as prompt-bearing material', async () => {
    const withoutInstructions = {
      model: 'gpt-4o',
      input: [{ type: 'message', role: 'user', content: 'Hello' }],
    };
    const withInstructions = {
      model: 'gpt-4o',
      input: [{ type: 'message', role: 'user', content: 'Hello' }],
      instructions:
        'You are an expert assistant. Follow these detailed rules carefully.',
    };

    const withoutTokens =
      await projectOpenAIResponsesPromptEnvelope(
        withoutInstructions,
      ).legacyEstimate();
    const withTokens =
      await projectOpenAIResponsesPromptEnvelope(
        withInstructions,
      ).legacyEstimate();
    expect(withTokens).toBeGreaterThan(withoutTokens);
  });

  it('does not count inline image and PDF data URI bytes as text', async () => {
    const build = (bytes: number) => ({
      model: 'gpt-4o',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_image',
              image_url: `data:image/png;base64,${'A'.repeat(bytes)}`,
            },
            {
              type: 'input_file',
              file_data: `data:application/pdf;base64,${'B'.repeat(bytes)}`,
              filename: 'document.pdf',
            },
          ],
        },
      ],
    });
    const small = await projectOpenAIResponsesPromptEnvelope(
      build(512),
    ).legacyEstimate();
    const large = await projectOpenAIResponsesPromptEnvelope(
      build(100_000),
    ).legacyEstimate();
    expect(large).toBe(small);
  });

  it('counts tools and excludes transport controls', async () => {
    const promptOnly = {
      model: 'gpt-4o',
      input: [{ type: 'message', role: 'user', content: 'Hello' }],
    };
    const withTransportControls = {
      ...promptOnly,
      stream: true,
      temperature: 0.8,
      max_output_tokens: 4096,
      tool_choice: 'auto',
    };
    const withTools = {
      ...promptOnly,
      tools: [
        {
          type: 'function',
          name: 'get_weather',
          description: 'Get weather for a city',
          parameters: {
            type: 'object',
            properties: { city: { type: 'string' } },
          },
        },
      ],
    };

    const baselineTokens =
      await projectOpenAIResponsesPromptEnvelope(promptOnly).legacyEstimate();
    const controlTokens = await projectOpenAIResponsesPromptEnvelope(
      withTransportControls,
    ).legacyEstimate();
    const toolTokens =
      await projectOpenAIResponsesPromptEnvelope(withTools).legacyEstimate();

    expect(controlTokens).toBe(baselineTokens);
    expect(toolTokens).toBeGreaterThan(baselineTokens);
  });
});

describe('projection token count consistency (issue #2817 A10)', () => {
  it.each([
    ['Anthropic', projectAnthropicPromptEnvelope, 'messages'],
    ['OpenAI Chat', projectOpenAIChatPromptEnvelope, 'messages'],
    ['OpenAI Responses', projectOpenAIResponsesPromptEnvelope, 'input'],
  ] as const)(
    'estimates separate equal %s request bodies consistently',
    async (_name, project, promptKey) => {
      const buildRequestBody = () => ({
        model: 'test-model',
        [promptKey]: [{ role: 'user', content: 'Consistent test message' }],
      });

      const first = buildRequestBody();
      const second = buildRequestBody();
      const firstTokens = await project(first).legacyEstimate();
      const secondTokens = await project(second).legacyEstimate();

      expect(firstTokens).toBe(secondTokens);
      expect(first).toStrictEqual(buildRequestBody());
      expect(second).toStrictEqual(buildRequestBody());
    },
  );

  it.each([
    ['Anthropic', projectAnthropicPromptEnvelope, 'messages'],
    ['OpenAI Chat', projectOpenAIChatPromptEnvelope, 'messages'],
    ['OpenAI Responses', projectOpenAIResponsesPromptEnvelope, 'input'],
  ] as const)(
    'produces a positive %s token count for a non-empty prompt',
    async (_name, project, promptKey) => {
      const requestBody = {
        model: 'test-model',
        [promptKey]: [{ role: 'user', content: 'x' }],
      };
      const tokens = await project(requestBody).legacyEstimate();
      expect(tokens).toBeGreaterThan(0);
    },
  );

  it.each([
    ['Anthropic', projectAnthropicPromptEnvelope, 'messages'],
    ['OpenAI Chat', projectOpenAIChatPromptEnvelope, 'messages'],
    ['OpenAI Responses', projectOpenAIResponsesPromptEnvelope, 'input'],
  ] as const)(
    'preserves the full structural %s estimate for legacy models',
    async (_name, project, promptKey) => {
      const projection = project({
        model: 'legacy-model',
        [promptKey]: [{ role: 'user', content: 'legacy prompt' }],
      });
      const finalized = projection.finalizedProjection as {
        promptText: string;
      };

      expect(await projection.legacyEstimate()).toBe(
        estimateTokens(finalized.promptText),
      );
    },
  );
});

describe('projection fail-fast: model must be non-empty string (finding #4)', () => {
  it.each([
    ['Anthropic', projectAnthropicPromptEnvelope],
    ['OpenAI Chat', projectOpenAIChatPromptEnvelope],
    ['OpenAI Responses', projectOpenAIResponsesPromptEnvelope],
  ] as const)('%s throws when model is absent', (_name, project) => {
    expect(() =>
      project({ messages: [{ role: 'user', content: 'Hello' }] }),
    ).toThrow(/model/i);
  });

  it.each([
    ['Anthropic', projectAnthropicPromptEnvelope],
    ['OpenAI Chat', projectOpenAIChatPromptEnvelope],
    ['OpenAI Responses', projectOpenAIResponsesPromptEnvelope],
  ] as const)('%s throws when model is an empty string', (_name, project) => {
    expect(() =>
      project({
        model: '',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    ).toThrow(/model/i);
  });

  it.each([
    ['Anthropic', projectAnthropicPromptEnvelope],
    ['OpenAI Chat', projectOpenAIChatPromptEnvelope],
    ['OpenAI Responses', projectOpenAIResponsesPromptEnvelope],
  ] as const)('%s throws when model is whitespace-only', (_name, project) => {
    expect(() =>
      project({
        model: '   ',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    ).toThrow(/model/i);
  });

  it.each([
    ['Anthropic', projectAnthropicPromptEnvelope],
    ['OpenAI Chat', projectOpenAIChatPromptEnvelope],
    ['OpenAI Responses', projectOpenAIResponsesPromptEnvelope],
  ] as const)('%s throws when model is a non-string type', (_name, project) => {
    expect(() =>
      project({
        model: 42,
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    ).toThrow(/model/i);
  });

  it('includes the protocol and method in the error message for diagnosis', () => {
    expect(() =>
      projectOpenAIResponsesPromptEnvelope({
        model: '',
        input: [{ role: 'user', content: 'Hello' }],
      }),
    ).toThrow(/openai-responses.*responses\/v1/i);
  });
});

describe('projection immutability (issue #2817)', () => {
  it.each([
    ['Anthropic', projectAnthropicPromptEnvelope],
    ['OpenAI Chat', projectOpenAIChatPromptEnvelope],
    ['OpenAI Responses', projectOpenAIResponsesPromptEnvelope],
  ] as const)('%s returns a frozen projection', (_name, project) => {
    const projection = project({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
    });

    // The contract declares every member readonly; a projection cached or
    // replayed across retries must not be mutable out from under a later
    // estimate.
    expect(Object.isFrozen(projection)).toBe(true);
    expect(() => {
      (projection as { model: string }).model = 'tampered';
    }).toThrow(TypeError);
    expect(projection.model).toBe('gpt-4o');
  });
});
