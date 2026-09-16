/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  decodeHookLLMRequest,
  decodeHookLLMResponse,
  decodeHookToolChoice,
  mergeHookLLMRequest,
  parseHookLLMRequestBoundaryResult,
  type HookLLMRequest,
} from './hookTranslator.js';
import type {
  IContent,
  ToolCallBlock,
  ToolResponseBlock,
  ThinkingBlock,
} from '../services/history/IContent.js';
import type { ToolDeclaration } from '../llm-types/toolDeclaration.js';

const toolCallContent: IContent = {
  speaker: 'ai',
  blocks: [
    { type: 'text', text: 'I will check that.' },
    {
      type: 'tool_call',
      id: 'call-1',
      name: 'get_weather',
      parameters: { city: 'Oslo' },
    } satisfies ToolCallBlock,
  ],
};

const toolResponseContent: IContent = {
  speaker: 'tool',
  blocks: [
    {
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'get_weather',
      result: { temperature: 12 },
    } satisfies ToolResponseBlock,
  ],
};

const thinkingContent: IContent = {
  speaker: 'ai',
  blocks: [
    {
      type: 'thinking',
      thought: 'internal reasoning',
    } satisfies ThinkingBlock,
  ],
};

describe('decodeHookLLMRequest', () => {
  it('decodes a v2 envelope preserving tool_call, tool_response and thinking blocks by reference', () => {
    const contents = [toolCallContent, toolResponseContent, thinkingContent];

    const decoded = decodeHookLLMRequest({
      version: 2,
      model: 'glm-5.3',
      contents,
    });

    expect(decoded).toBeDefined();
    expect(decoded?.version).toBe(2);
    expect(decoded?.model).toBe('glm-5.3');
    expect(decoded?.contents).toBe(contents);
    expect(decoded?.contents[0]?.blocks[1]).toBe(toolCallContent.blocks[1]);
    expect(decoded?.contents[1]?.blocks[0]).toBe(toolResponseContent.blocks[0]);
    expect(decoded?.contents[2]?.blocks[0]).toBe(thinkingContent.blocks[0]);
  });

  it('accepts a missing version as v2 (no v1 fallback decode)', () => {
    const decoded = decodeHookLLMRequest({
      model: 'glm-5.3',
      contents: [{ speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] }],
    });

    expect(decoded?.version).toBe(2);
  });

  it('passes tools and settings through when provided', () => {
    const tools: ToolDeclaration[] = [
      {
        name: 'get_weather',
        parametersJsonSchema: { type: 'object' },
      },
    ];

    const decoded = decodeHookLLMRequest({
      version: 2,
      model: 'glm-5.3',
      contents: [],
      tools,
      settings: { temperature: 0.3 },
    });

    expect(decoded?.tools).toBe(tools);
    expect(decoded?.settings).toStrictEqual({ temperature: 0.3 });
  });

  it('returns undefined for a version other than 2', () => {
    expect(
      decodeHookLLMRequest({ version: 1, model: 'm', contents: [] }),
    ).toBeUndefined();
  });

  it('returns undefined when model is missing or contents is not an array', () => {
    expect(decodeHookLLMRequest({ contents: [] })).toBeUndefined();
    expect(
      decodeHookLLMRequest({ model: 'm', contents: 'not-an-array' }),
    ).toBeUndefined();
    expect(decodeHookLLMRequest(null)).toBeUndefined();
    expect(decodeHookLLMRequest('string')).toBeUndefined();
  });

  it('returns undefined when a contents element lacks the minimal IContent shape', () => {
    expect(
      decodeHookLLMRequest({
        model: 'glm-5.3',
        contents: [{ speaker: 'ai' }],
      }),
    ).toBeUndefined();
    expect(
      decodeHookLLMRequest({
        model: 'glm-5.3',
        contents: [{ blocks: [] }],
      }),
    ).toBeUndefined();
    expect(
      decodeHookLLMRequest({
        model: 'glm-5.3',
        contents: [{ speaker: 'user', blocks: [] }],
      }),
    ).toBeUndefined();
  });
});

