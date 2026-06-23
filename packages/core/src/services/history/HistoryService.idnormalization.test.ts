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
import type { IContent } from './IContent.js';
import { createUserMessage as createUserMessageFromIContent } from './IContent.js';
import { ContentConverters } from './ContentConverters.js';

const createUserMessage = createUserMessageFromIContent;

describe('HistoryService - Behavioral Tests', () => {
  let service: HistoryService;

  beforeEach(() => {
    service = new HistoryService();
  });

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

    describe('Tool adjacency enforcement', () => {
      it('should always synthesize tool responses for orphaned tool calls', () => {
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

        const curated = service.getCuratedForProvider();
        expect(curated).toHaveLength(3);

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
            (b) =>
              b.type === 'tool_response' && b.callId === 'hist_tool_orphan1',
          ),
        ).toBe(true);
      });

      it('should synthesize tool responses even without later non-tool message', () => {
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

        const curated = service.getCuratedForProvider();
        expect(curated).toHaveLength(3);

        const syntheticToolMessage = curated[2];
        expect(syntheticToolMessage.speaker).toBe('tool');
        expect(syntheticToolMessage.metadata?.synthetic).toBe(true);
        expect(syntheticToolMessage.metadata?.reason).toBe(
          'reordered_tool_responses',
        );
      });

      it('should not duplicate tool responses for already-responded tool calls', () => {
        service.add(createUserMessage('Question'));
        service.add({
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'hist_tool_responded',
              name: 'tool1',
              parameters: {},
            },
          ],
        });
        service.add({
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'hist_tool_responded',
              toolName: 'tool1',
              result: 'success',
              isComplete: true,
            },
          ],
        });

        expect(service.getAll()).toHaveLength(3);

        const curated = service.getCuratedForProvider();
        // Should still be 3 - no synthetic response needed
        expect(curated).toHaveLength(3);

        // Count tool responses for this call ID
        const toolResponses = curated.flatMap((c) =>
          c.blocks.filter(
            (b) =>
              b.type === 'tool_response' && b.callId === 'hist_tool_responded',
          ),
        );
        expect(toolResponses).toHaveLength(1);
      });

      it('should preserve MediaBlocks alongside tool_response in getCuratedForProvider', () => {
        service.add(createUserMessage('Take a screenshot'));
        service.add({
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'call_screenshot',
              name: 'take_screenshot',
              parameters: { filename: 'test.png' },
            },
          ],
        });
        service.add({
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call_screenshot',
              toolName: 'take_screenshot',
              result: { success: true },
              isComplete: true,
            },
            {
              type: 'media',
              mimeType: 'image/png',
              data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
              encoding: 'base64' as const,
              filename: 'test.png',
            },
          ],
        });

        const curated = service.getCuratedForProvider();

        // Find the tool result message after the tool_call
        const toolCallIndex = curated.findIndex(
          (c) =>
            c.speaker === 'ai' &&
            c.blocks.some(
              (b) => b.type === 'tool_call' && b.id === 'call_screenshot',
            ),
        );
        expect(toolCallIndex).toBeGreaterThanOrEqual(0);

        const toolResultMessage = curated[toolCallIndex + 1];
        expect(toolResultMessage).toBeDefined();
        expect(toolResultMessage.speaker).toBe('tool');

        // Assert both tool_response AND media blocks are present
        const toolResponseBlocks = toolResultMessage.blocks.filter(
          (b) => b.type === 'tool_response',
        );
        const mediaBlocks = toolResultMessage.blocks.filter(
          (b) => b.type === 'media',
        );

        expect(toolResponseBlocks).toHaveLength(1);
        expect(mediaBlocks).toHaveLength(1);
        expect(mediaBlocks[0]).toMatchObject({
          type: 'media',
          mimeType: 'image/png',
          encoding: 'base64',
          filename: 'test.png',
        });
      });

      it('should preserve multiple MediaBlocks from tool response', () => {
        service.add(createUserMessage('Generate report'));
        service.add({
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'call_report',
              name: 'generate_report',
              parameters: { format: 'multi' },
            },
          ],
        });
        service.add({
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call_report',
              toolName: 'generate_report',
              result: { success: true },
              isComplete: true,
            },
            {
              type: 'media',
              mimeType: 'image/png',
              data: 'base64_chart_data',
              encoding: 'base64' as const,
              filename: 'chart.png',
            },
            {
              type: 'media',
              mimeType: 'application/pdf',
              data: 'base64_pdf_data',
              encoding: 'base64' as const,
              filename: 'report.pdf',
            },
          ],
        });

        const curated = service.getCuratedForProvider();

        const toolCallIndex = curated.findIndex(
          (c) =>
            c.speaker === 'ai' &&
            c.blocks.some(
              (b) => b.type === 'tool_call' && b.id === 'call_report',
            ),
        );
        const toolResultMessage = curated[toolCallIndex + 1];

        // Assert both media blocks are present
        const mediaBlocks = toolResultMessage.blocks.filter(
          (b) => b.type === 'media',
        );
        expect(mediaBlocks).toHaveLength(2);
        expect(mediaBlocks[0]?.mimeType).toBe('image/png');
        expect(mediaBlocks[1]?.mimeType).toBe('application/pdf');
      });

      it('should preserve MediaBlocks even when tool responses are reordered', () => {
        service.add(createUserMessage('Take screenshot'));
        service.add({
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'call_reorder',
              name: 'take_screenshot',
              parameters: {},
            },
          ],
        });
        // Add an intervening AI message (out of order)
        service.add({
          speaker: 'ai',
          blocks: [
            {
              type: 'text',
              text: 'Processing...',
            },
          ],
        });
        // Tool response comes after intervening message
        service.add({
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call_reorder',
              toolName: 'take_screenshot',
              result: { success: true },
              isComplete: true,
            },
            {
              type: 'media',
              mimeType: 'image/png',
              data: 'base64_screenshot_data',
              encoding: 'base64' as const,
            },
          ],
        });

        const curated = service.getCuratedForProvider();

        // After curation, media blocks should still be present next to tool_response
        const toolMessages = curated.filter((c) => c.speaker === 'tool');
        expect(toolMessages.length).toBeGreaterThan(0);

        const toolMessageWithMedia = toolMessages.find((msg) =>
          msg.blocks.some((b) => b.type === 'media'),
        );
        expect(toolMessageWithMedia).toBeDefined();

        const mediaBlocks = toolMessageWithMedia!.blocks.filter(
          (b) => b.type === 'media',
        );
        expect(mediaBlocks).toHaveLength(1);
        expect(mediaBlocks[0]?.mimeType).toBe('image/png');
      });

      it('should not duplicate MediaBlocks when tool message has responses for multiple call IDs', () => {
        service.add(createUserMessage('Do two things'));
        service.add({
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'call_a',
              name: 'read_file',
              parameters: { path: 'a.png' },
            },
            {
              type: 'tool_call',
              id: 'call_b',
              name: 'read_file',
              parameters: { path: 'b.txt' },
            },
          ],
        });
        service.add({
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call_a',
              toolName: 'read_file',
              result: { success: true },
              isComplete: true,
            },
            {
              type: 'tool_response',
              callId: 'call_b',
              toolName: 'read_file',
              result: { content: 'hello' },
              isComplete: true,
            },
            {
              type: 'media',
              mimeType: 'image/png',
              data: 'base64imagedata',
              encoding: 'base64' as const,
              filename: 'a.png',
            },
          ],
        });

        const curated = service.getCuratedForProvider();

        // Count total media blocks across all curated messages
        const allMediaBlocks = curated.flatMap((c) =>
          c.blocks.filter((b) => b.type === 'media'),
        );

        // Media should appear exactly once, not duplicated across call indices
        expect(allMediaBlocks).toHaveLength(1);
        expect(allMediaBlocks[0]?.mimeType).toBe('image/png');
      });
    });
  });
});
