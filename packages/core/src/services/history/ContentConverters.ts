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

import { randomUUID } from 'crypto';
import type {
  GeminiContent,
  GeminiContentPart,
} from '../../llm-types/geminiContent.js';
import type { IContent, ContentBlock, ThinkingBlock } from './IContent.js';
import { DebugLogger } from '../../debug/index.js';
import {
  canonicalizeToolCallId,
  canonicalizeToolResponseId,
} from './canonicalToolIds.js';

function generateTurnKey(): string {
  return `turn_${randomUUID()}`;
}

/**
 * Maps a Gemini Content part to a human-readable type label for logging.
 * Used by both `logToIContentInput` and the zero-block warning so they
 * produce consistent output for cross-referencing during debugging.
 */
function classifyPartType(part: GeminiContentPart): string {
  if ('text' in part) return 'text';
  if ('functionCall' in part) return 'functionCall';
  if ('functionResponse' in part) return 'functionResponse';
  if ('inlineData' in part) return 'inlineData';
  if ('thought' in part) return 'thought';
  return 'other';
}

/**
 * Converts Gemini-shaped Content into the neutral IContent format
 */
export class ContentConverters {
  private static logger = new DebugLogger('llxprt:content:converters');

  private static hasLegacyTruthyValue(value: unknown): boolean {
    if (value === null || value === undefined) {
      return false;
    }
    if (value === false || value === 0 || value === '') {
      return false;
    }
    return !(typeof value === 'number' && Number.isNaN(value));
  }

  /** Convert a thinking/thought Part into a ThinkingBlock. */
  private static partToThinkingBlock(part: GeminiContentPart): ThinkingBlock {
    const sourceField = part.llxprtSourceField ?? 'thought';
    const thinkingBlock: ThinkingBlock = {
      type: 'thinking',
      thought: part.text ?? '',
      sourceField,
    };
    if (part.llxprtThoughtIsHidden !== undefined) {
      thinkingBlock.isHidden = part.llxprtThoughtIsHidden;
    }
    if (part.thoughtSignature) {
      thinkingBlock.signature = part.thoughtSignature;
    }
    if (part.llxprtThoughtBlockId) {
      thinkingBlock.streamId = part.llxprtThoughtBlockId;
    }
    if (part.llxprtThoughtBlockStatus) {
      thinkingBlock.streamStatus = part.llxprtThoughtBlockStatus;
    }
    return thinkingBlock;
  }

  /** Safely parse a functionResponse.response into a Record. */
  private static parseFunctionResponseResult(
    response: unknown,
    callId: string,
  ): Record<string, unknown> {
    if (response === null || response === undefined) {
      return {};
    }
    return ContentConverters.parseResponseValue(response, callId);
  }

  /**
   * Detect the Gemini-shaped failure envelope (issue #3076) and decode it
   * verbatim. The envelope is only trusted when the part carries the
   * `llxprtToolFailure` discriminant (checked by the caller); a successful
   * tool whose result merely happens to be shaped like
   * `{ status: 'error', ... }` is never misdecoded. Returns null for any
   * non-envelope response so the caller keeps the
   * existing string/JSON coercion path untouched. The envelope's `result`
   * is restored verbatim — it must NOT go through parseFunctionResponseResult,
   * the whole point being fidelity to the original block. The one normalization
   * is the omitted-key case: an original `result` of `undefined` is not encoded
   * at all and comes back as `{}`, matching the pre-existing empty-response
   * convention.
   */
  private static decodeFailureEnvelope(
    response: unknown,
  ): { error: string; result: unknown } | null {
    if (!ContentConverters.isPlainObject(response)) {
      return null;
    }
    if (response.status !== 'error' || typeof response.error !== 'string') {
      return null;
    }
    const result = 'result' in response ? response.result : {};
    return { error: response.error, result };
  }

  /** Parse a non-null/non-undefined response value into a Record. */
  private static parseResponseValue(
    response: unknown,
    callId: string,
  ): Record<string, unknown> {
    try {
      if (ContentConverters.isPlainObject(response)) {
        return response;
      }
      if (typeof response === 'string') {
        return ContentConverters.parseStringResponse(response);
      }
      return { output: String(response) };
    } catch (error) {
      this.logger.warn(
        () =>
          `Failed to process functionResponse.response for ${callId}: ${error}`,
        {
          originalResponse: response,
          error,
        },
      );
      return {
        error: 'Failed to process tool response',
        output: ContentConverters.stringifyWithEmptyFallback(response),
      };
    }
  }

  /** Type guard: value is a non-null object (not an array, but Record-compatible). */
  private static isPlainObject(
    value: unknown,
  ): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  /** Stringify a possibly-falsy value, falling back to empty string. */
  private static stringifyWithEmptyFallback(response: unknown): string {
    return response !== null && response !== undefined ? String(response) : '';
  }

  /** Return the first non-empty string argument, or '' if none match. */
  private static firstNonEmpty(...values: Array<string | undefined>): string {
    for (const value of values) {
      if (value !== undefined && value !== '') {
        return value;
      }
    }
    return '';
  }

