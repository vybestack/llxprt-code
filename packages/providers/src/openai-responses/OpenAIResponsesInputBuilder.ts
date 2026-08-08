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
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  limitOutputTokens,
  type ToolOutputSettingsProvider,
} from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import { normalizeToOpenAIToolId } from '@vybestack/llxprt-code-tools/toolIdNormalization.js';
import {
  normalizeMediaToDataUri,
  classifyMediaBlock,
  buildUnsupportedMediaPlaceholder,
  buildPdfDisabledNotice,
  inlineBase64ByteLength,
  resolvePdfFilename,
  PDF_AGGREGATE_MAX_BYTES,
} from '../utils/mediaUtils.js';
import type {
  ResponsesContentPart,
  ResponsesInputItem,
} from './OpenAIResponsesTypes.js';

export interface ResponsesInputBuildContext {
  includeReasoningInContext: boolean;
  outputLimiterConfig: ToolOutputSettingsProvider;
  debug: (messageFactory: () => string) => void;
  /**
   * Whether a server-side conversation parent is active for this request
   * (i.e. previous_response_id will be sent). Only then may function_call_output
   * items lack a local matching function_call, because the call lives
   * server-side. Distinct from the user-facing "responses-stateful" setting,
   * which may be on without an active parent (#207).
   */
  serverSideParentActive?: boolean;
  mediaPdfEnabled: boolean;
}

const OPENAI_RESPONSES_REASONING_ID_KEY = 'openai.responses.reasoningId';

export function buildOpenAIResponsesInput(
  patchedContent: IContent[],
  context: ResponsesInputBuildContext,
): ResponsesInputItem[] {
  const input: ResponsesInputItem[] = [];
  let reasoningIdCounter = 0;
  const nextReasoningId = () => {
    const id = `rs_${Date.now()}_${reasoningIdCounter}`;
    reasoningIdCounter += 1;
    return id;
  };
  const mediaPdfEnabled = isMediaPdfEnabled(context);

  for (const item of patchedContent) {
    appendInputForContent(
      input,
      item,
      patchedContent,
      context,
      nextReasoningId,
      mediaPdfEnabled,
    );
  }

  enforcePdfAggregateLimit(input, context);
  return input;
}

function isMediaPdfEnabled(context: ResponsesInputBuildContext): boolean {
  return context.mediaPdfEnabled !== false;
}

function enforcePdfAggregateLimit(
  input: ResponsesInputItem[],
  context: ResponsesInputBuildContext,
): void {
  const userItems = input.filter(
    (
      item,
    ): item is { role: 'user'; content?: string | ResponsesContentPart[] } =>
      'role' in item && item.role === 'user',
  );
  const fileParts = userItems.flatMap((item) =>
    Array.isArray(item.content) ? item.content : [],
  );
  const total = fileParts
    .filter(
      (part): part is Extract<ResponsesContentPart, { type: 'input_file' }> =>
        part.type === 'input_file',
    )
    .reduce((sum, part) => sum + inlineBase64ByteLength(part.file_data), 0);
  if (total > PDF_AGGREGATE_MAX_BYTES) {
    context.debug(
      () =>
        `PDF aggregate preflight failed: ${total} bytes exceeds ${PDF_AGGREGATE_MAX_BYTES} bytes (50 MB) limit`,
    );
    throw new Error(
      `Native PDF input payload (${total} bytes) exceeds the allowed ${PDF_AGGREGATE_MAX_BYTES} bytes (50 MB). Reduce the number or size of PDF files.`,
    );
  }
}

function appendInputForContent(
  input: ResponsesInputItem[],
  item: IContent,
  patchedContent: IContent[],
  context: ResponsesInputBuildContext,
  nextReasoningId: () => string,
  mediaPdfEnabled: boolean,
): void {
  if (item.speaker === 'human') {
    appendHumanInput(input, item, mediaPdfEnabled);
    return;
  }

  if (item.speaker === 'ai') {
    appendAssistantInput(input, item, patchedContent, context, nextReasoningId);
    return;
  }

  appendToolInput(input, item, patchedContent, context, mediaPdfEnabled);
}

