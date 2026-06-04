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

/* eslint-disable complexity, sonarjs/cognitive-complexity -- Phase 5: legacy core boundary retained while larger decomposition continues. */

import { randomUUID } from 'crypto';
import { type Content, type Part } from '@google/genai';
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
 * Converts between Gemini Content format and IContent format
 */
export class ContentConverters {
  private static logger = new DebugLogger('llxprt:content:converters');

  private static blocksOrEmpty(iContent: IContent): ContentBlock[] {
    const blocks = (iContent as { blocks?: ContentBlock[] | null }).blocks;
    return blocks ?? [];
  }

  private static hasLegacyTruthyValue(value: unknown): boolean {
    return (
      // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      value !== null &&
      value !== undefined &&
      value !== false &&
      value !== 0 &&
      value !== '' &&
      !(typeof value === 'number' && Number.isNaN(value))
    );
  }

  /** Resolve the Gemini role from an IContent speaker. */
  private static resolveRole(speaker: string): 'user' | 'model' {
    if (speaker === 'tool' || speaker === 'human') {
      return 'user';
    }
    return 'model';
  }

  /** Convert a single IContent block to a Gemini Part. */
  private static blockToPart(block: ContentBlock): Part | null {
    switch (block.type) {
      case 'text': {
        const textBlock = block;
        return { text: textBlock.text };
      }
      case 'tool_call': {
        const toolCall = block;
        this.logger.debug('Converting tool_call block to functionCall:', {
          id: toolCall.id,
          name: toolCall.name,
          hasParameters: ContentConverters.hasLegacyTruthyValue(
            toolCall.parameters,
          ),
        });
        return {
          functionCall: {
            name: toolCall.name,
            args: toolCall.parameters as Record<string, unknown>,
            id: toolCall.id,
          },
        };
      }
      case 'tool_response': {
        const toolResponse = block;
        this.logger.debug(
          'Converting tool_response block to functionResponse:',
          {
            callId: toolResponse.callId,
            toolName: toolResponse.toolName,
            hasResult: ContentConverters.hasLegacyTruthyValue(
              toolResponse.result,
            ),
            hasError: ContentConverters.hasLegacyTruthyValue(
              toolResponse.error,
            ),
          },
        );
        return {
          functionResponse: {
            name: toolResponse.toolName,
            response: toolResponse.result as Record<string, unknown>,
            id: toolResponse.callId,
          },
        };
      }
      case 'thinking': {
        const thinkingBlock = block;
        const thinkingPart: Part = {
          thought: true,
          text: thinkingBlock.thought,
        };
        if (ContentConverters.hasLegacyTruthyValue(thinkingBlock.signature)) {
          thinkingPart.thoughtSignature = thinkingBlock.signature;
        }
        if (ContentConverters.hasLegacyTruthyValue(thinkingBlock.sourceField)) {
          (
            thinkingPart as Part & {
              llxprtSourceField?: ThinkingBlock['sourceField'];
            }
          ).llxprtSourceField = thinkingBlock.sourceField;
        }
        return thinkingPart;
      }
      case 'media': {
        return null;
      }
      case 'code': {
        const codeBlock = block;
        const codeText = codeBlock.language
          ? `\`\`\`${codeBlock.language}\n${codeBlock.code}\n\`\`\``
          : codeBlock.code;
        return { text: codeText };
      }
      default:
        return null;
    }
  }

  /**
   * Convert IContent to Gemini Content format
   */
  static toGeminiContent(iContent: IContent): Content {
    const blocksForDebug = ContentConverters.blocksOrEmpty(iContent);
    this.logger.debug('Converting IContent to Gemini Content:', {
      speaker: iContent.speaker,
      blockCount: blocksForDebug.length,
      blockTypes: blocksForDebug.map((b) => b.type),
      toolCallIds: blocksForDebug
        .filter((b) => b.type === 'tool_call')
        .map((b) => b.id),
      toolResponseCallIds: blocksForDebug
        .filter((b) => b.type === 'tool_response')
        .map((b) => b.callId),
    });

    const role = this.resolveRole(iContent.speaker);
    const parts: Part[] = [];

    for (const block of iContent.blocks) {
      const part = this.blockToPart(block);
      if (part !== null) {
        parts.push(part);
      }
    }

    const result = { role, parts };
    this.logger.debug('Converted to Gemini Content:', {
      role,
      partCount: parts.length,
      partTypes: parts.map((p) => {
        if ('text' in p) return 'text';
        if ('functionCall' in p) return 'functionCall';
        if ('functionResponse' in p) return 'functionResponse';
        if ('thought' in p) return 'thought';
        return 'other';
      }),
      functionCallIds: parts
        .filter((p) => 'functionCall' in p)
        .map((p) => (p as { functionCall?: { id?: string } }).functionCall?.id),
      functionResponseIds: parts
        .filter((p) => 'functionResponse' in p)
        .map(
          (p) =>
            (p as { functionResponse?: { id?: string } }).functionResponse?.id,
        ),
    });

    return result;
  }

