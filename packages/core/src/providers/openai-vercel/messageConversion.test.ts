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

/**
 * @plan PLAN-20251127-OPENAIVERCEL.P05
 * @requirement REQ-OAV-MC-001 - Convert IContent to Vercel CoreMessage
 * @requirement REQ-OAV-MC-002 - Convert CoreMessage to IContent
 * @requirement REQ-OAV-MC-003 - Handle all message types (user, assistant, tool, system)
 * @requirement REQ-OAV-MC-004 - Handle tool calls and tool responses
 * @requirement REQ-OAV-MC-005 - Handle mixed content (text + tool calls)
 */

import { describe, it, expect } from 'vitest';
import type {
  UserModelMessage,
  AssistantModelMessage,
  ToolModelMessage,
  SystemModelMessage,
} from '@ai-sdk/provider-utils';
import type {
  IContent,
  TextBlock,
  ToolCallBlock,
  ToolResponseBlock,
  MediaBlock,
} from '../../services/history/IContent.js';
import {
  convertToVercelMessages,
  convertFromVercelMessages,
} from './messageConversion.js';

describe('messageConversion', () => {
  describe('convertToVercelMessages', () => {
    describe('human/user messages', () => {
      it('should convert simple human text message to UserMessage', () => {
        const contents: IContent[] = [
          {
            speaker: 'human',
            blocks: [
              {
                type: 'text',
                text: 'Hello, how are you?',
              } satisfies TextBlock,
            ],
          },
        ];

        const result = convertToVercelMessages(contents);

        expect(result).toHaveLength(1);
        const message = result[0] as UserModelMessage;
        expect(message.role).toBe('user');
        expect(message.content).toBe('Hello, how are you?');
      });

      it('should combine multiple text blocks into single user message', () => {
        const contents: IContent[] = [
          {
            speaker: 'human',
            blocks: [
              {
                type: 'text',
                text: 'First line',
              } satisfies TextBlock,
              {
                type: 'text',
                text: 'Second line',
              } satisfies TextBlock,
            ],
          },
        ];

        const result = convertToVercelMessages(contents);

        expect(result).toHaveLength(1);
        const message = result[0] as UserModelMessage;
        expect(message.role).toBe('user');
        expect(message.content).toBe('First line\nSecond line');
      });

      it('should skip empty text blocks in user messages', () => {
        const contents: IContent[] = [
          {
            speaker: 'human',
            blocks: [
              {
                type: 'text',
                text: '',
              } satisfies TextBlock,
              {
                type: 'text',
                text: 'Valid text',
              } satisfies TextBlock,
            ],
          },
        ];

        const result = convertToVercelMessages(contents);

        expect(result).toHaveLength(1);
        const message = result[0] as UserModelMessage;
        expect(message.content).toBe('Valid text');
      });

      it('should convert media image blocks to Vercel image parts', () => {
        const contents: IContent[] = [
          {
            speaker: 'human',
            blocks: [
              { type: 'text', text: 'See image' } satisfies TextBlock,
              {
                type: 'media',
                mimeType: 'image/png',
                data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ',
                encoding: 'base64',
              } satisfies MediaBlock,
            ],
          },
        ];

        const result = convertToVercelMessages(contents);
        expect(result).toHaveLength(1);

        const message = result[0] as UserModelMessage;
        expect(Array.isArray(message.content)).toBe(true);
        const parts = message.content as unknown[];
        const imagePart = parts.find(
          (part) =>
            typeof part === 'object' &&
            part !== null &&
            part['type'] === 'image',
        ) as { image?: string } | undefined;
        expect(imagePart?.image).toContain('base64');
      });
    });

    describe('ai/assistant messages', () => {
      it('should convert simple AI text message to AssistantMessage', () => {
        const contents: IContent[] = [
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'text',
                text: 'I am doing well, thank you!',
              } satisfies TextBlock,
            ],
          },
        ];

        const result = convertToVercelMessages(contents);

        expect(result).toHaveLength(1);
        const message = result[0] as AssistantModelMessage;
        expect(message.role).toBe('assistant');
        expect(message.content).toBe('I am doing well, thank you!');
      });

      it('should convert AI message with tool calls to AssistantMessage with tool-call parts', () => {
        const contents: IContent[] = [
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: 'call_123',
                name: 'get_weather',
                input: { city: 'London' },
              } satisfies ToolCallBlock,
            ],
          },
        ];

        const result = convertToVercelMessages(contents);

        expect(result).toHaveLength(1);
        const message = result[0] as AssistantModelMessage;
        expect(message.role).toBe('assistant');
        expect(Array.isArray(message.content)).toBe(true);

        const content = message.content as unknown[];
        expect(content).toHaveLength(1);
        expect(content[0]).toMatchObject({
          type: 'tool-call',
          toolCallId: 'call_123',
          toolName: 'get_weather',
          input: { city: 'London' },
        });
      });

      it('should convert AI message with multiple tool calls', () => {
        const contents: IContent[] = [
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: 'call_1',
                name: 'get_weather',
                input: { city: 'London' },
              } satisfies ToolCallBlock,
              {
                type: 'tool_call',
                id: 'call_2',
                name: 'get_time',
                input: { timezone: 'UTC' },
              } satisfies ToolCallBlock,
            ],
          },
        ];

        const result = convertToVercelMessages(contents);

        expect(result).toHaveLength(1);
        const message = result[0] as AssistantModelMessage;
        expect(message.role).toBe('assistant');

        const content = message.content as unknown[];
        expect(content).toHaveLength(2);
        expect(content[0].type).toBe('tool-call');
        expect(content[0].toolCallId).toBe('call_1');
        expect(content[1].type).toBe('tool-call');
        expect(content[1].toolCallId).toBe('call_2');
      });

      it('should convert AI message with mixed text and tool calls', () => {
        const contents: IContent[] = [
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'text',
                text: 'Let me check the weather for you.',
              } satisfies TextBlock,
              {
                type: 'tool_call',
                id: 'call_123',
                name: 'get_weather',
                input: { city: 'London' },
              } satisfies ToolCallBlock,
            ],
          },
        ];

        const result = convertToVercelMessages(contents);

        expect(result).toHaveLength(1);
        const message = result[0] as AssistantModelMessage;
        expect(message.role).toBe('assistant');

        const content = message.content as unknown[];
        expect(content).toHaveLength(2);
        expect(content[0]).toMatchObject({
          type: 'text',
          text: 'Let me check the weather for you.',
        });
        expect(content[1]).toMatchObject({
          type: 'tool-call',
          toolCallId: 'call_123',
          toolName: 'get_weather',
        });
      });

      it('should handle AI message with empty text block and tool call', () => {
        const contents: IContent[] = [
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'text',
                text: '',
              } satisfies TextBlock,
              {
                type: 'tool_call',
                id: 'call_123',
                name: 'get_weather',
                input: { city: 'London' },
              } satisfies ToolCallBlock,
            ],
          },
        ];

        const result = convertToVercelMessages(contents);

        expect(result).toHaveLength(1);
        const message = result[0] as AssistantModelMessage;
        const content = message.content as unknown[];

        // Empty text should not be included
        expect(content).toHaveLength(1);
        expect(content[0].type).toBe('tool-call');
      });
    });

    describe('tool messages', () => {
      it('should convert tool response message to ToolMessage', () => {
        const contents: IContent[] = [
          {
            speaker: 'tool',
            blocks: [
              {
                type: 'tool_response',
                callId: 'hist_tool_123',
                toolName: 'get_weather',
                result: { temperature: 72, condition: 'sunny' },
              } satisfies ToolResponseBlock,
            ],
          },
        ];

        const result = convertToVercelMessages(contents);

        expect(result).toHaveLength(1);
        const message = result[0] as ToolModelMessage;
        expect(message.role).toBe('tool');
        expect(Array.isArray(message.content)).toBe(true);

        const content = message.content as unknown[];
        expect(content).toHaveLength(1);
        expect(content[0]).toMatchObject({
          type: 'tool-result',
          toolCallId: 'call_123',
          toolName: 'get_weather',
          output: {
            type: 'text',
            value: '{"temperature":72,"condition":"sunny"}',
          },
        });
      });

      it('should convert tool message with multiple responses', () => {
        const contents: IContent[] = [
          {
            speaker: 'tool',
            blocks: [
              {
                type: 'tool_response',
                callId: 'hist_tool_1',
                toolName: 'get_weather',
                result: { temperature: 72 },
              } satisfies ToolResponseBlock,
              {
                type: 'tool_response',
                callId: 'hist_tool_2',
                toolName: 'get_time',
                result: { time: '14:30' },
              } satisfies ToolResponseBlock,
            ],
          },
        ];

        const result = convertToVercelMessages(contents);

        expect(result).toHaveLength(1);
        const message = result[0] as ToolModelMessage;
        expect(message.role).toBe('tool');

        const content = message.content as unknown[];
        expect(content).toHaveLength(2);
        expect(content[0].toolCallId).toBe('call_1');
        expect(content[1].toolCallId).toBe('call_2');
      });

      it('should handle tool response with error result', () => {
        const contents: IContent[] = [
          {
            speaker: 'tool',
            blocks: [
              {
                type: 'tool_response',
                callId: 'hist_tool_123',
                toolName: 'get_weather',
                result: { error: 'City not found' },
              } satisfies ToolResponseBlock,
            ],
          },
        ];

        const result = convertToVercelMessages(contents);

        expect(result).toHaveLength(1);
        const message = result[0] as ToolModelMessage;
        const content = message.content as unknown[];
        expect(content[0].output).toEqual({
          type: 'text',
          value: '{"error":"City not found"}',
        });
      });
    });

    describe('system messages', () => {
      it('should convert system message from IContent', () => {
        // Note: IContent doesn't have a 'system' speaker, but we may need to handle it
        // if we extend the format. For now, test how we'd handle it via metadata or convention.
        const contents: IContent[] = [
          {
            speaker: 'ai', // Using AI speaker with metadata to indicate system
            blocks: [
              {
                type: 'text',
                text: 'You are a helpful assistant.',
              } satisfies TextBlock,
            ],
            metadata: {
              role: 'system',
            },
          },
        ];

        const result = convertToVercelMessages(contents);

        expect(result).toHaveLength(1);
        const message = result[0] as SystemModelMessage;
        expect(message.role).toBe('system');
        expect(message.content).toBe('You are a helpful assistant.');
      });
    });

    describe('edge cases', () => {
      it('should handle empty content array', () => {
        const contents: IContent[] = [];
        const result = convertToVercelMessages(contents);
        expect(result).toEqual([]);
      });

      it('should handle content with empty blocks array', () => {
        const contents: IContent[] = [
          {
            speaker: 'human',
            blocks: [],
          },
        ];

        const result = convertToVercelMessages(contents);

        // Should not create a message for empty blocks
        expect(result).toEqual([]);
      });

      it('should handle multiple consecutive messages of same type', () => {
        const contents: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Hello' } satisfies TextBlock],
          },
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'Hi there' } satisfies TextBlock],
          },
          {
            speaker: 'human',
            blocks: [
              { type: 'text', text: 'How are you?' } satisfies TextBlock,
            ],
          },
        ];

        const result = convertToVercelMessages(contents);

        expect(result).toHaveLength(3);
        expect(result[0].role).toBe('user');
        expect(result[1].role).toBe('assistant');
        expect(result[2].role).toBe('user');
      });

      it('should handle tool call with complex nested input', () => {
        const contents: IContent[] = [
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: 'call_complex',
                name: 'complex_tool',
                input: {
                  nested: {
                    array: [1, 2, 3],
                    object: { key: 'value' },
                  },
                  nullValue: null,
                  boolValue: true,
                },
              } satisfies ToolCallBlock,
            ],
          },
        ];

        const result = convertToVercelMessages(contents);

        expect(result).toHaveLength(1);
        const message = result[0] as AssistantModelMessage;
        const content = message.content as unknown[];
        expect(content[0].input).toEqual({
          nested: {
            array: [1, 2, 3],
            object: { key: 'value' },
          },
          nullValue: null,
          boolValue: true,
        });
      });

      it('should handle tool response with undefined result', () => {
        const contents: IContent[] = [
          {
            speaker: 'tool',
            blocks: [
              {
                type: 'tool_response',
                id: 'call_123',
                name: 'void_tool',
                result: undefined,
              } satisfies ToolResponseBlock,
            ],
          },
        ];

        const result = convertToVercelMessages(contents);

        expect(result).toHaveLength(1);
        const message = result[0] as ToolModelMessage;
        const content = message.content as unknown[];
        expect(content[0].output).toEqual({
          type: 'text',
          value: '[no tool result]',
        });
      });
    });
  });

  describe('convertFromVercelMessages', () => {
    describe('UserMessage to IContent', () => {
      it('should convert UserMessage to human IContent', () => {
        const messages: UserModelMessage[] = [
          {
            role: 'user',
            content: 'Hello, AI!',
          },
        ];

        const result = convertFromVercelMessages(messages);

        expect(result).toHaveLength(1);
        expect(result[0].speaker).toBe('human');
        expect(result[0].blocks).toHaveLength(1);
        expect(result[0].blocks[0]).toMatchObject({
          type: 'text',
          text: 'Hello, AI!',
        });
      });
    });

    describe('AssistantMessage to IContent', () => {
      it('should convert simple AssistantMessage to AI IContent', () => {
        const messages: AssistantModelMessage[] = [
          {
            role: 'assistant',
            content: 'Hello, human!',
          },
        ];

        const result = convertFromVercelMessages(messages);

        expect(result).toHaveLength(1);
        expect(result[0].speaker).toBe('ai');
        expect(result[0].blocks).toHaveLength(1);
        expect(result[0].blocks[0]).toMatchObject({
          type: 'text',
          text: 'Hello, human!',
        });
      });

      it('should convert AssistantMessage with tool calls to AI IContent with ToolCallBlocks', () => {
        const messages: AssistantModelMessage[] = [
          {
            role: 'assistant',
            content: [
              {
                type: 'tool-call',
                toolCallId: 'call_123',
                toolName: 'get_weather',
                input: { city: 'Paris' },
              },
            ],
          },
        ];

        const result = convertFromVercelMessages(messages);

        expect(result).toHaveLength(1);
        expect(result[0].speaker).toBe('ai');
        expect(result[0].blocks).toHaveLength(1);
        expect(result[0].blocks[0]).toMatchObject({
          type: 'tool_call',
          id: 'hist_tool_123',
          name: 'get_weather',
          input: { city: 'Paris' },
        });
      });

      it('should convert AssistantMessage with mixed content', () => {
        const messages: AssistantModelMessage[] = [
          {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: 'Let me check that for you.',
              },
              {
                type: 'tool-call',
                toolCallId: 'call_456',
                toolName: 'search',
                input: { query: 'weather' },
              },
            ],
          },
        ];

        const result = convertFromVercelMessages(messages);

        expect(result).toHaveLength(1);
        expect(result[0].speaker).toBe('ai');
        expect(result[0].blocks).toHaveLength(2);
        expect(result[0].blocks[0]).toMatchObject({
          type: 'text',
          text: 'Let me check that for you.',
        });
        expect(result[0].blocks[1]).toMatchObject({
          type: 'tool_call',
          id: 'hist_tool_456',
          name: 'search',
        });
      });
    });

    describe('ToolMessage to IContent', () => {
      it('should convert ToolMessage to tool IContent', () => {
        const messages: ToolModelMessage[] = [
          {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: 'call_123',
                toolName: 'get_weather',
                output: { temperature: 20 },
              },
            ],
          },
        ];

        const result = convertFromVercelMessages(messages);

        expect(result).toHaveLength(1);
        expect(result[0].speaker).toBe('tool');
        expect(result[0].blocks).toHaveLength(1);
        expect(result[0].blocks[0]).toMatchObject({
          type: 'tool_response',
          callId: 'hist_tool_123',
          toolName: 'get_weather',
          result: { temperature: 20 },
        });
      });

      it('should convert ToolMessage with multiple results', () => {
        const messages: ToolModelMessage[] = [
          {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: 'call_1',
                toolName: 'tool_a',
                output: { result: 'A' },
              },
              {
                type: 'tool-result',
                toolCallId: 'call_2',
                toolName: 'tool_b',
                output: { result: 'B' },
              },
            ],
          },
        ];

        const result = convertFromVercelMessages(messages);

        expect(result).toHaveLength(1);
        expect(result[0].speaker).toBe('tool');
        expect(result[0].blocks).toHaveLength(2);
        expect(result[0].blocks[0]).toMatchObject({
          type: 'tool_response',
          callId: 'hist_tool_1',
          toolName: 'tool_a',
        });
        expect(result[0].blocks[1]).toMatchObject({
          type: 'tool_response',
          callId: 'hist_tool_2',
          toolName: 'tool_b',
        });
      });
    });

    describe('SystemMessage to IContent', () => {
      it('should convert SystemMessage to IContent with system metadata', () => {
        const messages: SystemModelMessage[] = [
          {
            role: 'system',
            content: 'You are a helpful assistant.',
          },
        ];

        const result = convertFromVercelMessages(messages);

        expect(result).toHaveLength(1);
        expect(result[0].blocks).toHaveLength(1);
        expect(result[0].blocks[0]).toMatchObject({
          type: 'text',
          text: 'You are a helpful assistant.',
        });
        expect(result[0].metadata?.role).toBe('system');
      });
    });

    describe('edge cases', () => {
      it('should handle empty messages array', () => {
        const messages: CoreMessage[] = [];
        const result = convertFromVercelMessages(messages);
        expect(result).toEqual([]);
      });

      it('should handle mixed message types', () => {
        const messages: Array<UserModelMessage | AssistantModelMessage> = [
          {
            role: 'user',
            content: 'Hello',
          },
          {
            role: 'assistant',
            content: 'Hi there',
          },
        ];

        const result = convertFromVercelMessages(messages);

        expect(result).toHaveLength(2);
        expect(result[0].speaker).toBe('human');
        expect(result[1].speaker).toBe('ai');
      });
    });
  });

  describe('round-trip conversion', () => {
    it('should preserve data through IContent -> Vercel -> IContent conversion', () => {
      const original: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' } satisfies TextBlock],
        },
        {
          speaker: 'ai',
          blocks: [
            { type: 'text', text: 'Hi' } satisfies TextBlock,
            {
              type: 'tool_call',
              id: 'hist_tool_1',
              name: 'search',
              parameters: { q: 'test' },
            } satisfies ToolCallBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'hist_tool_1',
              toolName: 'search',
              result: { found: true },
            } satisfies ToolResponseBlock,
          ],
        },
      ];

      const vercelMessages = convertToVercelMessages(original);
      const roundTrip = convertFromVercelMessages(vercelMessages);

      expect(roundTrip).toHaveLength(3);
      expect(roundTrip[0].speaker).toBe('human');
      expect(roundTrip[1].speaker).toBe('ai');
      expect(roundTrip[2].speaker).toBe('tool');

      // Verify blocks are preserved
      expect(roundTrip[0].blocks[0]).toMatchObject({
        type: 'text',
        text: 'Hello',
      });
      expect(roundTrip[1].blocks[0]).toMatchObject({
        type: 'text',
        text: 'Hi',
      });
      expect(roundTrip[1].blocks[1]).toMatchObject({
        type: 'tool_call',
        id: 'hist_tool_1',
        name: 'search',
        parameters: { q: 'test' },
      });
      expect(roundTrip[2].blocks[0]).toMatchObject({
        type: 'tool_response',
        callId: 'hist_tool_1',
        toolName: 'search',
        result: { found: true },
      });
    });
  });
});
