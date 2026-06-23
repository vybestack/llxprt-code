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
import type { IContent, ToolCallBlock, ToolResponseBlock } from './IContent.js';
import {
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
      expect(importedHistory[0]).toStrictEqual(originalHistory[0]);
      expect(importedHistory[1]).toStrictEqual(originalHistory[1]);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty history operations', () => {
      expect(service.isEmpty()).toBe(true);
      expect(service.length()).toBe(0);
      expect(service.getAll()).toStrictEqual([]);
      expect(service.getCurated()).toStrictEqual([]);
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

      expect(service.getCurated()).toStrictEqual([]);
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
              block.type === 'tool_response' && block.callId === callId,
          ),
        );

      expect(toolResponses).toHaveLength(1);
      expect(
        curated.some(
          (content) =>
            content.metadata?.synthetic === true &&
            content.metadata.reason === 'reconstructed_tool_call',
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
            block.type === 'tool_response' && block.callId === callId,
        );
      expect(toolResponsesForCallId).toHaveLength(1);

      const toolCallIndex = curated.findIndex(
        (content) =>
          content.speaker === 'ai' &&
          content.blocks.some(
            (block) => block.type === 'tool_call' && block.id === callId,
          ),
      );
      expect(toolCallIndex).toBeGreaterThanOrEqual(0);

      const toolResultMessage = curated[toolCallIndex + 1];
      expect(toolResultMessage.speaker).toBe('tool');
      expect(
        toolResultMessage.blocks.some(
          (block) => block.type === 'tool_response' && block.callId === callId,
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
            (block) => block.type === 'tool_call' && block.id === callId,
          ),
      );
      expect(toolCallIndex).toBeGreaterThanOrEqual(0);

      const toolResultMessage = curated[toolCallIndex + 1];
      expect(toolResultMessage.speaker).toBe('tool');
      expect(
        toolResultMessage.blocks.some(
          (block) => block.type === 'tool_response' && block.callId === callId,
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
});