function appendHumanInput(
  input: ResponsesInputItem[],
  content: IContent,
  mediaPdfEnabled: boolean,
): void {
  const hasMedia = content.blocks.some((block) => block.type === 'media');
  if (hasMedia) {
    const parts = buildMediaAwareParts(content.blocks, mediaPdfEnabled);
    if (parts.length > 0) input.push({ role: 'user', content: parts });
    return;
  }

  const text = content.blocks
    .filter((block): block is TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  if (text) input.push({ role: 'user', content: text });
}

/**
 * Build and append reasoning items from thinking blocks with encrypted
 * content. Extracted from appendAssistantInput so the nesting stays within
 * the sonarjs/nested-control-flow limit (#3134 Fix 5).
 *
 * Fix 5: when `context.serverSideParentActive` is true, a reasoning item
 * that lacks a genuine server-issued id (from
 * `providerMetadata['openai.responses.reasoningId']`) has its `id` field
 * OMITTED entirely instead of being synthesized. The API validates item ids
 * against the stored chain, and an unknown `rs_...` is a plausible 400.
 * Upstream strips non-server-prefixed ids the same way.
 */
function appendReasoningItems(
  input: ResponsesInputItem[],
  content: IContent,
  context: ResponsesInputBuildContext,
  nextReasoningId: () => string,
): void {
  const thinkingBlocks = content.blocks.filter(
    (block) => block.type === 'thinking',
  );
  for (const thinkingBlock of thinkingBlocks) {
    if (!thinkingBlock.encryptedContent) continue;
    const providerReasoningId =
      thinkingBlock.providerMetadata?.[OPENAI_RESPONSES_REASONING_ID_KEY];
    const reasoningItem: ResponsesInputItem = {
      type: 'reasoning',
      summary: [
        {
          type: 'summary_text',
          text: (thinkingBlock.thought as string | undefined) ?? '',
        },
      ],
      encrypted_content: thinkingBlock.encryptedContent,
    };
    const hasGenuineServerId =
      typeof providerReasoningId === 'string' &&
      providerReasoningId.startsWith('rs');
    if (hasGenuineServerId) {
      reasoningItem.id = providerReasoningId;
    } else if (context.serverSideParentActive !== true) {
      reasoningItem.id = nextReasoningId();
    }
    input.push(reasoningItem);
  }
}
function appendAssistantInput(
  input: ResponsesInputItem[],
  content: IContent,
  patchedContent: IContent[],
  context: ResponsesInputBuildContext,
  nextReasoningId: () => string,
): void {
  const textBlocks = content.blocks.filter((block) => block.type === 'text');
  const toolCallBlocks = content.blocks.filter(
    (block) => block.type === 'tool_call',
  );

  if (context.includeReasoningInContext) {
    appendReasoningItems(input, content, context, nextReasoningId);
  }

  const contentText = textBlocks.map((block) => block.text).join('');
  if (contentText) input.push({ role: 'assistant', content: contentText });

  for (const toolCall of toolCallBlocks) {
    const normalizedCallId = normalizeToOpenAIToolId(toolCall.id);
    if (!hasMatchingToolResponse(patchedContent, normalizedCallId)) {
      context.debug(
        () =>
          `Dropping dangling function_call with call_id=${normalizedCallId} (no matching tool_response in history)`,
      );
      continue;
    }

    input.push({
      type: 'function_call',
      call_id: normalizedCallId,
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
  mediaPdfEnabled: boolean,
): void {
  const mediaBlocks = content.blocks.filter(
    (block): block is MediaBlock => block.type === 'media',
  );

  let emittedOutput = false;

  for (const toolResponseBlock of content.blocks.filter(
    (block) => block.type === 'tool_response',
  )) {
    const outputCallId = normalizeToOpenAIToolId(toolResponseBlock.callId);
    // When a server-side parent is active, the matching function_call lives
    // server-side (stored via previous_response_id), so the orphan guard would
    // wrongly drop the function_call_output for the new turn.
    if (
      context.serverSideParentActive !== true &&
      !hasMatchingToolCall(patchedContent, outputCallId)
    ) {
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
    emittedOutput = true;
  }

  // Media is emitted once per tool turn, not once per tool_response.
  // recordCompletedToolHistory flattens all parallel responses + media into
  // a single tool IContent; emitting inside the loop above would duplicate
  // media N times for N responses.
  if (emittedOutput && mediaBlocks.length > 0) {
    const mediaParts = buildMediaParts(mediaBlocks, mediaPdfEnabled);
    if (mediaParts.length > 0)
      input.push({ role: 'user', content: mediaParts });
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

function hasMatchingToolResponse(
  patchedContent: IContent[],
  callId: string,
): boolean {
  return patchedContent.some(
    (msg) =>
      msg.speaker === 'tool' &&
      msg.blocks.some(
        (block) =>
          block.type === 'tool_response' &&
          normalizeToOpenAIToolId(block.callId) === callId,
      ),
  );
}

function buildMediaAwareParts(
  blocks: IContent['blocks'],
  mediaPdfEnabled: boolean,
): ResponsesContentPart[] {
  const parts: ResponsesContentPart[] = [];
  for (const block of blocks) {
    if (block.type === 'text' && block.text) {
      parts.push({ type: 'input_text', text: block.text });
    } else if (block.type === 'media') {
      parts.push(convertMediaBlock(block, mediaPdfEnabled));
    }
  }
  return parts;
}

function buildMediaParts(
  mediaBlocks: MediaBlock[],
  mediaPdfEnabled: boolean,
): ResponsesContentPart[] {
  return mediaBlocks.map((block) => convertMediaBlock(block, mediaPdfEnabled));
}

function convertMediaBlock(
  media: MediaBlock,
  mediaPdfEnabled: boolean,
): ResponsesContentPart {
  const category = classifyMediaBlock(media);
  if (category === 'image') {
    return { type: 'input_image', image_url: normalizeMediaToDataUri(media) };
  }
  if (category === 'pdf') {
    if (!mediaPdfEnabled) {
      return { type: 'input_text', text: buildPdfDisabledNotice(media) };
    }
    return {
      type: 'input_file',
      file_data: normalizeMediaToDataUri(media),
      filename: resolvePdfFilename(media),
    };
  }
  return {
    type: 'input_text',
    text: buildUnsupportedMediaPlaceholder(media, 'OpenAI Responses'),
  };
}
