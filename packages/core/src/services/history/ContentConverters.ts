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
import { type Content, type Part } from '@google/genai';
import type {
  IContent,
  ContentBlock,
  TextBlock,
  ToolCallBlock,
  ToolResponseBlock,
  ThinkingBlock,
} from './IContent.js';
import { DebugLogger } from '../../debug/index.js';
import {
  canonicalizeToolCallId,
  canonicalizeToolResponseId,
} from './canonicalToolIds.js';

/**
 * Converts between Gemini Content format and IContent format
 */
export class ContentConverters {
  private static logger = new DebugLogger('llxprt:content:converters');
  /**
   * Convert IContent to Gemini Content format
   */
  static toGeminiContent(iContent: IContent): Content {
    this.logger.debug('Converting IContent to Gemini Content:', {
      speaker: iContent.speaker,
      blockCount: iContent.blocks?.length || 0,
      blockTypes: iContent.blocks?.map((b) => b.type) || [],
      toolCallIds:
        iContent.blocks
          ?.filter((b) => b.type === 'tool_call')
          .map((b) => (b as ToolCallBlock).id) || [],
      toolResponseCallIds:
        iContent.blocks
          ?.filter((b) => b.type === 'tool_response')
          .map((b) => (b as ToolResponseBlock).callId) || [],
    });
    // Tool responses should have 'user' role in Gemini format
    let role: 'user' | 'model';
    if (iContent.speaker === 'tool') {
      role = 'user';
    } else if (iContent.speaker === 'human') {
      role = 'user';
    } else {
      role = 'model';
    }
    const parts: Part[] = [];

    for (const block of iContent.blocks) {
      switch (block.type) {
        case 'text': {
          const textBlock = block as TextBlock;
          parts.push({ text: textBlock.text });
          break;
        }
        case 'tool_call': {
          const toolCall = block as ToolCallBlock;
          this.logger.debug('Converting tool_call block to functionCall:', {
            id: toolCall.id,
            name: toolCall.name,
            hasParameters: !!toolCall.parameters,
          });
          parts.push({
            functionCall: {
              name: toolCall.name,
              args: toolCall.parameters as Record<string, unknown>,
              id: toolCall.id,
            },
          });
          break;
        }
        case 'tool_response': {
          const toolResponse = block as ToolResponseBlock;
          this.logger.debug(
            'Converting tool_response block to functionResponse:',
            {
              callId: toolResponse.callId,
              toolName: toolResponse.toolName,
              hasResult: !!toolResponse.result,
              hasError: !!toolResponse.error,
            },
          );
          parts.push({
            functionResponse: {
              name: toolResponse.toolName,
              response: toolResponse.result as Record<string, unknown>,
              id: toolResponse.callId,
            },
          });
          break;
        }
        case 'thinking': {
          const thinkingBlock = block as ThinkingBlock;
          const thinkingPart: Part = {
            thought: true,
            text: thinkingBlock.thought,
          };
          if (thinkingBlock.signature) {
            thinkingPart.thoughtSignature = thinkingBlock.signature;
          }
          if (thinkingBlock.sourceField) {
            (
              thinkingPart as Part & {
                llxprtSourceField?: ThinkingBlock['sourceField'];
              }
            ).llxprtSourceField = thinkingBlock.sourceField;
          }
          parts.push(thinkingPart);
          break;
        }
        case 'media': {
          // Media blocks can be converted to inline data parts
          // For now, we'll skip these as GeminiChat doesn't handle them yet
          break;
        }
        case 'code': {
          // Code blocks are treated as text in Gemini format
          const codeBlock = block;
          const codeText = codeBlock.language
            ? `\`\`\`${codeBlock.language}\n${codeBlock.code}\n\`\`\``
            : codeBlock.code;
          parts.push({ text: codeText });
          break;
        }
        default:
          // Ignore unknown block types
          break;
      }
    }

    // Keep empty parts array for empty model responses
    // This is valid in Gemini Content format

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
      partCount: content.parts?.length || 0,
      partTypes:
        content.parts?.map((p) => {
          if ('text' in p) return 'text';
          if ('functionCall' in p) return 'functionCall';
          if ('functionResponse' in p) return 'functionResponse';
          if ('thought' in p) return 'thought';
          return 'other';
        }) || [],
      functionCallIds:
        content.parts
          ?.filter((p) => 'functionCall' in p)
          .map(
            (p) => (p as { functionCall?: { id?: string } }).functionCall?.id,
          ) || [],
      functionResponseIds:
        content.parts
          ?.filter((p) => 'functionResponse' in p)
          .map(
            (p) =>
              (p as { functionResponse?: { id?: string } }).functionResponse
                ?.id,
          ) || [],
    });
    const speaker = content.role === 'user' ? 'human' : 'ai';
    const blocks: ContentBlock[] = [];
    const metadata: IContent['metadata'] = {};
    const turnKey = turnKeyOverride ?? generateTurnKey();
    const providerName = 'gemini';
    let callIndex = 0;
    let responseIndex = 0;

    // Handle empty parts array explicitly
    if (!content.parts || content.parts.length === 0) {
      // Empty content - keep it empty
      // This represents an empty model response
    } else if (content.parts) {
      for (const part of content.parts) {
        if ('text' in part && part.text !== undefined) {
          // Check if this is a thinking block
          if ('thought' in part && part.thought) {
            const partWithMetadata = part as Part & {
              llxprtSourceField?: ThinkingBlock['sourceField'];
            };
            const sourceField = partWithMetadata.llxprtSourceField ?? 'thought';
            const thinkingBlock: ThinkingBlock = {
              type: 'thinking',
              thought: part.text,
              isHidden: true,
              sourceField,
            };
            if (part.thoughtSignature) {
              thinkingBlock.signature = part.thoughtSignature;
            }
            blocks.push(thinkingBlock);
          } else {
            blocks.push({
              type: 'text',
              text: part.text,
            });
          }
        } else if ('functionCall' in part && part.functionCall) {
          const toolName = part.functionCall.name || '';
          const rawId = part.functionCall.id;
          const generatedId =
            !rawId && generateIdCb ? generateIdCb() : undefined;
          const finalId = generatedId
            ? generatedId
            : canonicalizeToolCallId({
                providerName,
                rawId,
                toolName,
                turnKey,
                callIndex,
              });
          this.logger.debug('Converting functionCall to tool_call block:', {
            originalId: part.functionCall.id,
            finalId,
            name: part.functionCall.name,
            usedCallback: !!generatedId,
          });
          blocks.push({
            type: 'tool_call',
            id: finalId,
            name: toolName,
            parameters:
              (part.functionCall.args as Record<string, unknown>) || {},
          });
          callIndex += 1;
        } else if ('functionResponse' in part && part.functionResponse) {
          const toolName = part.functionResponse.name || '';
          const rawId = part.functionResponse.id;
          const matched = !rawId ? getNextUnmatchedToolCall?.() : undefined;
          const generatedId =
            !rawId && !matched && generateIdCb ? generateIdCb() : undefined;
          const callId = matched?.historyId
            ? matched.historyId
            : (generatedId ??
              canonicalizeToolResponseId({
                providerName,
                rawId,
                toolName,
                turnKey,
                callIndex: responseIndex,
              }));
          this.logger.debug(
            'Converting functionResponse to tool_response block:',
            {
              originalId: part.functionResponse.id,
              finalId: callId,
              toolName: part.functionResponse.name,
              matchedByPosition: !!matched,
            },
          );
          // Safely handle the response field which might not be a valid Record
          let result: Record<string, unknown> = {};
          try {
            if (part.functionResponse.response) {
              if (
                typeof part.functionResponse.response === 'object' &&
                part.functionResponse.response !== null
              ) {
                // If it's already an object, use it directly
                result = part.functionResponse.response as Record<
                  string,
                  unknown
                >;
              } else if (typeof part.functionResponse.response === 'string') {
                // If it's a string, try to parse as JSON, otherwise wrap it
                try {
                  const parsed = JSON.parse(part.functionResponse.response);
                  result =
                    typeof parsed === 'object' && parsed !== null
                      ? parsed
                      : { output: part.functionResponse.response };
                } catch {
                  // Not valid JSON, wrap the string
                  result = { output: part.functionResponse.response };
                }
              } else {
                // For other types, stringify and wrap
                result = { output: String(part.functionResponse.response) };
              }
            }
          } catch (error) {
            this.logger.warn(
              () =>
                `Failed to process functionResponse.response for ${callId}: ${error}`,
              {
                originalResponse: part.functionResponse.response,
                error,
              },
            );
            result = {
              error: 'Failed to process tool response',
              output: String(part.functionResponse.response || ''),
            };
          }

          blocks.push({
            type: 'tool_response',
            callId,
            toolName: (matched?.toolName ||
              part.functionResponse.name ||
              '') as string,
            result,
          });
          responseIndex += 1;
        } else if ('inlineData' in part && part.inlineData) {
          // Handle inline data (media)
          blocks.push({
            type: 'media',
            mimeType: part.inlineData.mimeType || '',
            data: part.inlineData.data || '',
            encoding: 'base64',
          });
        }
      }
    }

    // Handle tool responses specially - they should have 'tool' speaker
    // Tool responses come from user role but are tool speaker in IContent
    // Check if ANY block is a tool_response (not just if ALL are)
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
        .map((b) => (b as ToolCallBlock).id),
      toolResponseCallIds: blocks
        .filter((b) => b.type === 'tool_response')
        .map((b) => (b as ToolResponseBlock).callId),
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
          acc + (c.parts?.filter((p) => 'functionCall' in p).length || 0),
        0,
      ),
      totalFunctionResponses: contents.reduce(
        (acc, c) =>
          acc + (c.parts?.filter((p) => 'functionResponse' in p).length || 0),
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

function generateTurnKey(): string {
  return `turn_${randomUUID()}`;
}
