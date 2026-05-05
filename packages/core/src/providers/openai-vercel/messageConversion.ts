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
  ThinkingBlock,
} from '../../services/history/IContent.js';
import {
  normalizeToHistoryToolId,
  normalizeToOpenAIToolId,
} from './toolIdUtils.js';
import {
  buildToolResponsePayload,
  EMPTY_TOOL_RESULT_PLACEHOLDER,
} from '../utils/toolResponsePayload.js';
import type { ToolIdMapper } from '../../tools/ToolIdStrategy.js';
import {
  extractThinkingBlocks,
  thinkingToReasoningField,
  cleanKimiTokensFromThinking,
} from '../reasoning/reasoningUtils.js';
import {
  normalizeMediaToDataUri,
  classifyMediaBlock,
  buildUnsupportedMediaPlaceholder,
} from '../utils/mediaUtils.js';

function inferMediaEncoding(imageData: string): {
  encoding: 'base64' | 'url';
  mimeType: string;
} {
  const defaultResult = { encoding: 'url' as const, mimeType: 'image/*' };

  if (imageData.startsWith('data:image/') && imageData.includes(';base64,')) {
    const mimeMatch = imageData.slice('data:'.length).match(/^([^;]+);base64,/);
    const mimeType = mimeMatch?.[1] ?? 'image/*';
    return { encoding: 'base64', mimeType };
  }

  if (imageData.startsWith('data:')) {
    return defaultResult;
  }

  if (imageData.startsWith('http://') || imageData.startsWith('https://')) {
    return defaultResult;
  }

  return { encoding: 'base64', mimeType: 'image/*' };
}

function pushWithReasoning(
  messages: CoreMessage[],
  baseMessage: Record<string, unknown>,
  options: { includeReasoningInContext?: boolean } | undefined,
  thinkingBlocks: ThinkingBlock[],
): void {
  if (
    options?.includeReasoningInContext === true &&
    thinkingBlocks.length > 0
  ) {
    const reasoningText = thinkingToReasoningField(thinkingBlocks);
    if (reasoningText) {
      const messageWithReasoning = baseMessage as unknown as Record<
        string,
        unknown
      >;
      messageWithReasoning.reasoning_content =
        cleanKimiTokensFromThinking(reasoningText);
      messages.push(messageWithReasoning as unknown as CoreMessage);
      return;
    }
  }
  messages.push(baseMessage as unknown as CoreMessage);
}

function hasReasoningForContext(
  options: { includeReasoningInContext?: boolean } | undefined,
  thinkingBlocks: ThinkingBlock[],
): boolean {
  return (
    options?.includeReasoningInContext === true &&
    thinkingBlocks.length > 0 &&
    thinkingToReasoningField(thinkingBlocks) !== ''
  );
}

function convertSystemContent(content: IContent): CoreMessage | null {
  const textBlocks = content.blocks.filter(
    (b: ContentBlock) => b.type === 'text',
  );
  const text = textBlocks
    .map((b) => b.text)
    .filter((t) => t.length > 0)
    .join('\n');
  return text ? { role: 'system', content: text } : null;
}

function convertHumanContent(content: IContent): CoreMessage | null {
  const textBlocks = content.blocks.filter(
    (b: ContentBlock) => b.type === 'text',
  );
  const mediaBlocks = content.blocks.filter(
    (b: ContentBlock) => b.type === 'media',
  );
  const text = textBlocks
    .map((b) => b.text)
    .filter((t) => t.length > 0)
    .join('\n');

  if (mediaBlocks.length > 0) {
    const parts: Array<
      { type: 'text'; text: string } | { type: 'image'; image: string }
    > = [];
    if (text) {
      parts.push({ type: 'text', text });
    }
    for (const media of mediaBlocks) {
      const category = classifyMediaBlock(media);
      if (category === 'image') {
        parts.push({
          type: 'image',
          image: normalizeMediaToDataUri(media),
        });
      } else {
        parts.push({
          type: 'text',
          text: buildUnsupportedMediaPlaceholder(media, 'OpenAI Vercel'),
        });
      }
    }
    if (parts.length > 0) {
      return { role: 'user', content: parts };
    }
  } else if (text) {
    return { role: 'user', content: text };
  }
  return null;
}