  /** Convert a thinking/thought Part into a ThinkingBlock. */
  private static partToThinkingBlock(part: Part): ThinkingBlock {
    const partWithMetadata = part as Part & {
      llxprtSourceField?: ThinkingBlock['sourceField'];
    };
    const sourceField = partWithMetadata.llxprtSourceField ?? 'thought';
    const thinkingBlock: ThinkingBlock = {
      type: 'thinking',
      thought: part.text ?? '',
      isHidden: true,
      sourceField,
    };
    if (part.thoughtSignature) {
      thinkingBlock.signature = part.thoughtSignature;
    }
    return thinkingBlock;
  }

  /** Safely parse a functionResponse.response into a Record. */
  private static parseFunctionResponseResult(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Gemini SDK types
    response: any,
    callId: string,
  ): Record<string, unknown> {
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions -- Gemini SDK response may be any type
    if (!response) {
      return {};
    }
    return ContentConverters.parseResponseValue(response, callId);
  }

  /** Parse a non-null/non-undefined response value into a Record. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Gemini SDK types
  private static parseResponseValue(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Gemini SDK types
    response: any,
    callId: string,
  ): Record<string, unknown> {
    // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    try {
      if (
        typeof response === 'object' &&
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Persisted history content data.
        response !== null
      ) {
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
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/strict-boolean-expressions -- empty string is valid fallback; any-type response from Gemini SDK
        output: String(response || ''),
      };
    }
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
    part: Part,
    context: {
      turnKey: string;
      providerName: string;
      generateIdCb?: () => string;
    },
    callIndex: number,
  ): { blocks: ContentBlock[]; callIndex: number } {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty string is valid for tool name
    const toolName = part.functionCall!.name || '';
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
    part: Part,
    context: {
      turnKey: string;
      providerName: string;
      generateIdCb?: () => string;
      getNextUnmatchedToolCall?: () => { historyId: string; toolName?: string };
    },
    responseIndex: number,
  ): { blocks: ContentBlock[]; responseIndex: number } {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty string is valid for tool name
    const toolName = part.functionResponse!.name || '';
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
    const result = ContentConverters.parseFunctionResponseResult(
      part.functionResponse!.response,
      callId,
    );

    const blocks: ContentBlock[] = [
      {
        type: 'tool_response',
        callId,
        /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- empty string is valid for tool name */
        toolName: matched?.toolName || part.functionResponse!.name || '',
        /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
        result,
      },
    ];
    return { blocks, responseIndex: responseIndex + 1 };
  }

  /** Convert a single Gemini Part into ContentBlocks, returning any tool-call index counters. */
  private static processPartToBlocks(
    part: Part,
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
      // Check if this is a thinking block
      // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      if (
        'thought' in part &&
        ContentConverters.hasLegacyTruthyValue(part.thought)
      ) {
        blocks.push(ContentConverters.partToThinkingBlock(part));
      } else {
        blocks.push({
          type: 'text',
          text: part.text,
        });
      }
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
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty string is valid fallback for mimeType
        mimeType: part.inlineData.mimeType || '',
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty string is valid fallback for data
        data: part.inlineData.data || '',
        encoding: 'base64',
      });
    }

    return { blocks, callIndex, responseIndex };
  }

  /**
   * Convert Gemini Content to IContent format
   */
  static toIContent(
    content: Content,
    generateIdCb?: () => string,
    getNextUnmatchedToolCall?: () => { historyId: string; toolName?: string },
    turnKeyOverride?: string,
  ): IContent {
    this.logger.debug('Converting Gemini Content to IContent:', {
      role: content.role,
      partCount: content.parts?.length ?? 0,
      partTypes:
        content.parts?.map((p) => {
          if ('text' in p) return 'text';
          if ('functionCall' in p) return 'functionCall';
          if ('functionResponse' in p) return 'functionResponse';
          if ('thought' in p) return 'thought';
          return 'other';
        }) ?? [],
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
   * Convert array of IContent to array of Gemini Content
   */
  static toGeminiContents(iContents: IContent[]): Content[] {
    this.logger.debug('Converting IContent array to Gemini Contents:', {
      count: iContents.length,
      speakers: iContents.map((ic) => ic.speaker),
      totalToolCalls: iContents.reduce(
        (acc, ic) =>
          acc + ic.blocks.filter((b) => b.type === 'tool_call').length,
        0,
      ),
      totalToolResponses: iContents.reduce(
        (acc, ic) =>
          acc + ic.blocks.filter((b) => b.type === 'tool_response').length,
        0,
      ),
    });

    const results = iContents.map((ic) => this.toGeminiContent(ic));

    this.logger.debug('Conversion complete:', {
      resultCount: results.length,
      roles: results.map((r) => r.role),
    });

    return results;
  }

  /**
   * Convert array of Gemini Content to array of IContent
   */
  static toIContents(contents: Content[]): IContent[] {
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