  /** Parse a string response value, trying JSON parse first. */
  private static parseStringResponse(
    response: string,
  ): Record<string, unknown> {
    try {
      const parsed = JSON.parse(response);
      return typeof parsed === 'object' && parsed !== null
        ? parsed
        : { output: response };
    } catch {
      return { output: response };
    }
  }

  /** Convert a functionCall Part into tool_call ContentBlock(s). */
  private static processFunctionCallPart(
    part: GeminiContentPart,
    context: {
      turnKey: string;
      providerName: string;
      generateIdCb?: () => string;
    },
    callIndex: number,
  ): { blocks: ContentBlock[]; callIndex: number } {
    const toolName = part.functionCall!.name ?? '';
    const rawId = part.functionCall!.id;
    const generatedId =
      !rawId && context.generateIdCb ? context.generateIdCb() : undefined;
    const finalId =
      generatedId ??
      canonicalizeToolCallId({
        providerName: context.providerName,
        rawId,
        toolName,
        turnKey: context.turnKey,
        callIndex,
      });
    this.logger.debug('Converting functionCall to tool_call block:', {
      originalId: part.functionCall!.id,
      finalId,
      name: part.functionCall!.name,
      usedCallback: generatedId != null,
    });
    const functionCallArgs = part.functionCall!.args as Record<string, unknown>;
    const blocks: ContentBlock[] = [
      {
        type: 'tool_call',
        id: finalId,
        name: toolName,
        parameters: ContentConverters.hasLegacyTruthyValue(functionCallArgs)
          ? functionCallArgs
          : {},
      },
    ];
    return { blocks, callIndex: callIndex + 1 };
  }

  /** Convert a functionResponse Part into tool_response ContentBlock(s). */
  private static processFunctionResponsePart(
    part: GeminiContentPart,
    context: {
      turnKey: string;
      providerName: string;
      generateIdCb?: () => string;
      getNextUnmatchedToolCall?: () => { historyId: string; toolName?: string };
    },
    responseIndex: number,
  ): { blocks: ContentBlock[]; responseIndex: number } {
    const toolName = ContentConverters.firstNonEmpty(
      part.functionResponse!.name,
    );
    const rawId = part.functionResponse!.id;
    const matched = !rawId ? context.getNextUnmatchedToolCall?.() : undefined;
    const generatedId =
      !rawId && !matched && context.generateIdCb
        ? context.generateIdCb()
        : undefined;
    const callId =
      matched?.historyId ??
      generatedId ??
      canonicalizeToolResponseId({
        providerName: context.providerName,
        rawId,
        toolName,
        turnKey: context.turnKey,
        callIndex: responseIndex,
      });
    this.logger.debug('Converting functionResponse to tool_response block:', {
      originalId: part.functionResponse!.id,
      finalId: callId,
      toolName: part.functionResponse!.name,
      matchedByPosition: !!matched,
    });
    const resolvedToolName = ContentConverters.firstNonEmpty(
      matched?.toolName,
      part.functionResponse!.name,
    );
    const blocks: ContentBlock[] = [
      ContentConverters.buildToolResponseBlock(
        callId,
        resolvedToolName,
        part.functionResponse!.response,
        part.llxprtToolFailure === true,
      ),
    ];
    return { blocks, responseIndex: responseIndex + 1 };
  }

  /**
   * Build a tool_response block from a functionResponse payload. The issue
   * #3076 failure envelope is decoded verbatim ONLY when `isToolFailure` is
   * true (the part carried the `llxprtToolFailure` flag); any other response
   * shape keeps the existing string/JSON coercion unchanged.
   */
  private static buildToolResponseBlock(
    callId: string,
    toolName: string,
    response: unknown,
    isToolFailure: boolean,
  ): Extract<ContentBlock, { type: 'tool_response' }> {
    const failure = isToolFailure
      ? ContentConverters.decodeFailureEnvelope(response)
      : null;
    if (failure) {
      return {
        type: 'tool_response',
        callId,
        toolName,
        result: failure.result,
        error: failure.error,
      };
    }
    return {
      type: 'tool_response',
      callId,
      toolName,
      result: ContentConverters.parseFunctionResponseResult(response, callId),
    };
  }

  /** Convert a text-or-thought Part into a ContentBlock. */
  private static textPartToBlock(part: GeminiContentPart): ContentBlock {
    if (
      'thought' in part &&
      ContentConverters.hasLegacyTruthyValue(part.thought)
    ) {
      return ContentConverters.partToThinkingBlock(part);
    }
    return { type: 'text', text: part.text ?? '' };
  }

