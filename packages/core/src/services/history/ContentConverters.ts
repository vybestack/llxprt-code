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

/**
 * Converts between Gemini Content format and IContent format
 */
export class ContentConverters {
  private static logger = new DebugLogger('llxprt:content:converters');
  private static normalizeToHistoryId(
    id: string | undefined,
  ): string | undefined {
    if (!id) return undefined;
    if (id.startsWith('hist_tool_')) return id;

    let candidate = id;
    let didStrip = true;

    while (didStrip) {
      didStrip = false;

      if (candidate.startsWith('call_')) {
        candidate = candidate.substring('call_'.length);
        didStrip = true;
        continue;
      }

      if (candidate.startsWith('toolu_')) {
        candidate = candidate.substring('toolu_'.length);
        didStrip = true;
        continue;
      }

      // Some systems can produce malformed OpenAI-style call ids:
      // - missing underscore: "call3or3..."
      // - double-prefixed: "call_call3or3..." or "call_call_3or3..."
      //
      // When we see a "call" prefix without the underscore, strip it
      // if the suffix looks like a real OpenAI call id token.
      if (candidate.startsWith('call') && !candidate.startsWith('call_')) {
        const suffix = candidate.substring('call'.length);
        const looksLikeToken =
          suffix.length >= 8 && /^[a-zA-Z0-9]+$/.test(suffix);
        if (looksLikeToken) {
          candidate = suffix;
          didStrip = true;
          continue;
        }
      }
    }

    if (!candidate) return undefined;

    // Unknown provider format: preserve suffix, add history prefix
    return `hist_tool_${candidate}`;
  }
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
          parts.push({
            thought: true,
            text: thinkingBlock.thought,
          });
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

    // Handle empty parts array explicitly
    if (!content.parts || content.parts.length === 0) {
      // Empty content - keep it empty
      // This represents an empty model response
    } else if (content.parts) {
      for (const part of content.parts) {
        if ('text' in part && part.text !== undefined) {
          // Check if this is a thinking block
          if ('thought' in part && part.thought) {
            blocks.push({
              type: 'thinking',
              thought: part.text,
              isHidden: true,
            });
          } else {
            blocks.push({
              type: 'text',
              text: part.text,
            });
          }
        } else if ('functionCall' in part && part.functionCall) {
          // Preserve original ID by normalizing prefix; generate only if missing.
          const normalized = this.normalizeToHistoryId(part.functionCall.id);
          const finalId =
            normalized ?? (generateIdCb ? generateIdCb() : generateId());
          this.logger.debug('Converting functionCall to tool_call block:', {
            originalId: part.functionCall.id,
            finalId,
            name: part.functionCall.name,
            usedCallback: !!generateIdCb && !normalized,
          });
          blocks.push({
            type: 'tool_call',
            id: finalId,
            name: part.functionCall.name || '',
            parameters:
              (part.functionCall.args as Record<string, unknown>) || {},
          });
        } else if ('functionResponse' in part && part.functionResponse) {
          // Prefer provided ID (normalized). If absent, use positional matcher; else generate.
          const normalized = this.normalizeToHistoryId(
            part.functionResponse.id,
          );
          const matched = !normalized
            ? getNextUnmatchedToolCall?.()
            : undefined;
          const callId =
            normalized ??
            matched?.historyId ??
            (generateIdCb ? generateIdCb() : generateId());
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

    const result: IContent = {
      speaker: finalSpeaker,
      blocks,
      metadata: {},
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

/**
 * Generate a unique ID for tool calls
 */
function generateId(): string {
  // Use normalized history ID prefix; providers convert prefixes as needed.
  return `hist_tool_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}
