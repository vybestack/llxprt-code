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

import { Content, Part } from '@google/genai';
import type {
  IContent,
  ContentBlock,
  TextBlock,
  ToolCallBlock,
  ToolResponseBlock,
  ThinkingBlock,
} from './IContent.js';

/**
 * Converts between Gemini Content format and IContent format
 */
export class ContentConverters {
  /**
   * Convert IContent to Gemini Content format
   */
  static toGeminiContent(iContent: IContent): Content {
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

    return { role, parts };
  }

  /**
   * Convert Gemini Content to IContent format
   */
  static toIContent(content: Content): IContent {
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
          blocks.push({
            type: 'tool_call',
            id: part.functionCall.id || generateId(),
            name: part.functionCall.name || '',
            parameters: part.functionCall.args || {},
          });
        } else if ('functionResponse' in part && part.functionResponse) {
          blocks.push({
            type: 'tool_response',
            callId: part.functionResponse.id || '',
            toolName: part.functionResponse.name || '',
            result: part.functionResponse.response || {},
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
    if (
      content.role === 'user' &&
      blocks.length > 0 &&
      blocks.every((b) => b.type === 'tool_response')
    ) {
      return {
        speaker: 'tool',
        blocks,
        metadata: {},
      };
    }

    return {
      speaker,
      blocks,
      metadata: {},
    };
  }

  /**
   * Convert array of IContent to array of Gemini Content
   */
  static toGeminiContents(iContents: IContent[]): Content[] {
    return iContents.map((ic) => this.toGeminiContent(ic));
  }

  /**
   * Convert array of Gemini Content to array of IContent
   */
  static toIContents(contents: Content[]): IContent[] {
    return contents.map((c) => this.toIContent(c));
  }
}

/**
 * Generate a unique ID for tool calls
 */
function generateId(): string {
  return `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
