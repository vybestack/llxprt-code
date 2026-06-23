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

import { describe, it, expect, beforeEach } from 'vitest';
import { HistoryService } from './HistoryService.js';
import type { IContent, ToolResponseBlock } from './IContent.js';
import {
  createUserMessage as createUserMessageFromIContent,
  createToolResponse as createToolResponseFromIContent,
} from './IContent.js';

const createUserMessage = createUserMessageFromIContent;
const createToolResponse = createToolResponseFromIContent;

describe('HistoryService - Behavioral Tests', () => {
  let service: HistoryService;

  beforeEach(() => {
    service = new HistoryService();
  });

  describe('Realistic Conversation Flow', () => {
    it('should handle a complete tool-use conversation flow', () => {
      // 1. User asks to read a file
      const userRequest = createUserMessage(
        'Please read the file at /tmp/example.txt and summarize its contents',
        { timestamp: Date.now() },
      );

      service.add(userRequest);

      // 2. AI responds with acknowledgment and tool call
      const aiToolCall: IContent = {
        speaker: 'ai',
        blocks: [
          {
            type: 'text',
            text: "I'll read the file for you.",
          },
          {
            type: 'tool_call',
            id: 'call_123',
            name: 'read_file',
            parameters: { path: '/tmp/example.txt' },
          },
        ],
        metadata: {
          model: 'gpt-4',
          timestamp: Date.now(),
        },
      };

      service.add(aiToolCall);

      // 3. Tool responds with file contents
      const toolResponse = createToolResponse(
        'call_123',
        'read_file',
        {
          content:
            'This is a test file.\nIt contains sample data.\nEnd of file.',
        },
        undefined,
        { timestamp: Date.now() },
      );

      service.add(toolResponse);

      // 4. AI provides summary based on tool response
      const aiSummary: IContent = {
        speaker: 'ai',
        blocks: [
          {
            type: 'text',
            text: 'The file contains three lines of text. It appears to be a test file with sample data.',
          },
        ],
        metadata: {
          model: 'gpt-4',
          timestamp: Date.now(),
          usage: {
            promptTokens: 50,
            completionTokens: 20,
            totalTokens: 70,
          },
        },
      };

      service.add(aiSummary);

      // Verify the conversation flow
      const history = service.getAll();
      expect(history).toHaveLength(4);
      expect(history[0].speaker).toBe('human');
      expect(history[1].speaker).toBe('ai');
      expect(history[2].speaker).toBe('tool');
      expect(history[3].speaker).toBe('ai');

      // Verify tool call matching
      const unmatchedCalls = service.findUnmatchedToolCalls();
      expect(unmatchedCalls).toHaveLength(0);
    });

    it('should handle multiple tool calls in sequence', () => {
      // User asks for multiple operations
      const userRequest: IContent = {
        speaker: 'human',
        blocks: [
          {
            type: 'text',
            text: 'List the files in /tmp, then read config.json',
          },
        ],
      };

      service.add(userRequest);

      // AI makes first tool call
      const aiFirstCall: IContent = {
        speaker: 'ai',
        blocks: [
          {
            type: 'text',
            text: "I'll list the files and then read config.json.",
          },
          {
            type: 'tool_call',
            id: 'call_001',
            name: 'list_directory',
            parameters: { path: '/tmp' },
          },
        ],
      };

      service.add(aiFirstCall);

      // First tool response
      const firstToolResponse: IContent = {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_001',
            toolName: 'list_directory',
            result: {
              files: ['config.json', 'data.txt', 'backup.zip'],
            },
          },
        ],
      };

      service.add(firstToolResponse);

      // AI makes second tool call based on first response
      const aiSecondCall: IContent = {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_002',
            name: 'read_file',
            parameters: { path: '/tmp/config.json' },
          },
        ],
      };

      service.add(aiSecondCall);

      // Second tool response
      const secondToolResponse: IContent = {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_002',
            toolName: 'read_file',
            result: {
              content: '{"version": "1.0", "debug": true}',
            },
          },
        ],
      };

      service.add(secondToolResponse);

      // AI final response
      const aiFinalResponse: IContent = {
        speaker: 'ai',
        blocks: [
          {
            type: 'text',
            text: 'I found 3 files in /tmp: config.json, data.txt, and backup.zip. The config.json file contains version 1.0 configuration with debug mode enabled.',
          },
        ],
      };

      service.add(aiFinalResponse);

      // Verify conversation flow
      const history = service.getAll();
      expect(history).toHaveLength(6);

      // Verify no unmatched tool calls
      const unmatchedCalls = service.findUnmatchedToolCalls();
      expect(unmatchedCalls).toHaveLength(0);
    });

    it('should handle parallel tool calls', () => {
      const userRequest = createUserMessage(
        'Check the weather in NYC and London',
      );

      service.add(userRequest);

      // AI makes parallel tool calls
      const aiParallelCalls: IContent = {
        speaker: 'ai',
        blocks: [
          {
            type: 'text',
            text: "I'll check the weather in both cities for you.",
          },
          {
            type: 'tool_call',
            id: 'call_nyc',
            name: 'get_weather',
            parameters: { city: 'New York' },
          },
          {
            type: 'tool_call',
            id: 'call_london',
            name: 'get_weather',
            parameters: { city: 'London' },
          },
        ],
      };

      service.add(aiParallelCalls);

      // Both tool responses
      service.add(
        createToolResponse('call_nyc', 'get_weather', {
          temp: 72,
          condition: 'Sunny',
        }),
      );

      service.add(
        createToolResponse('call_london', 'get_weather', {
          temp: 15,
          condition: 'Rainy',
        }),
      );

      // AI summarizes both results
      const aiSummary: IContent = {
        speaker: 'ai',
        blocks: [
          {
            type: 'text',
            text: 'Weather update:\n- New York: 72°F and sunny\n- London: 15°C and rainy',
          },
        ],
      };

      service.add(aiSummary);

      // Verify all tool calls are matched
      const unmatchedCalls = service.findUnmatchedToolCalls();
      expect(unmatchedCalls).toHaveLength(0);

      // Verify history length
      expect(service.length()).toBe(5);
    });

    it('should handle failed tool calls', () => {
      const userRequest = createUserMessage(
        'Read the file at /nonexistent/file.txt',
      );

      service.add(userRequest);

      // AI attempts to read file
      const aiToolCall: IContent = {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_fail',
            name: 'read_file',
            parameters: { path: '/nonexistent/file.txt' },
          },
        ],
      };

      service.add(aiToolCall);

      // Tool returns error
      const toolError = createToolResponse(
        'call_fail',
        'read_file',
        null,
        'File not found: /nonexistent/file.txt',
      );

      service.add(toolError);

      // AI handles the error
      const aiErrorResponse: IContent = {
        speaker: 'ai',
        blocks: [
          {
            type: 'text',
            text: "I couldn't read the file because it doesn't exist at /nonexistent/file.txt. Please check the file path.",
          },
        ],
      };

      service.add(aiErrorResponse);

      // Verify error handling
      const history = service.getAll();
      expect(history).toHaveLength(4);

      // Check that tool response has error
      const toolResponseContent = history[2];
      expect(toolResponseContent.speaker).toBe('tool');
      const toolBlock = toolResponseContent.blocks[0] as ToolResponseBlock;
      expect(toolBlock.error).toBe('File not found: /nonexistent/file.txt');
    });

    it('should handle mixed content types', () => {
      // User sends text with code
      const userRequest: IContent = {
        speaker: 'human',
        blocks: [
          {
            type: 'text',
            text: 'Can you fix this Python function?',
          },
          {
            type: 'code',
            code: 'def add(a, b):\n    return a + b',
            language: 'python',
          },
        ],
      };

      service.add(userRequest);

      // AI responds with explanation and fixed code
      const aiResponse: IContent = {
        speaker: 'ai',
        blocks: [
          {
            type: 'text',
            text: 'The function looks correct, but here it is with type hints:',
          },
          {
            type: 'code',
            code: 'def add(a: float, b: float) -> float:\n    return a + b',
            language: 'python',
          },
        ],
      };

      service.add(aiResponse);

      // Verify mixed content handling
      const history = service.getAll();
      expect(history).toHaveLength(2);
      expect(history[0].blocks).toHaveLength(2);
      expect(history[1].blocks).toHaveLength(2);
    });
  });

  describe('History Management', () => {
    it('should return curated history without empty or invalid content', () => {
      // Add valid content
      service.add(createUserMessage('Hello'));

      // Add empty content
      service.add({
        speaker: 'ai',
        blocks: [{ type: 'text', text: '' }],
      });

      // Add valid AI response
      service.add({
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Hi there!' }],
      });

      // Get curated history
      const curated = service.getCurated();
      expect(curated).toHaveLength(2);
      expect(curated[0].blocks[0]).toMatchObject({
        type: 'text',
        text: 'Hello',
      });
      expect(curated[1].blocks[0]).toMatchObject({
        type: 'text',
        text: 'Hi there!',
      });
    });

    it('should track conversation statistics', () => {
      // Add various message types
      service.add(createUserMessage('Question 1'));
      service.add({
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'Answer 1' },
          { type: 'tool_call', id: 'tc1', name: 'tool1', parameters: {} },
        ],
        metadata: {
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        },
      });
      service.add(createToolResponse('tc1', 'tool1', { result: 'data' }));
      service.add(createUserMessage('Question 2'));
      service.add({
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Answer 2' }],
        metadata: {
          usage: { promptTokens: 15, completionTokens: 25, totalTokens: 40 },
        },
      });

      const stats = service.getStatistics();
      expect(stats.totalMessages).toBe(5);
      expect(stats.userMessages).toBe(2);
      expect(stats.aiMessages).toBe(2);
      expect(stats.toolCalls).toBe(1);
      expect(stats.toolResponses).toBe(1);
      expect(stats.totalTokens).toBe(70); // 30 + 40
    });

    it('should handle recordTurn for complete conversation turns', () => {
      const userInput = createUserMessage('Calculate 5 + 3');

      const aiResponse: IContent = {
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'Let me calculate that.' },
          {
            type: 'tool_call',
            id: 'calc1',
            name: 'calculator',
            parameters: { op: 'add', a: 5, b: 3 },
          },
        ],
      };

      const toolInteractions = [
        createToolResponse('calc1', 'calculator', { result: 8 }),
      ];

      const aiFinal: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'The result is 8.' }],
      };

      // Record the complete turn
      service.recordTurn(userInput, aiResponse, [...toolInteractions, aiFinal]);

      // Verify the turn was recorded correctly
      const history = service.getAll();
      expect(history).toHaveLength(4);
      expect(history[0]).toBe(userInput);
      expect(history[1]).toBe(aiResponse);
      expect(history[2]).toBe(toolInteractions[0]);
      expect(history[3]).toBe(aiFinal);
    });

    it('should validate and fix unmatched tool calls', () => {
      // Add AI message with tool call but no response
      service.add({
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_tool_orphan1',
            name: 'tool1',
            parameters: {},
          },
        ],
      });

      // Add another user message (tool response is missing)
      service.add(createUserMessage('Next question'));

      const unmatched = service.findUnmatchedToolCalls();
      expect(unmatched).toHaveLength(1);
      expect(unmatched[0]?.id).toBe('hist_tool_orphan1');

      service.validateAndFix();

      // History should now include a synthetic tool response to keep pairing intact.
      const history = service.getAll();
      expect(history).toHaveLength(3);

      const toolMessage = history.find((c) => c.speaker === 'tool');
      expect(toolMessage).toBeDefined();
      expect(
        toolMessage?.blocks.some(
          (b) => b.type === 'tool_response' && b.callId === 'hist_tool_orphan1',
        ),
      ).toBe(true);
    });

    it('should synthesize tool responses for provider payloads without mutating stored history', () => {
      service.add(createUserMessage('Question'));
      service.add({
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_tool_orphan1',
            name: 'tool1',
            parameters: {},
          },
        ],
      });
      service.add(createUserMessage('Next question'));

      // Stored history remains unchanged.
      expect(service.getAll()).toHaveLength(3);

      const curated = service.getCuratedForProvider();
      const toolCallIndex = curated.findIndex(
        (c) =>
          c.speaker === 'ai' &&
          c.blocks.some(
            (b) => b.type === 'tool_call' && b.id === 'hist_tool_orphan1',
          ),
      );
      expect(toolCallIndex).toBeGreaterThanOrEqual(0);
      expect(curated[toolCallIndex + 1]?.speaker).toBe('tool');
      expect(
        curated[toolCallIndex + 1]?.blocks.some(
          (b) => b.type === 'tool_response' && b.callId === 'hist_tool_orphan1',
        ),
      ).toBe(true);

      // Still no mutation after reading provider view.
      expect(service.getAll()).toHaveLength(3);
    });

    it('should synthesize tool responses when a new user message is provided as tail contents', () => {
      service.add(createUserMessage('Question'));
      service.add({
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_tool_orphan_tail',
            name: 'tool1',
            parameters: {},
          },
        ],
      });

      // Stored history remains unchanged (tool call is still pending).
      expect(service.getAll()).toHaveLength(2);

      const tail = [createUserMessage('Next question')];
      const curated = service.getCuratedForProvider(tail);

      const toolCallIndex = curated.findIndex(
        (c) =>
          c.speaker === 'ai' &&
          c.blocks.some(
            (b) => b.type === 'tool_call' && b.id === 'hist_tool_orphan_tail',
          ),
      );
      expect(toolCallIndex).toBeGreaterThanOrEqual(0);
      expect(curated[toolCallIndex + 1]?.speaker).toBe('tool');
      expect(
        curated[toolCallIndex + 1]?.blocks.some(
          (b) =>
            b.type === 'tool_response' && b.callId === 'hist_tool_orphan_tail',
        ),
      ).toBe(true);

      // Tail user message should still be present (provider-safe transcript includes it).
      expect(curated.some((c) => c.speaker === 'human')).toBe(true);

      // Still no mutation after reading provider view.
      expect(service.getAll()).toHaveLength(2);
    });
  });
});
