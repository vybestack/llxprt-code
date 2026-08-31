/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { DebugLogger } from '../../debug/index.js';
import { HistoryService } from './HistoryService.js';
import type { IContent, MediaBlock, ToolResponseBlock } from './IContent.js';
import { createUserMessage } from './IContent.js';

describe('HistoryService issue #3165 adjacency and metadata', () => {
  let service: HistoryService;

  beforeEach(() => {
    service = new HistoryService();
  });

  describe('provider curation', () => {
    it('preserves metadata on an already-adjacent parallel tool response with media', () => {
      service.add(createUserMessage('Read two files'));
      service.add({
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_adjacent_a',
            name: 'read_file',
            parameters: { path: 'a.png' },
          },
          {
            type: 'tool_call',
            id: 'call_adjacent_b',
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
            callId: 'call_adjacent_a',
            toolName: 'read_file',
            result: { success: true },
            isComplete: true,
          },
          {
            type: 'tool_response',
            callId: 'call_adjacent_b',
            toolName: 'read_file',
            result: { content: 'text' },
            isComplete: true,
          },
          {
            type: 'media',
            mimeType: 'image/png',
            data: 'image-data',
            encoding: 'base64',
          },
        ],
        metadata: {
          id: 'tool-content-id',
          turnId: 'turn-adjacent',
          promptId: 'prompt-adjacent',
          cacheAnchor: true,
        },
      });
      const storedToolContent = service.getAll()[2];
      const warnSpy = vi.spyOn(DebugLogger.prototype, 'warn');

      try {
        const curated = service.getCuratedForProvider();
        const toolContent = curated[2];
        const anchorLossWarnings = warnSpy.mock.calls.filter(
          ([message]) =>
            message === 'Provider history normalization removed a cache anchor',
        );

        expect(toolContent.blocks).toHaveLength(3);
        expect(toolContent.metadata).toMatchObject({
          id: 'tool-content-id',
          turnId: 'turn-adjacent',
          promptId: 'prompt-adjacent',
          chronology: storedToolContent.metadata?.chronology,
          cacheAnchor: true,
        });
        expect(toolContent.metadata?.synthetic).toBeUndefined();
        expect(toolContent.metadata?.reason).toBeUndefined();
        expect(anchorLossWarnings).toHaveLength(0);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('marks media-first adjacent tool content as reordered', () => {
      const response: ToolResponseBlock = {
        type: 'tool_response',
        callId: 'call_media_first',
        toolName: 'read_file',
        result: 'image result',
      };
      const media: MediaBlock = {
        type: 'media',
        mimeType: 'image/png',
        data: 'image-data',
        encoding: 'base64',
      };
      service.add({
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_media_first',
            name: 'read_file',
            parameters: {},
          },
        ],
      });
      service.add({
        speaker: 'tool',
        blocks: [media, response],
        metadata: { id: 'media-first-content' },
      });

      const curated = service.getCuratedForProvider();

      expect({
        blockTypes: curated[1].blocks.map((block) => block.type),
        metadata: curated[1].metadata,
      }).toStrictEqual({
        blockTypes: ['tool_response', 'media'],
        metadata: {
          synthetic: true,
          reason: 'reordered_tool_responses',
        },
      });
    });

    it('marks interleaved adjacent responses and media as reordered', () => {
      service.add({
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_interleaved_a',
            name: 'read_file',
            parameters: {},
          },
          {
            type: 'tool_call',
            id: 'call_interleaved_b',
            name: 'read_file',
            parameters: {},
          },
        ],
      });
      service.add({
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_interleaved_a',
            toolName: 'read_file',
            result: 'first result',
          },
          {
            type: 'media',
            mimeType: 'image/png',
            data: 'first-image',
            encoding: 'base64',
          },
          {
            type: 'tool_response',
            callId: 'call_interleaved_b',
            toolName: 'read_file',
            result: 'second result',
          },
          {
            type: 'media',
            mimeType: 'image/jpeg',
            data: 'second-image',
            encoding: 'base64',
          },
        ],
        metadata: { id: 'interleaved-content' },
      });

      const curated = service.getCuratedForProvider();

      expect({
        blockTypes: curated[1].blocks.map((block) => block.type),
        metadata: curated[1].metadata,
      }).toStrictEqual({
        blockTypes: ['tool_response', 'tool_response', 'media', 'media'],
        metadata: {
          synthetic: true,
          reason: 'reordered_tool_responses',
        },
      });
    });

    it('retains adjacent metadata when later content reuses the response block and adds a lower-scored duplicate', () => {
      const sharedResponse: ToolResponseBlock = {
        type: 'tool_response',
        callId: 'call_shared_duplicate',
        toolName: 'read_file',
        result: 'selected adjacent result',
        isComplete: true,
      };
      const lowerScoredDuplicate: ToolResponseBlock = {
        type: 'tool_response',
        callId: 'call_shared_duplicate',
        toolName: 'read_file',
        result: null,
        error: 'discarded duplicate',
      };
      service.add({
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_shared_duplicate',
            name: 'read_file',
            parameters: {},
          },
        ],
      });
      service.add({
        speaker: 'tool',
        blocks: [sharedResponse],
        metadata: { id: 'shared-adjacent-content' },
      });
      service.add(createUserMessage('Intervening content'));
      service.add({
        speaker: 'tool',
        blocks: [sharedResponse, lowerScoredDuplicate],
      });

      const curated = service.getCuratedForProvider();
      const selectedResponse = curated[1].blocks.find(
        (block) => block.type === 'tool_response',
      );

      expect({
        result: selectedResponse?.result,
        metadataId: curated[1].metadata?.id,
        synthetic: curated[1].metadata?.synthetic,
        reason: curated[1].metadata?.reason,
      }).toStrictEqual({
        result: 'selected adjacent result',
        metadataId: 'shared-adjacent-content',
        synthetic: undefined,
        reason: undefined,
      });
    });

    it('warns once when adjacency normalization loses an input cache anchor', () => {
      const warnSpy = vi.spyOn(DebugLogger.prototype, 'warn');
      service.add(createUserMessage('Run the tool'));
      service.add({
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_moved_anchor',
            name: 'read_file',
            parameters: { path: 'file.txt' },
          },
        ],
      });
      service.add(createUserMessage('Intervening content'));
      service.add({
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_moved_anchor',
            toolName: 'read_file',
            result: 'contents',
            isComplete: true,
          },
        ],
        metadata: { cacheAnchor: true },
      });

      try {
        const curated = service.getCuratedForProvider();

        expect(
          curated.some((content) => content.metadata?.cacheAnchor === true),
        ).toBe(false);
        expect(curated[2].metadata).toStrictEqual({
          synthetic: true,
          reason: 'reordered_tool_responses',
        });
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
          'Provider history normalization removed a cache anchor',
          {
            inputAnchorIndexes: [3],
            inputContentCount: 4,
            outputContentCount: 4,
          },
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('does not warn when provider input has no cache anchor', () => {
      const warnSpy = vi.spyOn(DebugLogger.prototype, 'warn');
      service.add(createUserMessage('No anchored content'));

      try {
        service.getCuratedForProvider();

        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('preserves metadata for an adjacent tool response in pending tail content', () => {
      service.add(createUserMessage('Stored prompt'));
      const tail: IContent[] = [
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'call_pending_tail',
              name: 'read_file',
              parameters: {},
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call_pending_tail',
              toolName: 'read_file',
              result: 'tail result',
            },
          ],
          metadata: {
            id: 'pending-tool-content',
            turnId: 'pending-turn',
            cacheAnchor: true,
          },
        },
      ];

      const curated = service.getCuratedForProvider(tail);

      expect(curated[2].metadata).toMatchObject({
        id: 'pending-tool-content',
        turnId: 'pending-turn',
        cacheAnchor: true,
      });
      expect(curated[2].metadata?.reason).toBeUndefined();
    });

    it('repairs a missing response at the end of pending tail content', () => {
      const tail: IContent[] = [
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'call_pending_missing_response',
              name: 'read_file',
              parameters: { path: 'pending.txt' },
            },
          ],
        },
      ];

      const curated = service.getCuratedForProvider(tail);
      const syntheticResponse = curated[1];

      expect(curated).toHaveLength(2);
      expect(syntheticResponse.speaker).toBe('tool');
      expect(syntheticResponse.blocks).toContainEqual({
        type: 'tool_response',
        callId: 'call_pending_missing_response',
        toolName: 'read_file',
        result: null,
        error: 'Tool call interrupted or cancelled',
        isComplete: true,
      });
      expect(syntheticResponse.metadata).toStrictEqual({
        synthetic: true,
        reason: 'orphaned_tool_call',
      });
    });

    it('does not mark unchanged pending-tail tool content as synthetic', () => {
      const tail: IContent[] = [
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'call_pending_without_metadata',
              name: 'read_file',
              parameters: {},
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call_pending_without_metadata',
              toolName: 'read_file',
              result: 'tail result',
            },
          ],
        },
      ];

      const curated = service.getCuratedForProvider(tail);

      expect(curated[1].metadata?.synthetic).toBeUndefined();
      expect(curated[1].metadata?.reason).toBeUndefined();
    });

    it('marks responses merged from adjacent and remote contents as reordered', () => {
      service.add({
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_merge_a',
            name: 'read_file',
            parameters: {},
          },
          {
            type: 'tool_call',
            id: 'call_merge_b',
            name: 'read_file',
            parameters: {},
          },
        ],
      });
      service.add({
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_merge_a',
            toolName: 'read_file',
            result: 'first',
          },
        ],
        metadata: { id: 'adjacent-part' },
      });
      service.add(createUserMessage('Intervening content'));
      service.add({
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_merge_b',
            toolName: 'read_file',
            result: 'second',
          },
        ],
      });

      const curated = service.getCuratedForProvider();

      expect(curated[1].blocks).toHaveLength(2);
      expect(curated[1].metadata).toStrictEqual({
        synthetic: true,
        reason: 'reordered_tool_responses',
      });
    });

    it('marks a higher-scored remote duplicate response as reordered', () => {
      service.add({
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_duplicate',
            name: 'read_file',
            parameters: {},
          },
        ],
      });
      service.add({
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_duplicate',
            toolName: 'read_file',
            result: null,
          },
        ],
        metadata: { id: 'adjacent-duplicate' },
      });
      service.add(createUserMessage('Intervening content'));
      service.add({
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_duplicate',
            toolName: 'read_file',
            result: 'selected remote result',
            isComplete: true,
          },
        ],
      });

      const curated = service.getCuratedForProvider();
      const response = curated[1].blocks.find(
        (block) => block.type === 'tool_response',
      );

      expect(response?.result).toBe('selected remote result');
      expect(curated[1].metadata).toStrictEqual({
        synthetic: true,
        reason: 'reordered_tool_responses',
      });
    });

    it('retains adjacent metadata when a lower-scored remote duplicate is dropped', () => {
      service.add({
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_adjacent_duplicate',
            name: 'read_file',
            parameters: {},
          },
        ],
      });
      service.add({
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_adjacent_duplicate',
            toolName: 'read_file',
            result: 'selected adjacent result',
            isComplete: true,
          },
        ],
        metadata: { id: 'selected-adjacent-content' },
      });
      service.add(createUserMessage('Intervening content'));
      service.add({
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_adjacent_duplicate',
            toolName: 'read_file',
            result: null,
            error: 'discarded remote result',
          },
        ],
      });

      const curated = service.getCuratedForProvider();
      const response = curated[1].blocks.find(
        (block) => block.type === 'tool_response',
      );

      expect(response?.result).toBe('selected adjacent result');
      expect(curated[1].metadata?.id).toBe('selected-adjacent-content');
      expect(curated[1].metadata?.reason).toBeUndefined();
    });

    it('does not preserve metadata from tool content with non-provider blocks', () => {
      service.add({
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_extra_block',
            name: 'read_file',
            parameters: {},
          },
        ],
      });
      service.add({
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_extra_block',
            toolName: 'read_file',
            result: 'result',
          },
          { type: 'text', text: 'client-only tool annotation' },
        ],
        metadata: { id: 'ineligible-tool-content' },
      });

      const curated = service.getCuratedForProvider();

      expect(curated[1].blocks).toHaveLength(1);
      expect(curated[1].metadata).toStrictEqual({
        synthetic: true,
        reason: 'reordered_tool_responses',
      });
    });

    it('repairs a final same-content tool call and response', () => {
      service.add(createUserMessage('Run the tool'));
      service.add({
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_final_same_content',
            name: 'read_file',
            parameters: { path: 'final.txt' },
          },
          {
            type: 'tool_response',
            callId: 'call_final_same_content',
            toolName: 'read_file',
            result: { content: 'final contents' },
            isComplete: true,
          },
        ],
      });

      expect(() => service.getCuratedForProvider()).not.toThrow();
      const curated = service.getCuratedForProvider();

      expect(curated).toHaveLength(3);
      expect(curated[1].blocks).toHaveLength(1);
      expect(curated[2].blocks).toHaveLength(1);
      expect(curated[1]).toMatchObject({
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_final_same_content',
          },
        ],
      });
      expect(curated[2]).toMatchObject({
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_final_same_content',
            toolName: 'read_file',
            result: { content: 'final contents' },
            isComplete: true,
          },
        ],
        metadata: {
          synthetic: true,
          reason: 'reordered_tool_responses',
        },
      });
    });
  });
});
