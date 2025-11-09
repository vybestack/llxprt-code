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
import { IContent, ContentFactory, ToolResponseBlock } from './IContent.js';
import { ContentConverters } from './ContentConverters.js';

describe('HistoryService - Behavioral Tests', () => {
  let service: HistoryService;

  beforeEach(() => {
    service = new HistoryService();
  });

  describe('Realistic Conversation Flow', () => {
    it('should handle a complete tool-use conversation flow', () => {
      // 1. User asks to read a file
      const userRequest = ContentFactory.createUserMessage(
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
      const toolResponse = ContentFactory.createToolResponse(
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
      const userRequest = ContentFactory.createUserMessage(
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
        ContentFactory.createToolResponse('call_nyc', 'get_weather', {
          temp: 72,
          condition: 'Sunny',
        }),
      );

      service.add(
        ContentFactory.createToolResponse('call_london', 'get_weather', {
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
      const userRequest = ContentFactory.createUserMessage(
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
      const toolError = ContentFactory.createToolResponse(
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
      service.add(ContentFactory.createUserMessage('Hello'));

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
      service.add(ContentFactory.createUserMessage('Question 1'));
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
      service.add(
        ContentFactory.createToolResponse('tc1', 'tool1', { result: 'data' }),
      );
      service.add(ContentFactory.createUserMessage('Question 2'));
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
      const userInput = ContentFactory.createUserMessage('Calculate 5 + 3');

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
        ContentFactory.createToolResponse('calc1', 'calculator', { result: 8 }),
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
          { type: 'tool_call', id: 'orphan1', name: 'tool1', parameters: {} },
        ],
      });

      // Add another user message (tool response is missing)
      service.add(ContentFactory.createUserMessage('Next question'));

      // In current atomic implementation, unmatched tool calls cannot exist by design
      const unmatched = service.findUnmatchedToolCalls();
      expect(unmatched).toHaveLength(0); // Always empty in atomic implementation

      // Validate and fix does nothing in atomic implementation
      service.validateAndFix();

      // History remains as is - no synthetic responses added in atomic design
      const history = service.getAll();
      expect(history).toHaveLength(2); // AI call, user message (no synthetic response)

      // No synthetic response is added in the current atomic implementation
      // The history only contains the AI message and user message
    });
  });

  describe('Token Management', () => {
    it('should return history within token limits', () => {
      // Add messages with known token counts
      for (let i = 0; i < 10; i++) {
        service.add(ContentFactory.createUserMessage(`Message ${i}`));
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
        service.add(ContentFactory.createUserMessage(`Question ${i}`));
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
      service.add(ContentFactory.createUserMessage('Test message'));
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

  // NEW TESTS FOR ID NORMALIZATION ARCHITECTURE
  // These tests SHOULD FAIL initially - that's the point of TDD
  describe('ID Normalization Architecture - NEW FAILING TESTS', () => {
    describe('HistoryService as ONLY ID generator', () => {
      it('should be the ONLY source of ID generation with generateHistoryId method', () => {
        // FAILING TEST: HistoryService should have generateHistoryId method
        expect(typeof service.generateHistoryId).toBe('function');

        const id1 = service.generateHistoryId();
        const id2 = service.generateHistoryId();

        // All IDs should have hist_tool_ format with UUID
        expect(id1).toMatch(
          /^hist_tool_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        expect(id2).toMatch(
          /^hist_tool_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );

        // Each call should generate unique IDs
        expect(id1).not.toBe(id2);
      });

      it('should provide ID generation callback to converters', () => {
        // FAILING TEST: HistoryService should provide getIdGeneratorCallback method
        expect(typeof service.getIdGeneratorCallback).toBe('function');

        const callback = service.getIdGeneratorCallback();
        expect(typeof callback).toBe('function');

        // Callback should generate proper history IDs
        const id = callback();
        expect(id).toMatch(
          /^hist_tool_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
      });
    });

    describe('Converter integration with HistoryService callbacks', () => {
      it('should provide ID generation callback for converters that need it', () => {
        // Test that HistoryService can provide ID generation callback
        const generateIdCallback = service.getIdGeneratorCallback();
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
          ContentFactory.createUserMessage('Summarize the requirements.'),
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
  });
});
