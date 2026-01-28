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

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HistoryService } from './HistoryService.js';
import {
  IContent,
  ToolCallBlock,
  ToolResponseBlock,
  createUserMessage as createUserMessageFromIContent,
  createToolResponse as createToolResponseFromIContent,
} from './IContent.js';
import { ContentConverters } from './ContentConverters.js';

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
          (b) =>
            b.type === 'tool_response' &&
            (b as ToolResponseBlock).callId === 'hist_tool_orphan1',
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
            (b) =>
              b.type === 'tool_call' &&
              (b as ToolCallBlock).id === 'hist_tool_orphan1',
          ),
      );
      expect(toolCallIndex).toBeGreaterThanOrEqual(0);
      expect(curated[toolCallIndex + 1]?.speaker).toBe('tool');
      expect(
        curated[toolCallIndex + 1]?.blocks.some(
          (b) =>
            b.type === 'tool_response' &&
            (b as ToolResponseBlock).callId === 'hist_tool_orphan1',
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
            (b) =>
              b.type === 'tool_call' &&
              (b as ToolCallBlock).id === 'hist_tool_orphan_tail',
          ),
      );
      expect(toolCallIndex).toBeGreaterThanOrEqual(0);
      expect(curated[toolCallIndex + 1]?.speaker).toBe('tool');
      expect(
        curated[toolCallIndex + 1]?.blocks.some(
          (b) =>
            b.type === 'tool_response' &&
            (b as ToolResponseBlock).callId === 'hist_tool_orphan_tail',
        ),
      ).toBe(true);

      // Tail user message should still be present (provider-safe transcript includes it).
      expect(curated.some((c) => c.speaker === 'human')).toBe(true);

      // Still no mutation after reading provider view.
      expect(service.getAll()).toHaveLength(2);
    });
  });

  describe('Token Management', () => {
    it('should return history within token limits', () => {
      // Add messages with known token counts
      for (let i = 0; i < 10; i++) {
        service.add(createUserMessage(`Message ${i}`));
        service.add({
          speaker: 'ai',
          blocks: [{ type: 'text', text: `Response ${i}` }],
          metadata: {
            usage: {
              promptTokens: 10,
              completionTokens: 10,
              totalTokens: 20,
            },
          },
        });
      }

      // Mock token counter (10 tokens per message)
      const countTokens = (_content: IContent) => 10;

      // Get history within 50 token limit (should return last 5 messages)
      const limited = service.getWithinTokenLimit(50, countTokens);
      expect(limited).toHaveLength(5);
    });

    it('should handle history summarization for old messages', async () => {
      // Add many messages
      for (let i = 0; i < 20; i++) {
        service.add(createUserMessage(`Question ${i}`));
        service.add({
          speaker: 'ai',
          blocks: [{ type: 'text', text: `Answer ${i}` }],
        });
      }

      // Mock summarize function
      const summarizeFn = async (contents: IContent[]): Promise<IContent> => ({
        speaker: 'ai',
        blocks: [
          {
            type: 'text',
            text: `Summary of ${contents.length} messages`,
          },
        ],
        metadata: { isSummary: true },
      });

      // Summarize old history, keeping last 4 messages
      await service.summarizeOldHistory(4, summarizeFn);

      const history = service.getAll();
      // Should have: 1 summary + 4 recent messages = 5 total
      expect(history).toHaveLength(5);
      expect(history[0].metadata?.isSummary).toBe(true);
    });
  });

  describe('Import/Export', () => {
    it('should export and import history via JSON', () => {
      // Add some content
      service.add(createUserMessage('Test message'));
      service.add({
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'Test response' },
          {
            type: 'tool_call',
            id: 'tc1',
            name: 'test_tool',
            parameters: { test: true },
          },
        ],
      });

      // Export to JSON
      const json = service.toJSON();
      expect(json).toBeTypeOf('string');

      // Import into new service
      const newService = HistoryService.fromJSON(json);

      // Verify content matches
      const originalHistory = service.getAll();
      const importedHistory = newService.getAll();

      expect(importedHistory).toHaveLength(originalHistory.length);
      expect(importedHistory[0]).toEqual(originalHistory[0]);
      expect(importedHistory[1]).toEqual(originalHistory[1]);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty history operations', () => {
      expect(service.isEmpty()).toBe(true);
      expect(service.length()).toBe(0);
      expect(service.getAll()).toEqual([]);
      expect(service.getCurated()).toEqual([]);
      expect(service.pop()).toBeUndefined();
      expect(service.getLastUserContent()).toBeUndefined();
      expect(service.getLastAIContent()).toBeUndefined();
    });

    it('should handle thinking blocks appropriately', () => {
      // Add AI message with thinking
      service.add({
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Let me think about this...',
            isHidden: true,
          },
          { type: 'text', text: 'Here is my response.' },
        ],
      });

      const history = service.getAll();
      expect(history).toHaveLength(1);
      expect(history[0].blocks).toHaveLength(2);

      // Curated history might filter hidden thinking
      const curated = service.getCurated();
      expect(curated).toHaveLength(1);
      // Implementation could choose to filter hidden thinking blocks
    });

    it('should treat unsigned Anthropic thinking blocks as invalid content', () => {
      service.add({
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Unsigned thinking',
            sourceField: 'thinking',
          },
        ],
      });

      expect(service.getCurated()).toEqual([]);
    });

    it('should handle media blocks', () => {
      service.add({
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'Here is an image:' },
          {
            type: 'media',
            mimeType: 'image/png',
            data: 'base64encodeddata',
            encoding: 'base64',
            caption: 'Screenshot',
          },
        ],
      });

      const history = service.getAll();
      expect(history).toHaveLength(1);
      expect(history[0].blocks).toHaveLength(2);
      expect(history[0].blocks[1].type).toBe('media');
    });
  });

  describe('Orphan tool responses handling', () => {
    it('should split tool_call blocks out of tool speaker entries in curated provider history', () => {
      const combined = ContentConverters.toIContent(
        {
          role: 'user',
          parts: [
            {
              functionCall: {
                id: 'call_cancel_123',
                name: 'run_shell_command',
                args: { command: 'echo hi' },
              },
            },
            {
              functionResponse: {
                id: 'call_cancel_123',
                name: 'run_shell_command',
                response: { error: '[Operation Cancelled] Reason: user' },
              },
            },
          ],
        },
        service.getIdGeneratorCallback(),
      );

      // This shape can occur when a cancelled tool interaction is recorded as a
      // single user Content containing both functionCall and functionResponse parts.
      service.add(combined);

      const curated = service.getCuratedForProvider();

      expect(curated).toHaveLength(2);
      expect(curated[0]?.speaker).toBe('ai');
      expect(curated[0]?.blocks[0]).toMatchObject({
        type: 'tool_call',
        name: 'run_shell_command',
      });
      const toolCallId = (curated[0]?.blocks[0] as ToolCallBlock).id;
      expect(toolCallId).toMatch(/^hist_tool_[a-zA-Z0-9_-]+$/);

      expect(curated[1]?.speaker).toBe('tool');
      expect(curated[1]?.blocks[0]).toMatchObject({
        type: 'tool_response',
        callId: toolCallId,
        toolName: 'run_shell_command',
      });
    });

    it('should synthesize missing tool_call entries so tool responses survive compression', () => {
      const orphanCallId = 'hist_tool_orphan';

      service.add(createUserMessage('Please list files.'));
      service.add(
        createToolResponse(orphanCallId, 'run_shell_command', {
          output: '[Operation Cancelled]',
        }),
      );

      const curated = service.getCuratedForProvider();
      expect(curated).toHaveLength(3);

      const synthesizedCall = curated[1];
      expect(synthesizedCall.speaker).toBe('ai');
      expect(synthesizedCall.metadata?.synthetic).toBe(true);
      expect(synthesizedCall.metadata?.reason).toBe('reconstructed_tool_call');
      expect(synthesizedCall.blocks).toHaveLength(1);
      expect(synthesizedCall.blocks[0]).toMatchObject({
        type: 'tool_call',
        id: orphanCallId,
        name: 'run_shell_command',
      });

      const toolMessage = curated[2];
      expect(
        toolMessage.blocks.some((block) => block.type === 'tool_response'),
      ).toBe(true);
    });

    it('should keep tool responses unchanged when a matching tool_call exists', () => {
      const callId = 'hist_tool_valid';

      service.add(createUserMessage('Please list files.'));
      service.add({
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: callId,
            name: 'run_shell_command',
            parameters: { command: 'ls' },
          },
        ],
      });
      service.add(
        createToolResponse(callId, 'run_shell_command', {
          output: 'file.txt',
        }),
      );

      const curated = service.getCuratedForProvider();
      const toolResponses = curated
        .filter((content) => content.speaker === 'tool')
        .flatMap((content) =>
          content.blocks.filter(
            (block) =>
              block.type === 'tool_response' &&
              (block as ToolResponseBlock).callId === callId,
          ),
        );

      expect(toolResponses).toHaveLength(1);
      expect(
        curated.some(
          (content) =>
            content.metadata?.synthetic &&
            content.metadata?.reason === 'reconstructed_tool_call',
        ),
      ).toBe(false);
    });

    it('should drop duplicate late tool_responses to keep provider tool adjacency valid', () => {
      const callId = 'hist_tool_dupe';

      service.add(createUserMessage('Please list files.'));
      service.add({
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: callId,
            name: 'run_shell_command',
            parameters: { command: 'ls' },
          },
        ],
      });
      service.add(
        createToolResponse(callId, 'run_shell_command', {
          output: 'file.txt',
        }),
      );
      service.add({
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'file.txt' }],
      });

      // Corrupted history: the same tool result is written again after the
      // assistant has already continued with normal text.
      service.add(
        createToolResponse(callId, 'run_shell_command', {
          output: 'file.txt',
        }),
      );

      const curated = service.getCuratedForProvider();

      const toolResponsesForCallId = curated
        .flatMap((content) => content.blocks)
        .filter(
          (block): block is ToolResponseBlock =>
            block.type === 'tool_response' &&
            (block as ToolResponseBlock).callId === callId,
        );
      expect(toolResponsesForCallId).toHaveLength(1);

      const toolCallIndex = curated.findIndex(
        (content) =>
          content.speaker === 'ai' &&
          content.blocks.some(
            (block) =>
              block.type === 'tool_call' &&
              (block as ToolCallBlock).id === callId,
          ),
      );
      expect(toolCallIndex).toBeGreaterThanOrEqual(0);

      const toolResultMessage = curated[toolCallIndex + 1];
      expect(toolResultMessage?.speaker).toBe('tool');
      expect(
        toolResultMessage?.blocks.some(
          (block) =>
            block.type === 'tool_response' &&
            (block as ToolResponseBlock).callId === callId,
        ),
      ).toBe(true);
    });

    it('should relocate out-of-order tool_responses to immediately follow their tool_call', () => {
      const callId = 'hist_tool_out_of_order';

      service.add(createUserMessage('Please list files.'));
      service.add({
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: callId,
            name: 'run_shell_command',
            parameters: { command: 'ls' },
          },
        ],
      });

      // Corrupted ordering: assistant continues before the tool result is recorded.
      service.add({
        speaker: 'ai',
        blocks: [{ type: 'text', text: '...waiting for tool...' }],
      });
      service.add(
        createToolResponse(callId, 'run_shell_command', {
          output: 'file.txt',
        }),
      );

      const curated = service.getCuratedForProvider();

      const toolCallIndex = curated.findIndex(
        (content) =>
          content.speaker === 'ai' &&
          content.blocks.some(
            (block) =>
              block.type === 'tool_call' &&
              (block as ToolCallBlock).id === callId,
          ),
      );
      expect(toolCallIndex).toBeGreaterThanOrEqual(0);

      const toolResultMessage = curated[toolCallIndex + 1];
      expect(toolResultMessage?.speaker).toBe('tool');
      expect(
        toolResultMessage?.blocks.some(
          (block) =>
            block.type === 'tool_response' &&
            (block as ToolResponseBlock).callId === callId,
        ),
      ).toBe(true);

      const waitingMessageIndex = curated.findIndex(
        (content) =>
          content.speaker === 'ai' &&
          content.blocks.some(
            (block) =>
              block.type === 'text' &&
              (block as { text?: string }).text === '...waiting for tool...',
          ),
      );
      expect(waitingMessageIndex).toBeGreaterThan(toolCallIndex + 1);
    });
  });

  // NEW TESTS FOR ID NORMALIZATION ARCHITECTURE
  // These tests SHOULD FAIL initially - that's the point of TDD
  describe('ID Normalization Architecture - NEW FAILING TESTS', () => {
    describe('HistoryService as ONLY ID generator', () => {
      it('should be the ONLY source of ID generation with generateHistoryId method', () => {
        // FAILING TEST: HistoryService should have generateHistoryId method
        expect(typeof service.generateHistoryId).toBe('function');

        const id1 = service.generateHistoryId(
          'turn-test',
          0,
          'openai',
          'raw-1',
          'test_tool',
        );
        const id2 = service.generateHistoryId(
          'turn-test',
          1,
          'openai',
          'raw-2',
          'test_tool',
        );

        // All IDs should have hist_tool_ format
        expect(id1).toMatch(/^hist_tool_[a-zA-Z0-9_-]+$/);
        expect(id2).toMatch(/^hist_tool_[a-zA-Z0-9_-]+$/);

        // Each call should generate unique IDs
        expect(id1).not.toBe(id2);
      });

      it('should provide ID generation callback to converters', () => {
        // FAILING TEST: HistoryService should provide getIdGeneratorCallback method
        expect(typeof service.getIdGeneratorCallback).toBe('function');

        const callback = service.getIdGeneratorCallback('turn-test');
        expect(typeof callback).toBe('function');

        // Callback should generate proper history IDs
        const id = callback();
        expect(id).toMatch(/^hist_tool_[a-zA-Z0-9_-]+$/);
      });
    });

    describe('Converter integration with HistoryService callbacks', () => {
      it('should provide ID generation callback for converters that need it', () => {
        // Test that HistoryService can provide ID generation callback
        const generateIdCallback = service.getIdGeneratorCallback('turn-test');
        expect(typeof generateIdCallback).toBe('function');

        // Test that the callback generates valid IDs
        const id1 = generateIdCallback();
        const id2 = generateIdCallback();
        expect(typeof id1).toBe('string');
        expect(typeof id2).toBe('string');
        expect(id1).not.toBe(id2); // Should generate unique IDs
      });
    });

    describe('No internal ID generation in converters', () => {
      it('should NOT generate IDs internally in ContentConverters', () => {
        // FAILING TEST: ContentConverters should not have generateHistoryToolId method
        expect(
          (
            ContentConverters as unknown as {
              generateHistoryToolId?: () => string;
            }
          ).generateHistoryToolId,
        ).toBeUndefined();
      });

      it('should NOT expose generateHistoryId function in ContentConverters', () => {
        // FAILING TEST: ContentConverters should not have generateHistoryId function
        // Check that the internal function is not accessible (it exists but is private)
        expect(
          (ContentConverters as unknown as { generateHistoryId?: () => string })
            .generateHistoryId,
        ).toBeUndefined();
      });
    });

    describe('Token counting accuracy', () => {
      it('avoids double counting when usage metadata is present', async () => {
        const estimateSpy = vi
          .spyOn(
            service as unknown as {
              estimateContentTokens: (
                content: IContent,
                modelName?: string,
              ) => Promise<number>;
            },
            'estimateContentTokens',
          )
          .mockResolvedValueOnce(50) // User message tokens
          .mockResolvedValueOnce(20); // AI completion tokens

        service.add(
          createUserMessage('Summarize the requirements.'),
          'claude-3',
        );
        await service.waitForTokenUpdates();
        expect(service.getTotalTokens()).toBe(50);

        const aiResponse: IContent = {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Here is the summary...' }],
          metadata: {
            usage: {
              promptTokens: 120,
              completionTokens: 20,
              totalTokens: 140,
            },
          },
        };

        service.add(aiResponse, 'claude-3');
        await service.waitForTokenUpdates();

        expect(service.getTotalTokens()).toBe(70);
        expect(estimateSpy).toHaveBeenCalledTimes(2);
        estimateSpy.mockRestore();
      });
    });

    describe('Base token offset', () => {
      it('updates totals and emits delta when base token offset changes', () => {
        const emissions: Array<{ totalTokens: number; addedTokens: number }> =
          [];
        service.on('tokensUpdated', (event) => emissions.push(event));

        service.setBaseTokenOffset(120);
        expect(service.getTotalTokens()).toBe(120);
        expect(emissions).toHaveLength(1);
        expect(emissions[0].totalTokens).toBe(120);
        expect(emissions[0].addedTokens).toBe(120);

        service.setBaseTokenOffset(180);
        expect(service.getTotalTokens()).toBe(180);
        expect(emissions).toHaveLength(2);
        expect(emissions[1].addedTokens).toBe(60);

        service.setBaseTokenOffset(180);
        expect(emissions).toHaveLength(2);
      });

      it('retains base offset after clearing history', async () => {
        service.setBaseTokenOffset(50);
        service.add(
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'hello world' }],
          },
          'gpt-4o',
        );
        await service.waitForTokenUpdates();
        expect(service.getTotalTokens()).toBeGreaterThan(50);

        service.clear();
        expect(service.getTotalTokens()).toBe(50);
      });

      it('estimates tokens for raw text input', async () => {
        const tokens = await service.estimateTokensForText(
          'hello world from llxprt',
        );
        expect(tokens).toBeGreaterThan(0);
      });
    });

    describe('dispose', () => {
      it('clears internal state, listeners, and caches', async () => {
        const tokensUpdated = vi.fn();
        service.on('tokensUpdated', tokensUpdated);
        service.setBaseTokenOffset(42);

        service.add(
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'hello' }],
          },
          'gpt-4',
        );

        // Simulate queued work and tokenizer cache entries
        (service as unknown as { isCompressing: boolean }).isCompressing = true;
        (
          service as unknown as { pendingOperations: Array<() => void> }
        ).pendingOperations.push(() => {});
        (
          service as unknown as { tokenizerCache: Map<string, unknown> }
        ).tokenizerCache.set('gpt-4', {} as unknown);

        await service.waitForTokenUpdates();

        service.dispose();

        expect(service.getAll()).toHaveLength(0);
        expect(service.getTotalTokens()).toBe(0);
        expect(service.listenerCount('tokensUpdated')).toBe(0);
        expect(
          (service as unknown as { tokenizerCache: Map<string, unknown> })
            .tokenizerCache.size,
        ).toBe(0);
        expect(
          (service as unknown as { pendingOperations: Array<() => void> })
            .pendingOperations.length,
        ).toBe(0);
        expect(
          (service as unknown as { baseTokenOffset: number }).baseTokenOffset,
        ).toBe(0);
        expect(
          (service as unknown as { isCompressing: boolean }).isCompressing,
        ).toBe(false);
      });
    });

    describe('Strict tool adjacency mode', () => {
      it('should synthesize tool responses for orphaned tool calls when strictToolAdjacency is true', () => {
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

        expect(service.getAll()).toHaveLength(2);

        const curated = service.getCuratedForProvider([], {
          strictToolAdjacency: true,
        });
        expect(curated).toHaveLength(3);

        const toolCallIndex = curated.findIndex(
          (c) =>
            c.speaker === 'ai' &&
            c.blocks.some(
              (b) =>
                b.type === 'tool_call' &&
                (b as ToolCallBlock).id === 'hist_tool_orphan1',
            ),
        );
        expect(toolCallIndex).toBeGreaterThanOrEqual(0);
        expect(curated[toolCallIndex + 1]?.speaker).toBe('tool');
        expect(
          curated[toolCallIndex + 1]?.blocks.some(
            (b) =>
              b.type === 'tool_response' &&
              (b as ToolResponseBlock).callId === 'hist_tool_orphan1',
          ),
        ).toBe(true);
      });

      it('should NOT synthesize tool responses for orphaned tool calls without later non-tool message when strictToolAdjacency is false', () => {
        service.add(createUserMessage('Question'));
        service.add({
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'hist_tool_orphan2',
              name: 'tool1',
              parameters: {},
            },
          ],
        });

        expect(service.getAll()).toHaveLength(2);

        const curated = service.getCuratedForProvider([], {
          strictToolAdjacency: false,
        });
        expect(curated).toHaveLength(2);

        const toolCallIndex = curated.findIndex(
          (c) =>
            c.speaker === 'ai' &&
            c.blocks.some(
              (b) =>
                b.type === 'tool_call' &&
                (b as ToolCallBlock).id === 'hist_tool_orphan2',
            ),
        );
        expect(toolCallIndex).toBeGreaterThanOrEqual(0);
        expect(curated[toolCallIndex + 1]?.speaker).not.toBe('tool');
      });

      it('should synthesize tool responses in strict mode even without later non-tool message', () => {
        service.add(createUserMessage('Question'));
        service.add({
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'hist_tool_pending',
              name: 'tool1',
              parameters: {},
            },
          ],
        });

        expect(service.getAll()).toHaveLength(2);

        const curated = service.getCuratedForProvider([], {
          strictToolAdjacency: true,
        });
        expect(curated).toHaveLength(3);

        const syntheticToolMessage = curated[2];
        expect(syntheticToolMessage.speaker).toBe('tool');
        expect(syntheticToolMessage.metadata?.synthetic).toBe(true);
        expect(syntheticToolMessage.metadata?.reason).toBe(
          'reordered_tool_responses',
        );
      });

      it('should handle strictToolAdjacency default as false', () => {
        service.add(createUserMessage('Question'));
        service.add({
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'hist_tool_default',
              name: 'tool1',
              parameters: {},
            },
          ],
        });

        expect(service.getAll()).toHaveLength(2);

        const curated = service.getCuratedForProvider();
        expect(curated).toHaveLength(2);

        const toolCallIndex = curated.findIndex(
          (c) =>
            c.speaker === 'ai' &&
            c.blocks.some(
              (b) =>
                b.type === 'tool_call' &&
                (b as ToolCallBlock).id === 'hist_tool_default',
            ),
        );
        expect(toolCallIndex).toBeGreaterThanOrEqual(0);
        expect(curated[toolCallIndex + 1]?.speaker).not.toBe('tool');
      });
    });
  });
});
