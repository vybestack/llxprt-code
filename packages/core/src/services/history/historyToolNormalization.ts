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

import type { DebugLogger } from '../../debug/index.js';
import type {
  IContent,
  ToolCallBlock,
  ToolResponseBlock,
  MediaBlock,
} from './IContent.js';

/** Helper predicate: checks if content has valid blocks array with at least one element. */
function hasValidBlocks(content: IContent): boolean {
  const blocks: unknown = content.blocks;
  return Array.isArray(blocks) && blocks.length > 0;
}

/** Internal accumulator for the tool-response reassignment pass. */
interface ReassignMaps {
  responsesByToolCallIndex: Map<number, ToolResponseBlock[]>;
  mediaBlocksByToolCallIndex: Map<number, MediaBlock[]>;
  keptResponseByCallId: Map<
    string,
    {
      toolCallIndex: number;
      responseIndex: number;
      response: ToolResponseBlock;
    }
  >;
}

/**
 * Pure helpers that normalize tool call/response pairing and adjacency for
 * provider-facing history payloads. None of these functions mutate the stored
 * history; they produce new arrays.
 */
export class HistoryToolNormalization {
  /** Collect the set of call IDs that have a tool_response block. */
  static collectRespondedCallIds(contents: readonly IContent[]): Set<string> {
    const ids = new Set<string>();
    for (const content of contents) {
      if (!hasValidBlocks(content)) {
        continue;
      }
      for (const block of content.blocks) {
        if (block.type === 'tool_response' && block.callId) {
          ids.add(block.callId);
        }
      }
    }
    return ids;
  }

  /**
   * Providers expect tool calls to come from the assistant and tool results to
   * come from the tool role. If history corruption produces a single "tool"
   * message that contains both tool_call and tool_response blocks, split the
   * tool_call blocks into a separate assistant message directly before the tool
   * message.
   */
  static splitToolCallsOutOfToolMessages(contents: IContent[]): IContent[] {
    const result: IContent[] = [];

    for (const content of contents) {
      const split = HistoryToolNormalization.splitSingleToolContent(content);
      result.push(...split);
    }

    return result;
  }

  /** Split tool_call blocks out of a tool-speaker message if present. */
  private static splitSingleToolContent(content: IContent): IContent[] {
    if (content.speaker !== 'tool' || !hasValidBlocks(content)) {
      return [content];
    }

    const toolCalls = content.blocks.filter(
      (b): b is ToolCallBlock => b.type === 'tool_call',
    );

    if (toolCalls.length === 0) {
      return [content];
    }

    const remainingBlocks = content.blocks.filter(
      (b) => b.type !== 'tool_call',
    );

    const result: IContent[] = [
      {
        speaker: 'ai',
        blocks: toolCalls,
        metadata: {
          synthetic: true,
          reason: 'extracted_tool_call_from_tool_message',
        },
      },
    ];

    if (remainingBlocks.length > 0) {
      result.push({
        ...content,
        blocks: remainingBlocks,
      });
    }

    return result;
  }

  /**
   * Ensure every tool_response has a matching tool_call.
   * If compression removed the original tool_call, synthesize a minimal placeholder
   * so providers receive a structurally valid transcript without losing context.
   */
  static ensureToolCallContinuity(
    contents: IContent[],
    logger: DebugLogger,
  ): IContent[] {
    const seenToolCallIds = new Set<string>();
    const normalized: IContent[] = [];

    for (const content of contents) {
      HistoryToolNormalization.recordToolCallIds(content, seenToolCallIds);
      normalized.push(
        ...HistoryToolNormalization.injectMissingToolCalls(
          content,
          seenToolCallIds,
          logger,
        ),
      );
    }

    return normalized;
  }

  /** Record all tool_call IDs present in a content entry. */
  private static recordToolCallIds(
    content: IContent,
    seenToolCallIds: Set<string>,
  ): void {
    if (!hasValidBlocks(content)) {
      return;
    }
    for (const block of content.blocks) {
      if (block.type === 'tool_call') {
        seenToolCallIds.add(block.id);
      }
    }
  }

  /** Synthesize missing tool_call blocks for tool-speaker responses, if any. */
  private static injectMissingToolCalls(
    content: IContent,
    seenToolCallIds: Set<string>,
    logger: DebugLogger,
  ): IContent[] {
    if (content.speaker !== 'tool' || !hasValidBlocks(content)) {
      return [content];
    }

    const missingResponses = content.blocks.filter(
      (block): block is ToolResponseBlock =>
        block.type === 'tool_response' && !seenToolCallIds.has(block.callId),
    );

    if (missingResponses.length === 0) {
      return [content];
    }

    const reconstructedBlocks = missingResponses.map((response) => ({
      type: 'tool_call' as const,
      id: response.callId,
      name: response.toolName || 'unknown_tool',
      parameters: { reconstructed: true },
      description: 'Reconstructed tool call after compression',
    }));

    logger.warn('Synthesizing missing tool_call for responses', {
      callIds: reconstructedBlocks.map((block) => block.id),
      toolNames: reconstructedBlocks.map((block) => block.name),
    });

    for (const block of reconstructedBlocks) {
      seenToolCallIds.add(block.id);
    }

    return [
      {
        speaker: 'ai',
        blocks: reconstructedBlocks,
        metadata: {
          synthetic: true,
          reason: 'reconstructed_tool_call',
        },
      },
      content,
    ];
  }

