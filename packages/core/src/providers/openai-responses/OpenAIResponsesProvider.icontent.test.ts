/**
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider.js';
import type { IContent } from '../../services/history/IContent.js';
// import type { ITool } from '../ITool.js';
import { ContentGeneratorRole } from '../ContentGeneratorRole.js';

describe('OpenAIResponsesProvider IContent Integration', () => {
  let provider: OpenAIResponsesProvider;

  beforeEach(() => {
    provider = new OpenAIResponsesProvider('test-api-key');
  });

  describe('generateChatCompletionIContent', () => {
    it('should convert IContent to IMessage format correctly', async () => {
      const mockResponse = {
        role: ContentGeneratorRole.ASSISTANT,
        content: 'Test response',
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };

      // Mock the generateChatCompletion method
      vi.spyOn(
        provider as unknown as {
          generateChatCompletion: () => AsyncIterableIterator<unknown>;
        },
        'generateChatCompletion',
      ).mockImplementation(async function* () {
        yield mockResponse;
      });

      const input: IContent[] = [
        {
          speaker: 'human',
          blocks: [
            {
              type: 'text',
              text: 'Hello, how are you?',
            },
          ],
        },
      ];

      const results: IContent[] = [];
      for await (const chunk of provider.generateChatCompletionIContent(
        input,
      )) {
        results.push(chunk);
      }

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        speaker: 'ai',
        blocks: [
          {
            type: 'text',
            text: 'Test response',
          },
        ],
        metadata: {
          usage: {
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
          },
        },
      });
    });

    it('should handle tool calls correctly with hist_tool_ prefix conversion', async () => {
      const mockResponse = {
        role: ContentGeneratorRole.ASSISTANT,
        content: '',
        tool_calls: [
          {
            id: 'call_123',
            type: 'function',
            function: {
              name: 'test_function',
              arguments: '{"param": "value"}',
            },
          },
        ],
      };

      vi.spyOn(
        provider as unknown as {
          generateChatCompletion: () => AsyncIterableIterator<unknown>;
        },
        'generateChatCompletion',
      ).mockImplementation(async function* () {
        yield mockResponse;
      });

      const input: IContent[] = [
        {
          speaker: 'human',
          blocks: [
            {
              type: 'text',
              text: 'Use a tool',
            },
          ],
        },
      ];

      const results: IContent[] = [];
      for await (const chunk of provider.generateChatCompletionIContent(
        input,
      )) {
        results.push(chunk);
      }

      expect(results).toHaveLength(1);
      expect(results[0].speaker).toBe('ai');
      expect(results[0].blocks).toHaveLength(1);
      expect(results[0].blocks[0]).toEqual({
        type: 'tool_call',
        id: 'hist_tool_123', // Should be converted from call_123
        name: 'test_function',
        parameters: { param: 'value' },
      });
    });

    it('should handle streaming text correctly', async () => {
      vi.spyOn(
        provider as unknown as {
          generateChatCompletion: () => AsyncIterableIterator<unknown>;
        },
        'generateChatCompletion',
      ).mockImplementation(async function* () {
        yield 'Hello ';
        yield 'world!';
      });

      const input: IContent[] = [
        {
          speaker: 'human',
          blocks: [
            {
              type: 'text',
              text: 'Say hello',
            },
          ],
        },
      ];

      const results: IContent[] = [];
      for await (const chunk of provider.generateChatCompletionIContent(
        input,
      )) {
        results.push(chunk);
      }

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Hello ' }],
      });
      expect(results[1]).toEqual({
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'world!' }],
      });
    });

    it('should convert tool responses with hist_tool_ prefix back to call_', async () => {
      const mockResponse = {
        role: ContentGeneratorRole.ASSISTANT,
        content: 'Tool executed successfully',
      };

      const mockGenerateChatCompletion = vi
        .fn()
        .mockImplementation(async function* (messages: unknown) {
          // Verify that tool response call_id was converted correctly
          const toolMessage = (
            messages as Array<{ role: string; tool_call_id?: string }>
          ).find((m) => m.role === ContentGeneratorRole.TOOL);
          expect(toolMessage?.tool_call_id).toBe('call_456');
          yield mockResponse;
        });

      vi.spyOn(
        provider as unknown as {
          generateChatCompletion: () => AsyncIterableIterator<unknown>;
        },
        'generateChatCompletion',
      ).mockImplementation(mockGenerateChatCompletion);

      const input: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'hist_tool_456',
              name: 'search',
              parameters: { query: 'test' },
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'hist_tool_456',
              toolName: 'search',
              result: { output: 'Search results' },
            },
          ],
        },
      ];

      const results: IContent[] = [];
      for await (const chunk of provider.generateChatCompletionIContent(
        input,
      )) {
        results.push(chunk);
      }

      expect(mockGenerateChatCompletion).toHaveBeenCalled();
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Tool executed successfully' }],
      });
    });

    it('should accumulate tool calls during streaming', async () => {
      const toolFormatter = (
        provider as unknown as {
          toolFormatter: {
            accumulateStreamingToolCall: (...args: unknown[]) => void;
          };
        }
      ).toolFormatter;
      const mockAccumulate = vi.spyOn(
        toolFormatter,
        'accumulateStreamingToolCall',
      );

      vi.spyOn(
        provider as unknown as {
          generateChatCompletion: () => AsyncIterableIterator<unknown>;
        },
        'generateChatCompletion',
      ).mockImplementation(async function* () {
        // Stream partial tool call
        yield {
          role: ContentGeneratorRole.ASSISTANT,
          content: '',
          tool_calls: [
            {
              id: 'call_789',
              type: 'function',
              function: {
                name: 'partial_func',
                arguments: '{"test":',
              },
            },
          ],
        };
        // Complete the tool call
        yield {
          role: ContentGeneratorRole.ASSISTANT,
          content: '',
          tool_calls: [
            {
              id: 'call_789',
              type: 'function',
              function: {
                name: 'partial_func',
                arguments: '"value"}',
              },
            },
          ],
        };
      });

      const input: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Use streaming tool' }],
        },
      ];

      const results: IContent[] = [];
      for await (const chunk of provider.generateChatCompletionIContent(
        input,
      )) {
        results.push(chunk);
      }

      // Tool formatter should have been called to accumulate
      expect(mockAccumulate).toHaveBeenCalled();

      // Final result should have complete tool call with hist_tool_ prefix
      expect(results).toHaveLength(1);
      const lastResult = results[results.length - 1];
      expect(lastResult.blocks).toHaveLength(1);
      expect(lastResult.blocks[0].type).toBe('tool_call');
    });
  });
});
