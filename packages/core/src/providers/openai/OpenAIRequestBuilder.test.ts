/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeToolCallArguments,
  buildToolResponseContent,
  buildMessagesWithReasoning,
  validateToolMessageSequence,
  buildContinuationMessages,
} from './OpenAIRequestBuilder.js';
import type {
  IContent,
  ToolCallBlock,
  ToolResponseBlock,
  ThinkingBlock,
} from '../../services/history/IContent.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type OpenAI from 'openai';

const createMockOptions = (
  settingsMap: Record<string, unknown> = {},
): NormalizedGenerateChatOptions =>
  ({
    settings: {
      get: (key: string) => settingsMap[key],
    },
    invocation: {
      requestId: 'test-request',
      timestamp: Date.now(),
    },
    resolved: {
      model: 'gpt-4',
      authToken: { token: 'test-token', type: 'api-key' },
    },
    metadata: {},
    config: undefined,
  }) as unknown as NormalizedGenerateChatOptions;

describe('normalizeToolCallArguments', () => {
  it('returns empty object for undefined', () => {
    expect(normalizeToolCallArguments(undefined)).toBe('{}');
  });

  it('returns empty object for null', () => {
    expect(normalizeToolCallArguments(null)).toBe('{}');
  });

  it('returns empty object for empty string', () => {
    expect(normalizeToolCallArguments('')).toBe('{}');
  });

  it('returns empty object for whitespace-only string', () => {
    expect(normalizeToolCallArguments('   ')).toBe('{}');
  });

  it('normalizes valid JSON string', () => {
    const result = normalizeToolCallArguments('{"key": "value"}');
    expect(JSON.parse(result)).toStrictEqual({ key: 'value' });
  });

  it('wraps non-object JSON in value wrapper', () => {
    const result = normalizeToolCallArguments('42');
    expect(JSON.parse(result)).toStrictEqual({ value: 42 });
  });

  it('wraps unparseable string in raw wrapper', () => {
    const result = normalizeToolCallArguments('not json');
    expect(JSON.parse(result)).toStrictEqual({ raw: 'not json' });
  });

  it('serializes object parameters', () => {
    const result = normalizeToolCallArguments({ file: 'test.ts' });
    expect(JSON.parse(result)).toStrictEqual({ file: 'test.ts' });
  });

  it('wraps array JSON in value wrapper', () => {
    const result = normalizeToolCallArguments('[1, 2, 3]');
    expect(JSON.parse(result)).toStrictEqual({ value: [1, 2, 3] });
  });

  it('wraps boolean JSON in value wrapper', () => {
    const result = normalizeToolCallArguments('true');
    expect(JSON.parse(result)).toStrictEqual({ value: true });
  });
});

describe('buildToolResponseContent', () => {
  it('produces non-empty JSON-safe string from tool response', () => {
    const block: ToolResponseBlock = {
      type: 'tool_response',
      callId: 'call_1',
      toolName: 'read_file',
      result: 'file contents here',
    };
    const result = buildToolResponseContent(block);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('includes tool name in output', () => {
    const block: ToolResponseBlock = {
      type: 'tool_response',
      callId: 'call_1',
      toolName: 'grep',
      result: 'match found',
    };
    const result = buildToolResponseContent(block);
    expect(result).toContain('grep');
  });
});

describe('buildMessagesWithReasoning', () => {
  it('converts user text to OpenAI user message', () => {
    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Hello world' }],
      },
    ];
    const options = createMockOptions({
      'reasoning.includeInContext': false,
      'reasoning.stripFromContext': 'none',
    });

    const messages = buildMessagesWithReasoning(contents, options);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(
      (messages[0] as OpenAI.Chat.ChatCompletionUserMessageParam).content,
    ).toBe('Hello world');
  });

  it('converts assistant with tool_calls to assistant message', () => {
    const contents: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_1',
            name: 'test_tool',
            parameters: { key: 'val' },
          } as ToolCallBlock,
        ],
      },
    ];
    const options = createMockOptions({
      'reasoning.includeInContext': false,
      'reasoning.stripFromContext': 'none',
    });

    const messages = buildMessagesWithReasoning(contents, options);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('assistant');
    const assistant =
      messages[0] as OpenAI.Chat.ChatCompletionAssistantMessageParam;
    expect(assistant.tool_calls).toHaveLength(1);
    expect(assistant.tool_calls![0].function.name).toBe('test_tool');
  });

  it('converts tool response to tool message with correct call ID', () => {
    const contents: IContent[] = [
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_abc',
            toolName: 'grep',
            result: 'found it',
          } as ToolResponseBlock,
        ],
      },
    ];
    const options = createMockOptions({
      'reasoning.includeInContext': false,
      'reasoning.stripFromContext': 'none',
    });

    const messages = buildMessagesWithReasoning(contents, options);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('tool');
    expect(
      (messages[0] as OpenAI.Chat.ChatCompletionToolMessageParam).tool_call_id,
    ).toBe('call_abc');
  });

  it('attaches reasoning_content when toolFormat is undefined and includeInContext is true', () => {
    const contents: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Let me analyze this...',
            isHidden: false,
            sourceField: 'reasoning_content',
          } as ThinkingBlock,
          {
            type: 'tool_call',
            id: 'call_1',
            name: 'read_file',
            parameters: { path: 'test.ts' },
          } as ToolCallBlock,
        ],
      },
    ];
    const options = createMockOptions({
      'reasoning.includeInContext': true,
      'reasoning.stripFromContext': 'none',
    });

    const messages = buildMessagesWithReasoning(contents, options);
    expect(messages).toHaveLength(1);
    const msg = messages[0] as unknown as Record<string, unknown>;
    expect(msg.reasoning_content).toBeDefined();
  });

  it('suppresses reasoning_content when toolFormat is openai', () => {
    const contents: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Let me analyze this...',
            isHidden: false,
            sourceField: 'reasoning_content',
          } as ThinkingBlock,
          {
            type: 'tool_call',
            id: 'call_1',
            name: 'read_file',
            parameters: { path: 'test.ts' },
          } as ToolCallBlock,
        ],
      },
    ];
    const options = createMockOptions({
      'reasoning.includeInContext': true,
      'reasoning.stripFromContext': 'none',
    });

    const messages = buildMessagesWithReasoning(contents, options, 'openai');
    expect(messages).toHaveLength(1);
    const msg = messages[0] as unknown as Record<string, unknown>;
    expect(msg.reasoning_content).toBeUndefined();
  });

  it('adds name field on tool messages when toolFormat is mistral', () => {
    const contents: IContent[] = [
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_m1',
            toolName: 'search',
            result: 'found',
          } as ToolResponseBlock,
        ],
      },
    ];
    const options = createMockOptions({
      'reasoning.includeInContext': false,
      'reasoning.stripFromContext': 'none',
    });

    const messages = buildMessagesWithReasoning(contents, options, 'mistral');
    expect(messages).toHaveLength(1);
    const toolMsg = messages[0] as Record<string, unknown>;
    expect(toolMsg.role).toBe('tool');
    expect(toolMsg.name).toBe('search');
  });

  it('omits name field on tool messages when toolFormat is openai', () => {
    const contents: IContent[] = [
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_o1',
            toolName: 'read_file',
            result: 'contents',
          } as ToolResponseBlock,
        ],
      },
    ];
    const options = createMockOptions({
      'reasoning.includeInContext': false,
      'reasoning.stripFromContext': 'none',
    });

    const messages = buildMessagesWithReasoning(contents, options, 'openai');
    expect(messages).toHaveLength(1);
    const toolMsg = messages[0] as Record<string, unknown>;
    expect(toolMsg.name).toBeUndefined();
  });
});