  /**
   * Ensure every tool_call has a corresponding tool_response.
   * Synthesize a minimal "cancelled" tool result for orphaned calls.
   * Intentionally non-mutating.
   */
  static ensureToolResponseCompleteness(contents: IContent[]): IContent[] {
    const respondedCallIds =
      HistoryToolNormalization.collectRespondedCallIds(contents);

    const result: IContent[] = [];

    for (const content of contents) {
      result.push(content);
      const synthetic = HistoryToolNormalization.synthesizeMissingResponses(
        content,
        respondedCallIds,
      );
      if (synthetic) {
        result.push(synthetic);
      }
    }

    return result;
  }

  /** Build a synthetic tool-response message for orphaned tool calls, if any. */
  private static synthesizeMissingResponses(
    content: IContent,
    respondedCallIds: Set<string>,
  ): IContent | null {
    if (content.speaker !== 'ai' || !hasValidBlocks(content)) {
      return null;
    }

    const toolCalls = content.blocks.filter(
      (b): b is ToolCallBlock => b.type === 'tool_call',
    );
    if (toolCalls.length === 0) {
      return null;
    }

    const missing = toolCalls.filter(
      (tc) =>
        typeof tc.id === 'string' &&
        tc.id !== '' &&
        !respondedCallIds.has(tc.id),
    );
    if (missing.length === 0) {
      return null;
    }

    for (const tc of missing) {
      respondedCallIds.add(tc.id);
    }

    return {
      speaker: 'tool',
      blocks: missing.map(
        (tc): ToolResponseBlock => ({
          type: 'tool_response',
          callId: tc.id,
          toolName: tc.name || 'unknown_tool',
          result: null,
          error: 'Tool call interrupted or cancelled',
          isComplete: true,
        }),
      ),
      metadata: {
        synthetic: true,
        reason: 'orphaned_tool_call',
      },
    };
  }

  /**
   * Ensure tool responses appear immediately after the assistant message that
   * introduced their tool calls, and drop duplicate/out-of-order tool responses.
   */
  static ensureToolResponseAdjacency(
    contents: IContent[],
    logger: DebugLogger,
  ): IContent[] {
    const toolCallIndexById =
      HistoryToolNormalization.buildToolCallIndexById(contents);

    const maps: ReassignMaps = {
      responsesByToolCallIndex: new Map(),
      mediaBlocksByToolCallIndex: new Map(),
      keptResponseByCallId: new Map(),
    };

    const strippedContents = contents.map((content) =>
      HistoryToolNormalization.stripSingleContent(
        content,
        toolCallIndexById,
        maps,
        logger,
      ),
    );

    return HistoryToolNormalization.reassembleAdjacencyResult(
      strippedContents,
      maps.responsesByToolCallIndex,
      maps.mediaBlocksByToolCallIndex,
    );
  }

  /** Build a map from tool call ID to the index of the content containing it. */
  private static buildToolCallIndexById(
    contents: IContent[],
  ): Map<string, number> {
    const toolCallIndexById = new Map<string, number>();

    for (let i = 0; i < contents.length; i++) {
      const content = contents[i];
      if (!hasValidBlocks(content)) {
        continue;
      }
      for (const block of content.blocks) {
        if (block.type !== 'tool_call') {
          continue;
        }
        const id = block.id;
        if (id && !toolCallIndexById.has(id)) {
          toolCallIndexById.set(id, i);
        }
      }
    }

    return toolCallIndexById;
  }

  /** Score a tool response for dedup preference (higher is better). */
  private static scoreResponse(response: ToolResponseBlock): number {
    let score = 0;
    if (response.isComplete === true) {
      score += 2;
    }
    if (response.error) {
      score -= 1;
    }
    if (response.result !== undefined && response.result !== null) {
      score += 1;
    }
    return score;
  }