describe('decodeHookLLMResponse', () => {
  it('decodes a v2 response passing content through by reference with optional fields', () => {
    const content: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'hook says hi' }],
    };

    const decoded = decodeHookLLMResponse({
      version: 2,
      content,
      finishReason: 'stop',
      rawStopReason: 'STOP',
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      },
    });

    expect(decoded).toBeDefined();
    expect(decoded?.version).toBe(2);
    expect(decoded?.content).toBe(content);
    expect(decoded?.finishReason).toBe('stop');
    expect(decoded?.rawStopReason).toBe('STOP');
    expect(decoded?.usage?.totalTokens).toBe(15);
  });

  it('returns undefined when content is missing or not an object', () => {
    expect(decodeHookLLMResponse({ finishReason: 'stop' })).toBeUndefined();
    expect(decodeHookLLMResponse({ content: 'plain-text' })).toBeUndefined();
    expect(decodeHookLLMResponse(undefined)).toBeUndefined();
  });

  it('returns undefined when content lacks the minimal IContent shape (fails cleanly, not downstream)', () => {
    expect(decodeHookLLMResponse({ content: {} })).toBeUndefined();
    expect(
      decodeHookLLMResponse({ content: { speaker: 'ai' } }),
    ).toBeUndefined();
    expect(decodeHookLLMResponse({ content: { blocks: [] } })).toBeUndefined();
    expect(
      decodeHookLLMResponse({ content: { speaker: 'user', blocks: [] } }),
    ).toBeUndefined();
  });

  it('returns undefined for a non-canonical finishReason', () => {
    expect(
      decodeHookLLMResponse({
        content: { speaker: 'ai', blocks: [] },
        finishReason: 'STOP',
      }),
    ).toBeUndefined();
  });

  it('returns undefined for a version other than 2', () => {
    expect(
      decodeHookLLMResponse({
        version: 1,
        content: { speaker: 'ai', blocks: [] },
      }),
    ).toBeUndefined();
  });
});

describe('decodeHookToolChoice', () => {
  it('decodes a valid toolChoice with allowedToolNames', () => {
    expect(
      decodeHookToolChoice({
        mode: 'required',
        allowedToolNames: ['a', 'b'],
      }),
    ).toStrictEqual({ mode: 'required', allowedToolNames: ['a', 'b'] });
  });

  it('returns undefined for an unknown mode or non-string allowlist', () => {
    expect(decodeHookToolChoice({ mode: 'ANY' })).toBeUndefined();
    expect(
      decodeHookToolChoice({ mode: 'auto', allowedToolNames: 'all' }),
    ).toBeUndefined();
    expect(decodeHookToolChoice(undefined)).toBeUndefined();
  });
});

describe('mergeHookLLMRequest', () => {
  const base: HookLLMRequest = {
    version: 2,
    model: 'base-model',
    contents: [{ speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] }],
    settings: { temperature: 0.1, topP: 0.9 },
  };

  it('replaces contents and tools when the override provides arrays', () => {
    const replacement: IContent[] = [{ speaker: 'human', blocks: [] }];

    const merged = mergeHookLLMRequest(base, {
      contents: replacement,
      tools: [],
    });

    expect(merged.contents).toBe(replacement);
    expect(merged.tools).toStrictEqual([]);
    expect(merged.model).toBe('base-model');
  });

  it('overrides model when the override provides a string', () => {
    expect(mergeHookLLMRequest(base, { model: 'other' }).model).toBe('other');
  });

  it('shallow-merges settings without clobbering untouched keys', () => {
    const merged = mergeHookLLMRequest(base, {
      settings: { temperature: 0.8 },
    });

    expect(merged.settings).toStrictEqual({ temperature: 0.8, topP: 0.9 });
  });

  it('leaves target fields untouched for absent or wrong-typed override fields', () => {
    const merged = mergeHookLLMRequest(base, {
      model: 42,
      contents: 'nope',
      tools: null,
    });

    expect(merged.model).toBe('base-model');
    expect(merged.contents).toBe(base.contents);
    expect(merged.tools).toBeUndefined();
    expect(merged.settings).toStrictEqual({ temperature: 0.1, topP: 0.9 });
  });

  it('returns the target unchanged for a non-object override', () => {
    expect(mergeHookLLMRequest(base, 'junk')).toBe(base);
    expect(mergeHookLLMRequest(base, null)).toBe(base);
  });
});

describe('parseHookLLMRequestBoundaryResult (v2 schema)', () => {
  it('accepts version 2 as valid', () => {
    expect(
      parseHookLLMRequestBoundaryResult({
        version: 2,
        pendingMessageStartIndex: 1,
      }),
    ).toStrictEqual({
      status: 'valid',
      boundary: { version: 2, pendingMessageStartIndex: 1 },
    });
  });

  it('treats version 1 as malformed', () => {
    expect(
      parseHookLLMRequestBoundaryResult({
        version: 1,
        pendingMessageStartIndex: 1,
      }),
    ).toStrictEqual({
      status: 'malformed',
      onInvalidBoundary: 'skip-compression',
    });
  });
});
