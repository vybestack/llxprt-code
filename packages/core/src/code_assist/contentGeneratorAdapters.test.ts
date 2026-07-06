/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  toGenerateContentParameters,
  fromGenerateContentResponse,
  toCountTokensParameters,
  fromCountTokensResponse,
  fromEmbedContentResponse,
} from './contentGeneratorAdapters.js';
import type { GenerateContentResponse } from '@google/genai';
import type { ModelGenerationRequest } from '../llm-types/modelRequest.js';
import type { IContent } from '../services/history/IContent.js';

function textUser(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function textAi(text: string): IContent {
  return { speaker: 'ai', blocks: [{ type: 'text', text }] };
}

describe('toGenerateContentParameters', () => {
  it('converts simple text contents', () => {
    const request: ModelGenerationRequest = {
      contents: [textUser('hello')],
      model: 'gemini-2.5-pro',
    };
    const params = toGenerateContentParameters(request);
    expect(params.model).toBe('gemini-2.5-pro');
    expect(params.contents).toHaveLength(1);
    const content = params.contents[0] as { role: string; parts: unknown[] };
    expect(content.role).toBe('user');
    expect(content.parts[0]).toStrictEqual({ text: 'hello' });
  });

  it('maps temperature and maxOutputTokens settings', () => {
    const request: ModelGenerationRequest = {
      contents: [textUser('hi')],
      model: 'm',
      settings: { temperature: 0.7, maxOutputTokens: 1024 },
    };
    const params = toGenerateContentParameters(request);
    expect(params.config?.temperature).toBe(0.7);
    expect(params.config?.maxOutputTokens).toBe(1024);
  });

  it('maps topP setting', () => {
    const request: ModelGenerationRequest = {
      contents: [textUser('hi')],
      model: 'm',
      settings: { topP: 0.9 },
    };
    const params = toGenerateContentParameters(request);
    expect(params.config?.topP).toBe(0.9);
  });

  it('maps systemInstruction', () => {
    const request: ModelGenerationRequest = {
      contents: [textUser('hi')],
      model: 'm',
      settings: { systemInstruction: 'You are helpful' },
    };
    const params = toGenerateContentParameters(request);
    expect(params.config?.systemInstruction).toBe('You are helpful');
  });

  it('maps responseJsonSchema', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } } };
    const request: ModelGenerationRequest = {
      contents: [textUser('hi')],
      model: 'm',
      settings: { responseJsonSchema: schema },
    };
    const params = toGenerateContentParameters(request);
    expect(params.config?.responseJsonSchema).toStrictEqual(schema);
  });

  it('maps abortSignal into config', () => {
    const controller = new AbortController();
    const request: ModelGenerationRequest = {
      contents: [textUser('hi')],
      model: 'm',
      abortSignal: controller.signal,
    };
    const params = toGenerateContentParameters(request);
    expect(params.config?.abortSignal).toBe(controller.signal);
  });

  it('maps toolChoice to toolConfig', () => {
    const request: ModelGenerationRequest = {
      contents: [textUser('hi')],
      model: 'm',
      settings: { toolChoice: { mode: 'required' } },
    };
    const params = toGenerateContentParameters(request);
    expect(params.config?.toolConfig?.functionCallingConfig?.mode).toBe('ANY');
  });

  it('maps toolChoice none mode', () => {
    const request: ModelGenerationRequest = {
      contents: [textUser('hi')],
      model: 'm',
      settings: { toolChoice: { mode: 'none' } },
    };
    const params = toGenerateContentParameters(request);
    expect(params.config?.toolConfig?.functionCallingConfig?.mode).toBe('NONE');
  });

  it('maps tools as functionDeclarations with parametersJsonSchema', () => {
    const request: ModelGenerationRequest = {
      contents: [textUser('hi')],
      model: 'm',
      tools: [
        {
          name: 'search',
          parametersJsonSchema: { type: 'object' },
        },
      ],
    };
    const params = toGenerateContentParameters(request);
    expect(params.config?.tools).toBeDefined();
    const tools = params.config?.tools as Array<{
      functionDeclarations: Array<{
        name: string;
        parametersJsonSchema: unknown;
      }>;
    }>;
    expect(tools[0].functionDeclarations[0]).toStrictEqual({
      name: 'search',
      parametersJsonSchema: { type: 'object' },
    });
  });

  it('modelParams spread LAST wins over settings', () => {
    const request: ModelGenerationRequest = {
      contents: [textUser('hi')],
      model: 'm',
      settings: { temperature: 0.5 },
      modelParams: { temperature: 0.99, responseMimeType: 'application/json' },
    };
    const params = toGenerateContentParameters(request);
    expect(params.config?.temperature).toBe(0.99);
    expect(params.config?.responseMimeType).toBe('application/json');
  });

  it('converts tool_call blocks to functionCall parts', () => {
    const request: ModelGenerationRequest = {
      contents: [
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'call_1',
              name: 'search',
              parameters: { query: 'test' },
            },
          ],
        },
      ],
      model: 'm',
    };
    const params = toGenerateContentParameters(request);
    const content = params.contents[0] as {
      role: string;
      parts: Array<{ functionCall?: { name: string; args: unknown } }>;
    };
    expect(content.parts[0].functionCall?.name).toBe('search');
  });

  it('converts tool_response blocks to functionResponse parts', () => {
    const request: ModelGenerationRequest = {
      contents: [
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call_1',
              toolName: 'search',
              result: { output: 'found' },
            },
          ],
        },
      ],
      model: 'm',
    };
    const params = toGenerateContentParameters(request);
    const content = params.contents[0] as {
      role: string;
      parts: Array<{
        functionResponse?: { name: string; response: unknown; id: string };
      }>;
    };
    expect(content.parts[0].functionResponse?.name).toBe('search');
    expect(content.parts[0].functionResponse?.id).toBe('call_1');
  });
});