function convertAiContent(
  messages: CoreMessage[],
  content: IContent,
  resolveToolCallId: (block: ToolCallBlock) => string,
  options: { includeReasoningInContext?: boolean } | undefined,
): void {
  const textBlocks = content.blocks.filter(
    (b: ContentBlock) => b.type === 'text',
  );
  const toolCallBlocks = content.blocks.filter(
    (b: ContentBlock) => b.type === 'tool_call',
  );
  const thinkingBlocks = extractThinkingBlocks(content);
  const text = textBlocks
    .map((b) => b.text)
    .filter((t) => t.length > 0)
    .join('\n');

  if (toolCallBlocks.length > 0) {
    const contentParts: Array<{ type: 'text'; text: string } | ToolCallPart> =
      [];
    if (text) {
      contentParts.push({ type: 'text', text });
    }
    for (const block of toolCallBlocks) {
      const toolCall = block as ToolCallBlock & { input?: unknown };
      const input =
        toolCall.input !== undefined ? toolCall.input : block.parameters;
      contentParts.push({
        type: 'tool-call',
        toolCallId: resolveToolCallId(block),
        toolName: block.name,
        input,
      });
    }
    pushWithReasoning(
      messages,
      { role: 'assistant', content: contentParts },
      options,
      thinkingBlocks,
    );
  } else if (text || hasReasoningForContext(options, thinkingBlocks)) {
    pushWithReasoning(
      messages,
      { role: 'assistant', content: text },
      options,
      thinkingBlocks,
    );
  }
}

function convertToolContent(
  messages: CoreMessage[],
  content: IContent,
  resolveToolResponseId: (block: ToolResponseBlock) => string,
): void {
  const toolResponseBlocks = content.blocks.filter(
    (b: ContentBlock) => b.type === 'tool_response',
  );
  if (toolResponseBlocks.length === 0) return;

  const toolContent: ToolResultPart[] = toolResponseBlocks.map((block) => {
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
      toolCallId: resolveToolResponseId(block),
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string name/toolName should fall through to empty string
      toolName: extBlock.name || extBlock.toolName || '',
      output: {
        type: 'text',
        value: payload.result,
      },
    };
  });

  const toolMessage: CoreToolMessage = {
    role: 'tool',
    content: toolContent,
  };
  messages.push(toolMessage);
}

export function convertToVercelMessages(
  contents: IContent[],
  toolIdMapper?: ToolIdMapper,
  options?: { includeReasoningInContext?: boolean },
): CoreMessage[] {
  const messages: CoreMessage[] = [];

  const resolveToolCallId = (block: ToolCallBlock): string => {
    if (toolIdMapper) {
      return toolIdMapper.resolveToolCallId(block);
    }
    return normalizeToOpenAIToolId(block.id);
  };

  const resolveToolResponseId = (block: ToolResponseBlock): string => {
    if (toolIdMapper) {
      return toolIdMapper.resolveToolResponseId(block);
    }
    return normalizeToOpenAIToolId(block.callId || '');
  };

  for (const content of contents) {
    const metadata = (content as { metadata?: { role?: string } }).metadata;
    const metadataRole = metadata?.role;

    if (
      metadataRole === 'system' ||
      (content as { speaker: string }).speaker === 'system'
    ) {
      const msg = convertSystemContent(content);
      if (msg) messages.push(msg);
    } else if (content.speaker === 'human') {
      const msg = convertHumanContent(content);
      if (msg) messages.push(msg);
    } else if (content.speaker === 'ai') {
      convertAiContent(messages, content, resolveToolCallId, options);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Vercel message payloads are external provider boundaries despite declared types.
    } else if (content.speaker === 'tool') {
      convertToolContent(messages, content, resolveToolResponseId);
    }
  }

  return messages;
}

function parseUserContentPart(part: unknown, blocks: ContentBlock[]): void {
  const partType = (part as { type?: string }).type;

  if (typeof part === 'string') {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Vercel message payloads are external provider boundaries despite declared types.
    if (part) {
      blocks.push({ type: 'text', text: part });
    }
    return;
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
      const { encoding, mimeType } = inferMediaEncoding(imageData);
      blocks.push({ type: 'media', data: imageData, encoding, mimeType });
    }
  }
}