  /** Convert a single Gemini Part into ContentBlocks, returning any tool-call index counters. */
  private static processPartToBlocks(
    part: GeminiContentPart,
    context: {
      turnKey: string;
      providerName: string;
      generateIdCb?: () => string;
      getNextUnmatchedToolCall?: () => { historyId: string; toolName?: string };
    },
    indices: { callIndex: number; responseIndex: number },
  ): { blocks: ContentBlock[]; callIndex: number; responseIndex: number } {
    const blocks: ContentBlock[] = [];
    let { callIndex, responseIndex } = indices;

    if ('text' in part && part.text !== undefined) {
      blocks.push(ContentConverters.textPartToBlock(part));
    } else if ('functionCall' in part && part.functionCall) {
      const fcResult = this.processFunctionCallPart(part, context, callIndex);
      blocks.push(...fcResult.blocks);
      callIndex = fcResult.callIndex;
    } else if ('functionResponse' in part && part.functionResponse) {
      const frResult = this.processFunctionResponsePart(
        part,
        context,
        responseIndex,
      );
      blocks.push(...frResult.blocks);
      responseIndex = frResult.responseIndex;
    } else if ('inlineData' in part && part.inlineData) {
      blocks.push({
        type: 'media',
        mimeType: part.inlineData.mimeType ?? '',
        data: part.inlineData.data ?? '',
        encoding: 'base64',
      });
    }

    return { blocks, callIndex, responseIndex };
  }

  /**
   * Convert Gemini Content to IContent format
   */
  static toIContent(
    content: GeminiContent,
    generateIdCb?: () => string,
    getNextUnmatchedToolCall?: () => { historyId: string; toolName?: string },
    turnKeyOverride?: string,
  ): IContent {
    this.logToIContentInput(content);

    const speaker = content.role === 'user' ? 'human' : 'ai';
    const blocks: ContentBlock[] = [];
    const metadata: IContent['metadata'] = {};
    const turnKey = turnKeyOverride ?? generateTurnKey();
    const providerName = 'gemini';
    let callIndex = 0;
    let responseIndex = 0;

    const partContext = {
      turnKey,
      providerName,
      generateIdCb,
      getNextUnmatchedToolCall,
    };

    if (content.parts != null && content.parts.length > 0) {
      for (const part of content.parts) {
        const result = this.processPartToBlocks(part, partContext, {
          callIndex,
          responseIndex,
        });
        blocks.push(...result.blocks);
        callIndex = result.callIndex;
        responseIndex = result.responseIndex;
      }
    }

    const hasToolResponse = blocks.some((b) => b.type === 'tool_response');
    const finalSpeaker: 'human' | 'ai' | 'tool' =
      content.role === 'user' && hasToolResponse ? 'tool' : speaker;

    metadata.turnId = turnKey;

    const result: IContent = {
      speaker: finalSpeaker,
      blocks,
      metadata,
    };

    if (blocks.length === 0) {
      this.logger.warn(
        () =>
          `[ContentConverters] toIContent produced zero blocks (issue #2410) — this turn will be dropped by history`,
        {
          turnKey,
          role: content.role,
          partCount: content.parts?.length ?? 0,
          partTypes: content.parts?.map(classifyPartType) ?? [],
        },
      );
    }

    this.logger.debug('Converted to IContent:', {
      originalRole: content.role,
      finalSpeaker,
      blockCount: blocks.length,
      blockTypes: blocks.map((b) => b.type),
      toolCallIds: blocks
        .filter((b) => b.type === 'tool_call')
        .map((b) => b.id),
      toolResponseCallIds: blocks
        .filter((b) => b.type === 'tool_response')
        .map((b) => b.callId),
    });

    return result;
  }

  /**
   * Log raw Gemini Content details before conversion to IContent.
   * Extracted from toIContent to keep that method within complexity limits.
   */
  private static logToIContentInput(content: GeminiContent): void {
    this.logger.debug('Converting Gemini Content to IContent:', {
      role: content.role,
      partCount: content.parts?.length ?? 0,
      partTypes: content.parts?.map(classifyPartType) ?? [],
      functionCallIds:
        content.parts
          ?.filter((p) => 'functionCall' in p)
          .map(
            (p) => (p as { functionCall?: { id?: string } }).functionCall?.id,
          ) ?? [],
      functionResponseIds:
        content.parts
          ?.filter((p) => 'functionResponse' in p)
          .map(
            (p) =>
              (p as { functionResponse?: { id?: string } }).functionResponse
                ?.id,
          ) ?? [],
    });
  }

  /**
   * Convert array of Gemini Content to array of IContent
   */
  static toIContents(contents: GeminiContent[]): IContent[] {
    this.logger.debug('Converting Gemini Contents array to IContent:', {
      count: contents.length,
      roles: contents.map((c) => c.role),
      totalFunctionCalls: contents.reduce(
        (acc, c) =>
          acc + (c.parts?.filter((p) => 'functionCall' in p).length ?? 0),
        0,
      ),
      totalFunctionResponses: contents.reduce(
        (acc, c) =>
          acc + (c.parts?.filter((p) => 'functionResponse' in p).length ?? 0),
        0,
      ),
    });

    const results = contents.map((c) => this.toIContent(c));

    this.logger.debug('Conversion complete:', {
      resultCount: results.length,
      speakers: results.map((r) => r.speaker),
    });

    return results;
  }
}
