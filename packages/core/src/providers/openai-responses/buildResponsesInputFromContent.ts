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

import type {
  IContent,
  TextBlock,
  ToolCallBlock,
  ToolResponseBlock,
} from '../../services/history/IContent.js';
import type { Config } from '../../config/config.js';
import { limitOutputTokens } from '../../utils/toolOutputLimiter.js';
import { normalizeToOpenAIToolId } from '../utils/toolIdNormalization.js';

export type ResponsesInputItem =
  | { role: 'user' | 'assistant' | 'system'; content?: string }
  | {
      type: 'function_call';
      call_id: string;
      name: string;
      arguments: string;
    }
  | { type: 'function_call_output'; call_id: string; output: string };

export function buildResponsesInputFromContent(
  content: IContent[],
  systemPrompt?: string,
  config?: Config,
): ResponsesInputItem[] {
  const input: ResponsesInputItem[] = [];

  if (systemPrompt) {
    input.push({
      role: 'system',
      content: systemPrompt,
    });
  }

  for (const c of content) {
    if (c.speaker === 'human') {
      const textBlocks = c.blocks.filter(
        (b): b is TextBlock => b.type === 'text',
      );
      const text = textBlocks.map((b) => b.text).join('\n');
      if (text) {
        input.push({ role: 'user', content: text });
      }
    } else if (c.speaker === 'ai') {
      const textBlocks = c.blocks.filter(
        (b) => b.type === 'text',
      ) as TextBlock[];
      const toolCallBlocks = c.blocks.filter(
        (b) => b.type === 'tool_call',
      ) as ToolCallBlock[];

      const contentText = textBlocks.map((b) => b.text).join('');

      if (contentText) {
        input.push({
          role: 'assistant',
          content: contentText,
        });
      }

      for (const toolCall of toolCallBlocks) {
        input.push({
          type: 'function_call',
          call_id: normalizeToOpenAIToolId(toolCall.id),
          name: toolCall.name,
          arguments: JSON.stringify(toolCall.parameters),
        });
      }
    } else if (c.speaker === 'tool') {
      const toolResponseBlocks = c.blocks.filter(
        (b) => b.type === 'tool_response',
      ) as ToolResponseBlock[];

      for (const toolResponseBlock of toolResponseBlocks) {
        const rawResult =
          typeof toolResponseBlock.result === 'string'
            ? toolResponseBlock.result
            : JSON.stringify(toolResponseBlock.result);

        const limited =
          config === undefined
            ? { content: rawResult, wasTruncated: false }
            : limitOutputTokens(
                rawResult,
                config,
                toolResponseBlock.toolName ?? 'tool_response',
              );

        const candidate = limited.content || limited.message || '';

        input.push({
          type: 'function_call_output',
          call_id: normalizeToOpenAIToolId(toolResponseBlock.callId),
          output: candidate,
        });
      }
    }
  }

  return input;
}
