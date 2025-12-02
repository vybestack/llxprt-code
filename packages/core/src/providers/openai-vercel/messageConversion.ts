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

/**
 * @plan PLAN-20251127-OPENAIVERCEL.P06
 * @requirement REQ-OAV-MC-001 - Convert IContent to Vercel CoreMessage
 * @requirement REQ-OAV-MC-002 - Convert CoreMessage to IContent
 * @requirement REQ-OAV-MC-003 - Handle all message types (user, assistant, tool, system)
 * @requirement REQ-OAV-MC-004 - Handle tool calls and tool responses
 * @requirement REQ-OAV-MC-005 - Handle mixed content blocks
 */

import type {
  CoreMessage,
  CoreToolMessage,
  ToolCallPart,
  ToolResultPart,
} from 'ai';
import type {
  IContent,
  TextBlock,
  ToolCallBlock,
  ToolResponseBlock,
  ContentBlock,
  MediaBlock,
} from '../../services/history/IContent.js';
import {
  normalizeToHistoryToolId,
  normalizeToOpenAIToolId,
} from './toolIdUtils.js';
import {
  buildToolResponsePayload,
  EMPTY_TOOL_RESULT_PLACEHOLDER,
} from '../utils/toolResponsePayload.js';

/**
 * Convert IContent array to Vercel AI SDK CoreMessage array
 */
export function convertToVercelMessages(contents: IContent[]): CoreMessage[] {
  const messages: CoreMessage[] = [];

  for (const content of contents) {
    const metadata = (content as { metadata?: { role?: string } }).metadata;
    const metadataRole = metadata?.role;

    if (
      metadataRole === 'system' ||
      (content as { speaker: string }).speaker === 'system'
    ) {
      // Convert system messages
      const textBlocks = content.blocks.filter(
        (b: ContentBlock) => b.type === 'text',
      ) as TextBlock[];
      const text = textBlocks
        .map((b) => b.text)
        .filter((t) => t.length > 0)
        .join('\n');
      if (text) {
        messages.push({
          role: 'system',
          content: text,
        });
      }
    } else if (content.speaker === 'human') {
      // Convert human messages to user messages
      const textBlocks = content.blocks.filter(
        (b: ContentBlock) => b.type === 'text',
      ) as TextBlock[];
      const mediaBlocks = content.blocks.filter(
        (b: ContentBlock) => b.type === 'media',
      ) as MediaBlock[];
      const hasImages = mediaBlocks.length > 0;
      const text = textBlocks
        .map((b) => b.text)
        .filter((t) => t.length > 0)
        .join('\n');
      if (hasImages) {
        const parts: Array<
          { type: 'text'; text: string } | { type: 'image'; image: string }
        > = [];
        if (text) {
          parts.push({ type: 'text', text });
        }
        for (const media of mediaBlocks) {
          parts.push({
            type: 'image',
            image: normalizeImageData(media),
          });
        }
        if (parts.length > 0) {
          messages.push({
            role: 'user',
            content: parts,
          });
        }
      } else if (text) {
        messages.push({
          role: 'user',
          content: text,
        });
      }
    } else if (content.speaker === 'ai') {
      // Convert AI messages to assistant messages
      const textBlocks = content.blocks.filter(
        (b: ContentBlock) => b.type === 'text',
      ) as TextBlock[];
      const toolCallBlocks = content.blocks.filter(
        (b: ContentBlock) => b.type === 'tool_call',
      ) as ToolCallBlock[];

      const text = textBlocks
        .map((b) => b.text)
        .filter((t) => t.length > 0)
        .join('\n');

      if (toolCallBlocks.length > 0) {
        const contentParts: Array<
          { type: 'text'; text: string } | ToolCallPart
        > = [];

        if (text) {
          contentParts.push({ type: 'text', text });
        }

        for (const block of toolCallBlocks) {
          const toolCall = block as ToolCallBlock & { input?: unknown };
          const input =
            toolCall.input !== undefined ? toolCall.input : block.parameters;
          contentParts.push({
            type: 'tool-call',
            toolCallId: normalizeToOpenAIToolId(block.id),
            toolName: block.name,
            input,
          });
        }

        messages.push({
          role: 'assistant',
          content: contentParts,
        });
      } else if (text) {
        messages.push({
          role: 'assistant',
          content: text,
        });
      }
    } else if (content.speaker === 'tool') {
      // Convert tool messages to tool result messages
      const toolResponseBlocks = content.blocks.filter(
        (b: ContentBlock) => b.type === 'tool_response',
      ) as ToolResponseBlock[];

      if (toolResponseBlocks.length > 0) {
        const toolContent: ToolResultPart[] = toolResponseBlocks.map(
          (block) => {
            const payload = buildToolResponsePayload(block);
            const extBlock = block as ToolResponseBlock & {
              id?: string;
              callId?: string;
              name?: string;
              toolName?: string;
              isError?: boolean;
            };
            return {
              type: 'tool-result' as const,
              toolCallId: normalizeToOpenAIToolId(
                extBlock.callId || extBlock.id || '',
              ),
              toolName: extBlock.name || extBlock.toolName || '',
              output: {
                type: 'text',
                value: payload.result,
              },
            };
          },
        );

        const toolMessage: CoreToolMessage = {
          role: 'tool',
          content: toolContent,
        };
        messages.push(toolMessage);
      }
    }
  }

  return messages;
}