  /** Strip tool responses from a single content entry and reassign to tool-call index. */
  private static stripSingleContent(
    content: IContent,
    toolCallIndexById: Map<string, number>,
    maps: ReassignMaps,
    logger: DebugLogger,
  ): IContent | null {
    if (!hasValidBlocks(content)) {
      return content;
    }

    const toolResponseBlocks = content.blocks.filter(
      (b): b is ToolResponseBlock => b.type === 'tool_response',
    );

    if (toolResponseBlocks.length === 0) {
      return content;
    }

    const mediaBlocks = content.blocks.filter(
      (b): b is MediaBlock => b.type === 'media',
    );
    let mediaAssignedToIndex: number | undefined;

    for (const toolResponse of toolResponseBlocks) {
      mediaAssignedToIndex = HistoryToolNormalization.reassignSingleResponse(
        toolResponse,
        toolCallIndexById,
        maps,
        mediaBlocks,
        mediaAssignedToIndex,
        logger,
      );
    }

    const remainingBlocks = content.blocks.filter(
      (b) => b.type !== 'tool_response' && b.type !== 'media',
    );

    if (content.speaker === 'tool' || remainingBlocks.length === 0) {
      return null;
    }

    return {
      ...content,
      blocks: remainingBlocks,
    };
  }

  /** Reassign a single tool response to the correct tool-call index. */
  private static reassignSingleResponse(
    toolResponse: ToolResponseBlock,
    toolCallIndexById: Map<string, number>,
    maps: ReassignMaps,
    mediaBlocks: MediaBlock[],
    mediaAssignedToIndex: number | undefined,
    logger: DebugLogger,
  ): number | undefined {
    const { callId } = toolResponse;
    if (!callId) {
      return mediaAssignedToIndex;
    }

    const toolCallIndex = toolCallIndexById.get(callId);
    if (toolCallIndex === undefined) {
      logger.warn('Tool response missing matching tool call', {
        callId,
        toolName: toolResponse.toolName,
      });
      return mediaAssignedToIndex;
    }

    const existing = maps.keptResponseByCallId.get(callId);
    if (existing) {
      HistoryToolNormalization.replaceDuplicateResponse(
        existing,
        toolResponse,
        maps,
      );
      return mediaAssignedToIndex;
    }

    const list = maps.responsesByToolCallIndex.get(toolCallIndex) ?? [];
    list.push(toolResponse);
    maps.responsesByToolCallIndex.set(toolCallIndex, list);
    maps.keptResponseByCallId.set(callId, {
      toolCallIndex,
      responseIndex: list.length - 1,
      response: toolResponse,
    });

    return HistoryToolNormalization.assignMedia(
      mediaBlocks,
      mediaAssignedToIndex,
      toolCallIndex,
      maps,
    );
  }

  /** Replace a duplicate response if the new one scores higher. */
  private static replaceDuplicateResponse(
    existing: {
      toolCallIndex: number;
      responseIndex: number;
      response: ToolResponseBlock;
    },
    toolResponse: ToolResponseBlock,
    maps: ReassignMaps,
  ): void {
    const existingScore = HistoryToolNormalization.scoreResponse(
      existing.response,
    );
    const newScore = HistoryToolNormalization.scoreResponse(toolResponse);
    if (newScore <= existingScore) {
      return;
    }
    const list = maps.responsesByToolCallIndex.get(existing.toolCallIndex);
    if (list) {
      list[existing.responseIndex] = toolResponse;
      maps.keptResponseByCallId.set(toolResponse.callId, {
        toolCallIndex: existing.toolCallIndex,
        responseIndex: existing.responseIndex,
        response: toolResponse,
      });
    }
  }

  /** Assign media blocks to a tool-call index, if not already assigned. */
  private static assignMedia(
    mediaBlocks: MediaBlock[],
    mediaAssignedToIndex: number | undefined,
    toolCallIndex: number,
    maps: ReassignMaps,
  ): number | undefined {
    if (mediaBlocks.length === 0 || mediaAssignedToIndex !== undefined) {
      return mediaAssignedToIndex;
    }
    const existingMedia =
      maps.mediaBlocksByToolCallIndex.get(toolCallIndex) ?? [];
    maps.mediaBlocksByToolCallIndex.set(toolCallIndex, [
      ...existingMedia,
      ...mediaBlocks,
    ]);
    return toolCallIndex;
  }

  /** Reassemble stripped contents with tool responses after their tool-call messages. */
  private static reassembleAdjacencyResult(
    strippedContents: Array<IContent | null>,
    responsesByToolCallIndex: Map<number, ToolResponseBlock[]>,
    mediaBlocksByToolCallIndex: Map<number, MediaBlock[]>,
  ): IContent[] {
    const result: IContent[] = [];

    for (let i = 0; i < strippedContents.length; i++) {
      const content = strippedContents[i];
      if (content) {
        result.push(content);
      }

      const responses = responsesByToolCallIndex.get(i);
      if (responses && responses.length > 0) {
        const mediaForThisIndex = mediaBlocksByToolCallIndex.get(i) ?? [];
        result.push({
          speaker: 'tool',
          blocks: [...responses, ...mediaForThisIndex],
          metadata: {
            synthetic: true,
            reason: 'reordered_tool_responses',
          },
        });
      }
    }

    return result;
  }
}