describe('validateToolMessageSequence', () => {
  it('passes through valid assistant→tool sequence', () => {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'test', arguments: '{}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'result' },
    ];

    const validated = validateToolMessageSequence(messages);
    expect(validated).toHaveLength(2);
    expect(validated[0].role).toBe('assistant');
    expect(validated[1].role).toBe('tool');
  });

  it('removes orphan tool messages with mismatched IDs', () => {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'test', arguments: '{}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_WRONG', content: 'result' },
    ];

    const validated = validateToolMessageSequence(messages);
    expect(validated).toHaveLength(1);
    expect(validated[0].role).toBe('assistant');
  });

  it('preserves user and system messages', () => {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'user', content: 'hello' },
      { role: 'system', content: 'you are helpful' },
    ];

    const validated = validateToolMessageSequence(messages);
    expect(validated).toHaveLength(2);
  });

  it('preserves multiple valid tool responses for same assistant', () => {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'a', arguments: '{}' },
          },
          {
            id: 'call_2',
            type: 'function',
            function: { name: 'b', arguments: '{}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'result1' },
      { role: 'tool', tool_call_id: 'call_2', content: 'result2' },
    ];

    const validated = validateToolMessageSequence(messages);
    expect(validated).toHaveLength(3);
  });
});

describe('buildContinuationMessages', () => {
  const toolCalls = [
    {
      id: 'call_1',
      type: 'function' as const,
      function: { name: 'test_tool', arguments: '{}' },
    },
  ];

  it('includes original history plus continuation', () => {
    const existingMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'user', content: 'do something' },
    ];
    const result = buildContinuationMessages(
      toolCalls,
      existingMessages,
      'openai',
    );
    expect(result.length).toBeGreaterThan(existingMessages.length);
    expect(result[0].role).toBe('user');
    expect(result[0]).toStrictEqual(existingMessages[0]);
  });

  it('strips reasoning_content from assistant messages in history', () => {
    const existingMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: 'assistant',
        content: 'I analyzed the code',
        reasoning_content: 'deep thoughts',
      } as unknown as OpenAI.Chat.ChatCompletionMessageParam,
    ];
    const result = buildContinuationMessages(
      toolCalls,
      existingMessages,
      'openai',
    );
    const assistantInHistory = result[0] as unknown as Record<string, unknown>;
    expect(assistantInHistory.reasoning_content).toBeUndefined();
    expect(assistantInHistory.content).toBe('I analyzed the code');
  });

  it('adds name field to tool messages when mistral format', () => {
    const existingMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'user', content: 'do something' },
    ];
    const result = buildContinuationMessages(
      toolCalls,
      existingMessages,
      'mistral',
    );
    const toolMsg = result.find((m) => m.role === 'tool') as Record<
      string,
      unknown
    >;
    expect(toolMsg).toBeDefined();
    expect(toolMsg.name).toBe('test_tool');
  });

  it('omits name field from tool messages when openai format', () => {
    const existingMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'user', content: 'do something' },
    ];
    const result = buildContinuationMessages(
      toolCalls,
      existingMessages,
      'openai',
    );
    const toolMsg = result.find((m) => m.role === 'tool') as Record<
      string,
      unknown
    >;
    expect(toolMsg).toBeDefined();
    expect(toolMsg.name).toBeUndefined();
  });

  it('ends with a user continuation prompt', () => {
    const existingMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'user', content: 'do something' },
    ];
    const result = buildContinuationMessages(
      toolCalls,
      existingMessages,
      'openai',
    );
    const lastMsg = result[result.length - 1];
    expect(lastMsg.role).toBe('user');
  });
});
