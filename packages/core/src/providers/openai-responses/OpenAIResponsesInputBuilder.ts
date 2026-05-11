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
import {
  limitOutputTokens,
  type ToolOutputSettingsProvider,
} from '../../utils/toolOutputLimiter.js';
import { normalizeToOpenAIToolId } from '../utils/toolIdNormalization.js';
import {
  normalizeMediaToDataUri,
  classifyMediaBlock,
  buildUnsupportedMediaPlaceholder,
} from '../utils/mediaUtils.js';
import type {
  ResponsesContentPart,
  ResponsesInputItem,
} from './OpenAIResponsesTypes.js';

export interface ResponsesInputBuildContext {
  includeReasoningInContext: boolean;
  outputLimiterConfig: ToolOutputSettingsProvider;
  debug: (messageFactory: () => string) => void;
}

export function buildOpenAIResponsesInput(
  patchedContent: IContent[],
  context: ResponsesInputBuildContext,
): ResponsesInputItem[] {
  const input: ResponsesInputItem[] = [];
  let reasoningIdCounter = 0;
  const nextReasoningId = () => {
    const id = `reasoning_${Date.now()}_${reasoningIdCounter}`;
    reasoningIdCounter += 1;
    return id;
  };

  for (const item of patchedContent) {
    appendInputForContent(
      input,
      item,
      patchedContent,
      context,
      nextReasoningId,
    );
  }

  return input;
}

function appendInputForContent(
  input: ResponsesInputItem[],
  item: IContent,
  patchedContent: IContent[],
  context: ResponsesInputBuildContext,
  nextReasoningId: () => string,
): void {
  if (item.speaker === 'human') {
    appendHumanInput(input, item);
    return;
  }

  if (item.speaker === 'ai') {
    appendAssistantInput(input, item, context, nextReasoningId);
    return;
  }

  appendToolInput(input, item, patchedContent, context);
}

function appendHumanInput(
  input: ResponsesInputItem[],
  content: IContent,
): void {
  const hasMedia = content.blocks.some((block) => block.type === 'media');
  if (hasMedia) {
    const parts = buildMediaAwareParts(content.blocks);
    if (parts.length > 0) input.push({ role: 'user', content: parts });
    return;
  }

  const text = content.blocks
    .filter((block): block is TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  if (text) input.push({ role: 'user', content: text });
}

function appendAssistantInput(
  input: ResponsesInputItem[],
  content: IContent,
  context: ResponsesInputBuildContext,
  nextReasoningId: () => string,
): void {
  const textBlocks = content.blocks.filter((block) => block.type === 'text');
  const toolCallBlocks = content.blocks.filter(
    (block) => block.type === 'tool_call',
  );

  if (context.includeReasoningInContext) {
    for (const thinkingBlock of content.blocks.filter(
      (block) => block.type === 'thinking',
    )) {
      if (thinkingBlock.encryptedContent) {
        input.push({
          type: 'reasoning',
          id: nextReasoningId(),
          summary: [
            {
              type: 'summary_text',
              text: (thinkingBlock.thought as string | undefined) ?? '',
            },
          ],
          encrypted_content: thinkingBlock.encryptedContent,
        });
      }
    }
  }

  const contentText = textBlocks.map((block) => block.text).join('');
  if (contentText) input.push({ role: 'assistant', content: contentText });

  for (const toolCall of toolCallBlocks) {
    input.push({
      type: 'function_call',
      call_id: normalizeToOpenAIToolId(toolCall.id),
      name: toolCall.name,
      arguments: JSON.stringify(toolCall.parameters),
    });
  }
}

function appendToolInput(
  input: ResponsesInputItem[],
  content: IContent,
  patchedContent: IContent[],
  context: ResponsesInputBuildContext,
): void {
  const mediaBlocks = content.blocks.filter(
    (block): block is MediaBlock => block.type === 'media',
  );

  for (const toolResponseBlock of content.blocks.filter(
    (block) => block.type === 'tool_response',
  )) {
    const outputCallId = normalizeToOpenAIToolId(toolResponseBlock.callId);
    if (!hasMatchingToolCall(patchedContent, outputCallId)) {
      context.debug(
        () =>
          `Dropping orphan function_call_output with call_id=${outputCallId} (no matching tool_call in history)`,
      );
      continue;
    }

    input.push({
      type: 'function_call_output',
      call_id: outputCallId,
      output: getLimitedToolOutput(
        toolResponseBlock,
        context.outputLimiterConfig,
      ),
    });

    appendToolMediaInput(input, mediaBlocks);
  }
}

function getLimitedToolOutput(
  toolResponseBlock: Extract<
    IContent['blocks'][number],
    { type: 'tool_response' }
  >,
  outputLimiterConfig: ToolOutputSettingsProvider,
): string {
  const rawResult =
    typeof toolResponseBlock.result === 'string'
      ? toolResponseBlock.result
      : JSON.stringify(toolResponseBlock.result);
  const toolName =
    (toolResponseBlock.toolName as string | undefined) ?? 'tool_response';
  const limited = limitOutputTokens(
    rawResult,
    outputLimiterConfig,
    toolName,
  ) as {
    content?: string;
    message?: string;
  };
  return limited.content ?? limited.message ?? '';
}

function appendToolMediaInput(
  input: ResponsesInputItem[],
  mediaBlocks: MediaBlock[],
): void {
  if (mediaBlocks.length === 0) return;

  const mediaParts = buildMediaParts(mediaBlocks);
  if (mediaParts.length > 0) input.push({ role: 'user', content: mediaParts });
}

function hasMatchingToolCall(
  patchedContent: IContent[],
  outputCallId: string,
): boolean {
  return patchedContent.some(
    (msg) =>
      msg.speaker === 'ai' &&
      msg.blocks.some(
        (block) =>
          block.type === 'tool_call' &&
          normalizeToOpenAIToolId(block.id) === outputCallId,
      ),
  );
}

function buildMediaAwareParts(
  blocks: IContent['blocks'],
): ResponsesContentPart[] {
  const parts: ResponsesContentPart[] = [];
  for (const block of blocks) {
    if (block.type === 'text' && block.text) {
      parts.push({ type: 'input_text', text: block.text });
    } else if (block.type === 'media') {
      parts.push(convertMediaBlock(block));
    }
  }
  return parts;
}

function buildMediaParts(mediaBlocks: MediaBlock[]): ResponsesContentPart[] {
  return mediaBlocks.map(convertMediaBlock);
}

function convertMediaBlock(media: MediaBlock): ResponsesContentPart {
  const category = classifyMediaBlock(media);
  if (category === 'image') {
    return { type: 'input_image', image_url: normalizeMediaToDataUri(media) };
  }
  if (category === 'pdf') {
    return {
      type: 'input_file',
      file_data: normalizeMediaToDataUri(media),
      ...(media.filename ? { filename: media.filename } : {}),
    };
  }
  return {
    type: 'input_text',
    text: buildUnsupportedMediaPlaceholder(media, 'OpenAI Responses'),
  };
}
