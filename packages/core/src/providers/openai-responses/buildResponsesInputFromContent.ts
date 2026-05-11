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

/* eslint-disable complexity, sonarjs/cognitive-complexity -- Phase 5: legacy provider boundary retained while larger decomposition continues. */

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

function mediaBlockToContentPart(block: MediaBlock): ResponsesContentPart {
  const category = classifyMediaBlock(block);
  if (category === 'image') {
    return {
      type: 'input_image',
      image_url: normalizeMediaToDataUri(block),
    };
  } else if (category === 'pdf') {
    return {
      type: 'input_file',
      file_data: normalizeMediaToDataUri(block),
      ...(block.filename ? { filename: block.filename } : {}),
    };
  }
  return {
    type: 'input_text',
    text: buildUnsupportedMediaPlaceholder(block, 'OpenAI Responses'),
  };
}

function processHumanContent(c: IContent): ResponsesInputItem | null {
  const hasMedia = c.blocks.some((b) => b.type === 'media');

  if (hasMedia) {
    const parts: ResponsesContentPart[] = [];
    for (const block of c.blocks) {
      if (block.type === 'text' && block.text) {
        parts.push({ type: 'input_text', text: block.text });
      } else if (block.type === 'media') {
        parts.push(mediaBlockToContentPart(block));
      }
    }
    if (parts.length > 0) {
      return { role: 'user', content: parts };
    }
  } else {
    const text = c.blocks
      .filter((b): b is TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    if (text) {
      return { role: 'user', content: text };
    }
  }
  return null;
}

function processAiContent(c: IContent): ResponsesInputItem[] {
  const items: ResponsesInputItem[] = [];
  const textBlocks = c.blocks.filter((b) => b.type === 'text');
  const toolCallBlocks = c.blocks.filter((b) => b.type === 'tool_call');
  const contentText = textBlocks.map((b) => b.text).join('');

  if (contentText) {
    items.push({ role: 'assistant', content: contentText });
  }

  for (const toolCall of toolCallBlocks) {
    items.push({
      type: 'function_call',
      call_id: normalizeToOpenAIToolId(toolCall.id),
      name: toolCall.name,
      arguments: JSON.stringify(toolCall.parameters),
    });
  }
  return items;
}

function processToolContent(
  c: IContent,
  config: Config | undefined,
): ResponsesInputItem[] {
  const items: ResponsesInputItem[] = [];
  const toolResponseBlocks = c.blocks.filter((b) => b.type === 'tool_response');
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

    items.push({
      type: 'function_call_output',
      call_id: normalizeToOpenAIToolId(toolResponseBlock.callId),
      output: textResult,
    });

    if (mediaBlocks.length > 0) {
      const mediaParts: ResponsesContentPart[] = [];
      for (const media of mediaBlocks) {
        mediaParts.push(mediaBlockToContentPart(media));
      }
      if (mediaParts.length > 0) {
        items.push({ role: 'user', content: mediaParts });
      }
    }
  }
  return items;
}

export function buildResponsesInputFromContent(
  content: IContent[],
  systemPrompt?: string,
  config?: Config,
): ResponsesInputItem[] {
  const input: ResponsesInputItem[] = [];

  if (systemPrompt) {
    input.push({ role: 'system', content: systemPrompt });
  }

  for (const c of content) {
    if (c.speaker === 'human') {
      const humanItem = processHumanContent(c);
      if (humanItem) {
        input.push(humanItem);
      }
    } else if (c.speaker === 'ai') {
      input.push(...processAiContent(c));
    } else {
      input.push(...processToolContent(c, config));
    }
  }

  return input;
}