function parseAssistantContentPart(
  part: unknown,
  blocks: Array<TextBlock | ToolCallBlock | MediaBlock>,
): void {
  const partType = (part as { type?: string }).type;

  if (typeof part === 'string') {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Vercel message payloads are external provider boundaries despite declared types.
    if (part) {
      blocks.push({ type: 'text', text: part });
    }
  } else if (partType === 'text') {
    const text = (part as { text?: string }).text;
    if (text) {
      blocks.push({ type: 'text', text });
    }
  } else if (partType === 'image') {
    const imageData =
      (part as { image?: string; url?: string }).image ??
      (part as { url?: string }).url;
    if (imageData) {
      const { encoding, mimeType } = inferMediaEncoding(imageData);
      blocks.push({ type: 'media', data: imageData, encoding, mimeType });
    }
  } else if (partType === 'tool-call') {
    const toolPart = part as ToolCallPart & { args?: unknown };
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

function convertFromVercelUser(message: CoreMessage): IContent | null {
  if (Array.isArray(message.content)) {
    const blocks: ContentBlock[] = [];
    for (const part of message.content) {
      parseUserContentPart(part, blocks);
    }
    if (blocks.length > 0) {
      return { speaker: 'human', blocks };
    }
  } else {
    const text = typeof message.content === 'string' ? message.content : '';
    if (text) {
      return {
        speaker: 'human',
        blocks: [{ type: 'text', text }],
      };
    }
  }
  return null;
}

function convertFromVercelAssistant(message: CoreMessage): IContent | null {
  const blocks: Array<TextBlock | ToolCallBlock | MediaBlock> = [];

  if (typeof message.content === 'string') {
    if (message.content) {
      blocks.push({ type: 'text', text: message.content });
    }
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      parseAssistantContentPart(part, blocks);
    }
  }

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

  return blocks.length > 0 ? { speaker: 'ai', blocks } : null;
}

function parseToolResultPart(part: ToolResultPart): ToolResponseBlock | null {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Vercel message payloads are external provider boundaries despite declared types.
  if (part.type !== 'tool-result') return null;

  const output = (part as { output?: unknown }).output;
  const isErrorOutput =
    // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    output !== null &&
    output !== undefined &&
    typeof output === 'object' &&
    'type' in (output as { type?: string }) &&
    typeof (output as { type?: string }).type === 'string' &&
    (output as { type?: string }).type?.startsWith('error');
  const resultValue =
    // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    output !== null &&
    output !== undefined &&
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

  if (isErrorOutput === true) {
    toolResponseBlock.isError = true;
    if (typeof resultValue === 'string') {
      toolResponseBlock.error = resultValue;
    }
  }

  return toolResponseBlock;
}

function convertFromVercelTool(message: CoreMessage): IContent | null {
  const blocks: ToolResponseBlock[] = [];
  for (const part of message.content as ToolResultPart[]) {
    const trBlock = parseToolResultPart(part);
    if (trBlock) blocks.push(trBlock);
  }
  return blocks.length > 0 ? { speaker: 'tool', blocks } : null;
}

function convertFromVercelSystem(message: CoreMessage): IContent | null {
  const systemContent = message.content;
  const text =
    typeof systemContent === 'string'
      ? systemContent
      : // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        Array.isArray(systemContent)
        ? (systemContent as Array<{ type: string; text?: string } | string>)
            .map((part) => {
              if (typeof part === 'string') return part;
              if (part.type === 'text') return part.text ?? '';
              return '';
            })
            .join('\n')
        : '';

  if (text) {
    const systemContentObj: IContent & { metadata: { role: string } } = {
      speaker: 'ai' as const,
      blocks: [{ type: 'text', text }],
      metadata: { role: 'system' },
    };
    return systemContentObj;
  }
  return null;
}

export function convertFromVercelMessages(messages: CoreMessage[]): IContent[] {
  const contents: IContent[] = [];

  for (const message of messages) {
    let result: IContent | null = null;

    if (message.role === 'user') {
      result = convertFromVercelUser(message);
    } else if (message.role === 'assistant') {
      result = convertFromVercelAssistant(message);
    } else if (message.role === 'tool') {
      result = convertFromVercelTool(message);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Vercel message payloads are external provider boundaries despite declared types.
    } else if (message.role === 'system') {
      result = convertFromVercelSystem(message);
    }

    if (result) {
      contents.push(result);
    }
  }

  return contents;
}
