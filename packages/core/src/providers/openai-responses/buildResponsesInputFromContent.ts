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
  MediaBlock,
} from '../../services/history/IContent.js';
import type { Config } from '../../config/config.js';
import { limitOutputTokens } from '../../utils/toolOutputLimiter.js';
import { normalizeToOpenAIToolId } from '../utils/toolIdNormalization.js';
import {
  normalizeMediaToDataUri,
  classifyMediaBlock,
  buildUnsupportedMediaPlaceholder,
} from '../utils/mediaUtils.js';

type ResponsesContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string }
  | { type: 'input_file'; file_data: string; filename?: string };

export type ResponsesInputItem =
  | {
      role: 'user' | 'assistant' | 'system';
      content?: string | ResponsesContentPart[];
    }
  | {
      type: 'function_call';
      call_id: string;
      name: string;
      arguments: string;
    }
  | {
      type: 'function_call_output';
      call_id: string;
      output: string;
    };

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
      const hasMedia = c.blocks.some((b) => b.type === 'media');

      if (hasMedia) {
        const parts: ResponsesContentPart[] = [];

        for (const block of c.blocks) {
          if (block.type === 'text' && block.text) {
            parts.push({ type: 'input_text', text: block.text });
          } else if (block.type === 'media') {
            const category = classifyMediaBlock(block);
            if (category === 'image') {
              parts.push({
                type: 'input_image',
                image_url: normalizeMediaToDataUri(block),
              });
            } else if (category === 'pdf') {
              parts.push({
                type: 'input_file',
                file_data: normalizeMediaToDataUri(block),
                ...(block.filename ? { filename: block.filename } : {}),
              });
            } else {
              parts.push({
                type: 'input_text',
                text: buildUnsupportedMediaPlaceholder(
                  block,
                  'OpenAI Responses',
                ),
              });
            }
          }
        }

        if (parts.length > 0) {
          input.push({ role: 'user', content: parts });
        }
      } else {
        const text = c.blocks
          .filter((b): b is TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n');
        if (text) {
          input.push({ role: 'user', content: text });
        }
      }
    } else if (c.speaker === 'ai') {
      const textBlocks = c.blocks.filter((b) => b.type === 'text');
      const toolCallBlocks = c.blocks.filter((b) => b.type === 'tool_call');

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
    } else {
      const toolResponseBlocks = c.blocks.filter(
        (b) => b.type === 'tool_response',
      );
      const mediaBlocks = c.blocks.filter(
        (b): b is MediaBlock => b.type === 'media',
      );

      for (const toolResponseBlock of toolResponseBlocks) {
        const rawResult =
          typeof toolResponseBlock.result === 'string'
            ? toolResponseBlock.result
            : JSON.stringify(toolResponseBlock.result);

        const limited =
          config === undefined
            ? { content: rawResult, wasTruncated: false }
            : limitOutputTokens(rawResult, config, toolResponseBlock.toolName);

        const textResult =
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty content should fall through to message
          limited.content || limited.message || '';

        input.push({
          type: 'function_call_output',
          call_id: normalizeToOpenAIToolId(toolResponseBlock.callId),
          output: textResult,
        });

        // OpenAI Responses API function_call_output.output only accepts a
        // string.  When the tool response carried media blocks (e.g.
        // screenshots, images from read_file), emit them as a synthetic
        // user message so the model can still see the actual image data.
        if (mediaBlocks.length > 0) {
          const mediaParts: ResponsesContentPart[] = [];
          for (const media of mediaBlocks) {
            const category = classifyMediaBlock(media);
            if (category === 'image') {
              mediaParts.push({
                type: 'input_image',
                image_url: normalizeMediaToDataUri(media),
              });
            } else if (category === 'pdf') {
              mediaParts.push({
                type: 'input_file',
                file_data: normalizeMediaToDataUri(media),
                ...(media.filename ? { filename: media.filename } : {}),
              });
            } else {
              mediaParts.push({
                type: 'input_text',
                text: buildUnsupportedMediaPlaceholder(
                  media,
                  'OpenAI Responses',
                ),
              });
            }
          }
          if (mediaParts.length > 0) {
            input.push({
              role: 'user',
              content: mediaParts,
            });
          }
        }
      }
    }
  }

  return input;
}