/**
 * Convert Vercel AI SDK CoreMessage array back to IContent array
 */
export function convertFromVercelMessages(messages: CoreMessage[]): IContent[] {
  const contents: IContent[] = [];

  for (const message of messages) {
    if (message.role === 'user') {
      // Convert user messages to human messages
      if (Array.isArray(message.content)) {
        const blocks: ContentBlock[] = [];
        for (const part of message.content) {
          const partType = (part as { type?: string }).type;

          if (typeof part === 'string') {
            if (part) {
              blocks.push({ type: 'text', text: part });
            }
            continue;
          }

          if (partType === 'text') {
            const text = (part as { text?: string }).text;
            if (text) {
              blocks.push({ type: 'text', text });
            }
          } else if (partType === 'image') {
            const imageData =
              (part as { image?: string; url?: string }).image ??
              (part as { url?: string }).url;
            if (imageData) {
              blocks.push({
                type: 'media',
                data: imageData,
                encoding: 'base64',
                mimeType: 'image/*',
              });
            }
          }
        }

        if (blocks.length > 0) {
          contents.push({
            speaker: 'human',
            blocks,
          });
        }
      } else {
        const text = typeof message.content === 'string' ? message.content : '';

        if (text) {
          contents.push({
            speaker: 'human',
            blocks: [
              {
                type: 'text',
                text,
              },
            ],
          });
        }
      }
    } else if (message.role === 'assistant') {
      // Convert assistant messages to AI messages
      const blocks: Array<TextBlock | ToolCallBlock | MediaBlock> = [];

      if (typeof message.content === 'string') {
        if (message.content) {
          blocks.push({
            type: 'text',
            text: message.content,
          });
        }
      } else if (Array.isArray(message.content)) {
        for (const part of message.content) {
          const partType = (part as { type?: string }).type;

          if (typeof part === 'string') {
            if (part) {
              blocks.push({
                type: 'text',
                text: part,
              });
            }
          } else if (partType === 'text') {
            const text = (part as { text?: string }).text;
            if (text) {
              blocks.push({
                type: 'text',
                text,
              });
            }
          } else if (partType === 'image') {
            const imageData =
              (part as { image?: string; url?: string }).image ??
              (part as { url?: string }).url;
            if (imageData) {
              blocks.push({
                type: 'media',
                data: imageData,
                encoding: 'base64',
                mimeType: 'image/*',
              });
            }
          } else if (partType === 'tool-call') {
            const toolPart = part as ToolCallPart & {
              args?: unknown;
            };
            const parameters =
              toolPart.input !== undefined ? toolPart.input : toolPart.args;
            const toolCallBlock: ToolCallBlock & { input?: unknown } = {
              type: 'tool_call',
              id: normalizeToHistoryToolId(toolPart.toolCallId),
              name: toolPart.toolName,
              parameters,
            };
            if (toolPart.input !== undefined) {
              toolCallBlock.input = toolPart.input;
            }
            blocks.push(toolCallBlock);
          }
        }
      }

      // Handle toolInvocations if present (extended message format)
      const extendedMessage = message as unknown as {
        toolInvocations?: Array<{
          state: string;
          toolCallId: string;
          toolName: string;
          args: unknown;
        }>;
      };
      if (
        extendedMessage.toolInvocations &&
        extendedMessage.toolInvocations.length > 0
      ) {
        for (const invocation of extendedMessage.toolInvocations) {
          if (invocation.state === 'call') {
            blocks.push({
              type: 'tool_call',
              id: normalizeToHistoryToolId(invocation.toolCallId),
              name: invocation.toolName,
              parameters: invocation.args,
            });
          }
        }
      }

      if (blocks.length > 0) {
        contents.push({
          speaker: 'ai',
          blocks,
        });
      }
    } else if (message.role === 'tool') {
      // Convert tool messages to tool response messages
      const blocks: ToolResponseBlock[] = [];

      for (const part of message.content) {
        if (part.type === 'tool-result') {
          const output = (part as { output?: unknown }).output;
          const isErrorOutput =
            output &&
            typeof output === 'object' &&
            'type' in (output as { type?: string }) &&
            typeof (output as { type?: string }).type === 'string' &&
            (output as { type?: string }).type?.startsWith('error');
          const resultValue =
            output &&
            typeof output === 'object' &&
            'value' in (output as { value?: unknown })
              ? (output as { value?: unknown }).value
              : output;
          let parsedResult = resultValue;

          if (typeof resultValue === 'string') {
            if (resultValue === EMPTY_TOOL_RESULT_PLACEHOLDER) {
              parsedResult = undefined;
            } else {
              try {
                parsedResult = JSON.parse(resultValue);
              } catch {
                parsedResult = resultValue;
              }
            }
          }

          const toolResponseBlock: ToolResponseBlock & { isError?: boolean } = {
            type: 'tool_response',
            callId: normalizeToHistoryToolId(part.toolCallId),
            toolName: part.toolName,
            result: parsedResult,
          };

          if (isErrorOutput) {
            toolResponseBlock.isError = true;
            if (typeof resultValue === 'string') {
              toolResponseBlock.error = resultValue;
            }
          }

          blocks.push(toolResponseBlock);
        }
      }

      if (blocks.length > 0) {
        contents.push({
          speaker: 'tool',
          blocks,
        });
      }
    } else if (message.role === 'system') {
      // Convert system messages
      const systemContent = message.content;
      const text =
        typeof systemContent === 'string'
          ? systemContent
          : Array.isArray(systemContent)
            ? (systemContent as Array<{ type: string; text?: string } | string>)
                .map((part) => {
                  if (typeof part === 'string') return part;
                  if (part.type === 'text') return part.text || '';
                  return '';
                })
                .join('\n')
            : '';

      if (text) {
        const systemContentObj: IContent & { metadata: { role: string } } = {
          speaker: 'ai' as const,
          blocks: [
            {
              type: 'text',
              text,
            },
          ],
          metadata: {
            role: 'system',
          },
        };
        contents.push(systemContentObj);
      }
    }
  }

  return contents;
}

function normalizeImageData(media: MediaBlock): string {
  if (media.data.startsWith('data:')) {
    return media.data;
  }

  if (media.encoding === 'url') {
    return media.data;
  }

  const prefix = media.mimeType
    ? `data:${media.mimeType};base64,`
    : 'data:image/*;base64,';
  return `${prefix}${media.data}`;
}
