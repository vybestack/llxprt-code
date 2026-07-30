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

import { describe, it, expect } from 'vitest';
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
    expect(projection.projectionRevision).toBe(2);
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
      await projectAnthropicPromptEnvelope(small).countProjectedTokens();
    const largeTokens =
      await projectAnthropicPromptEnvelope(large).countProjectedTokens();
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

    const a =
      await projectAnthropicPromptEnvelope(promptOnly).countProjectedTokens();
    const b = await projectAnthropicPromptEnvelope(
      withTransportControls,
    ).countProjectedTokens();
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
      await projectAnthropicPromptEnvelope(withoutTools).countProjectedTokens();
    const withTokens =
      await projectAnthropicPromptEnvelope(withTools).countProjectedTokens();
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
      await projectAnthropicPromptEnvelope(textOnly).countProjectedTokens();
    const imageTokens =
      await projectAnthropicPromptEnvelope(
        withBase64Image,
      ).countProjectedTokens();
    // Base64 data should not dominate the count (finding #6: avoid raw base64
    // distortion). The image-bearing message has MORE text fields (the content
    // array wrapper), but the 100k base64 string must not inflate the count
    // proportionally.
    expect(imageTokens).toBeLessThan(textTokens * 50);
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
      }).countProjectedTokens();

    const baselineTokens = await project(1_000);
    const inflatedTokens = await project(100_000);

    expect(baselineTokens).toBeGreaterThan(0);
    expect(inflatedTokens).toBe(baselineTokens);
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
    expect(projection.projectionRevision).toBe(2);
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
      await projectOpenAIChatPromptEnvelope(small).countProjectedTokens();
    const largeTokens =
      await projectOpenAIChatPromptEnvelope(large).countProjectedTokens();
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
      await projectOpenAIChatPromptEnvelope(promptOnly).countProjectedTokens();
    const b = await projectOpenAIChatPromptEnvelope(
      withTransportControls,
    ).countProjectedTokens();
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
      await projectOpenAIChatPromptEnvelope(
        withoutTools,
      ).countProjectedTokens();
    const withTokens =
      await projectOpenAIChatPromptEnvelope(withTools).countProjectedTokens();
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
    }).countProjectedTokens();
    const longTokens = await projectOpenAIChatPromptEnvelope({
      ...request,
      tools: [withLongProperty],
    }).countProjectedTokens();
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
    ).countProjectedTokens();
    const large = await projectOpenAIChatPromptEnvelope(
      build(100_000),
    ).countProjectedTokens();
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
    expect(projection.projectionRevision).toBe(2);
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
      await projectOpenAIResponsesPromptEnvelope(small).countProjectedTokens();
    const largeTokens =
      await projectOpenAIResponsesPromptEnvelope(large).countProjectedTokens();
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
      ).countProjectedTokens();
    const withTokens =
      await projectOpenAIResponsesPromptEnvelope(
        withInstructions,
      ).countProjectedTokens();
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
    ).countProjectedTokens();
    const large = await projectOpenAIResponsesPromptEnvelope(
      build(100_000),
    ).countProjectedTokens();
    expect(large).toBe(small);
  });
});

describe('projection token count consistency (issue #2817 A10)', () => {
  it('estimates the same request body consistently across calls', async () => {
    const requestBody = {
      model: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'Consistent test message' }],
    };

    const tokens1 =
      await projectAnthropicPromptEnvelope(requestBody).countProjectedTokens();
    const tokens2 =
      await projectAnthropicPromptEnvelope(requestBody).countProjectedTokens();
    expect(tokens1).toBe(tokens2);
  });

  it('produces a positive token count for any non-empty prompt', async () => {
    const requestBody = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'x' }],
    };
    const tokens =
      await projectOpenAIChatPromptEnvelope(requestBody).countProjectedTokens();
    expect(tokens).toBeGreaterThan(0);
  });
});