describe('fromGenerateContentResponse', () => {
  function makeResponse(
    parts: Array<Record<string, unknown>>,
    opts?: {
      finishReason?: string;
      usageMetadata?: Record<string, number>;
      responseId?: string;
      promptFeedback?: Record<string, unknown>;
    },
  ): GenerateContentResponse {
    return {
      candidates: [
        {
          content: { role: 'model', parts: parts as never },
          finishReason: opts?.finishReason as never,
        },
      ],
      usageMetadata: opts?.usageMetadata as never,
      responseId: opts?.responseId,
      promptFeedback: opts?.promptFeedback as never,
    } as unknown as GenerateContentResponse;
  }

  it('converts text parts to IContent text blocks', () => {
    const resp = makeResponse([{ text: 'Hello world' }]);
    const output = fromGenerateContentResponse(resp);
    expect(output.content.speaker).toBe('ai');
    expect(output.content.blocks).toHaveLength(1);
    expect(output.content.blocks[0]).toStrictEqual({
      type: 'text',
      text: 'Hello world',
    });
  });

  it('maps finishReason STOP to canonical stop', () => {
    const resp = makeResponse([{ text: 'hi' }], { finishReason: 'STOP' });
    const output = fromGenerateContentResponse(resp);
    expect(output.finishReason).toBe('stop');
    expect(output.rawStopReason).toBe('STOP');
  });

  it('maps finishReason MAX_TOKENS to canonical max_tokens', () => {
    const resp = makeResponse([{ text: 'hi' }], {
      finishReason: 'MAX_TOKENS',
    });
    const output = fromGenerateContentResponse(resp);
    expect(output.finishReason).toBe('max_tokens');
  });

  it('maps usageMetadata to UsageStats', () => {
    const resp = makeResponse([{ text: 'hi' }], {
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 20,
        totalTokenCount: 30,
        cachedContentTokenCount: 5,
        thoughtsTokenCount: 3,
      },
    });
    const output = fromGenerateContentResponse(resp);
    expect(output.usage).toStrictEqual({
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      cachedTokens: 5,
      reasoningTokens: 3,
    });
  });

  it('maps responseId to output.responseId', () => {
    const resp = makeResponse([{ text: 'hi' }], { responseId: 'resp-123' });
    const output = fromGenerateContentResponse(resp);
    expect(output.responseId).toBe('resp-123');
  });

  it('maps promptFeedback into providerMetadata under gemini', () => {
    const resp = makeResponse([{ text: 'hi' }], {
      promptFeedback: { blockReason: 'SAFETY' },
    });
    const output = fromGenerateContentResponse(resp);
    expect(output.providerMetadata?.['gemini.promptFeedback']).toStrictEqual({
      blockReason: 'SAFETY',
    });
  });

  it('handles empty candidates gracefully', () => {
    const resp = {
      candidates: [],
    } as unknown as GenerateContentResponse;
    const output = fromGenerateContentResponse(resp);
    expect(output.content.speaker).toBe('ai');
    expect(output.content.blocks).toHaveLength(0);
  });

  it('converts functionCall parts to tool_call blocks', () => {
    const resp = makeResponse([
      { functionCall: { name: 'search', args: { q: 'test' } } },
    ]);
    const output = fromGenerateContentResponse(resp);
    expect(output.content.blocks).toHaveLength(1);
    expect(output.content.blocks[0].type).toBe('tool_call');
  });

  it('preserves thought parts as thinking blocks', () => {
    const resp = makeResponse([{ thought: true, text: 'Let me think...' }]);
    const output = fromGenerateContentResponse(resp);
    expect(output.content.blocks).toHaveLength(1);
    expect(output.content.blocks[0].type).toBe('thinking');
  });
});

describe('countTokens / embedContent converters', () => {
  it('toCountTokensParameters converts contents', () => {
    const params = toCountTokensParameters(
      {
        contents: [textUser('hello'), textAi('world')],
      },
      'gemini-pro',
    );
    expect(params.contents).toHaveLength(2);
    expect(params.model).toBe('gemini-pro');
  });

  it('fromCountTokensResponse maps totalTokens', () => {
    const result = fromCountTokensResponse({ totalTokens: 42 });
    expect(result.totalTokens).toBe(42);
  });

  it('fromEmbedContentResponse maps embeddings', () => {
    const resp = {
      embeddings: [{ values: [0.1, 0.2] }, { values: [0.3, 0.4] }],
    };
    const result = fromEmbedContentResponse(resp);
    expect(result.embeddings).toStrictEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
  });
});
