/**
 * Anthropic Message Normalization Module
 * Converts IContent[] to AnthropicMessage[] format for the Anthropic API
 *
 * @issue #1572 - Decomposing AnthropicProvider (Step 4 - Part A)
 */

import type {
  IContent,
  ContentBlock,
  ToolCallBlock,
  ToolResponseBlock,
  TextBlock,
  ThinkingBlock,
  CodeBlock,
  MediaBlock,
} from '../../services/history/IContent.js';
import { normalizeToAnthropicToolId } from '../utils/toolIdNormalization.js';
import { buildToolResponsePayload } from '../utils/toolResponsePayload.js';
import {
  classifyMediaBlock,
  buildUnsupportedMediaPlaceholder,
} from '../utils/mediaUtils.js';
import {
  validateToolResults,
  enforceToolResultAdjacency,
  ensureValidMessageSequence,
} from './AnthropicMessageValidator.js';

// Type definitions moved from AnthropicProvider.ts

export type AnthropicImageBlock = {
  type: 'image';
  source:
    | { type: 'base64'; media_type: string; data: string }
    | { type: 'url'; url: string };
};

export type AnthropicDocumentBlock = {
  type: 'document';
  source: { type: 'base64'; media_type: string; data: string };
  title?: string;
};

export type AnthropicToolResultContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | AnthropicImageBlock
      | AnthropicDocumentBlock
    >;

export type AnthropicMessageBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: AnthropicToolResultContent;
      is_error?: boolean;
    }
  | AnthropicImageBlock
  | AnthropicDocumentBlock
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'redacted_thinking'; data: string };

export type AnthropicMessageContent = string | AnthropicMessageBlock[];

export type AnthropicMessage = {
  role: 'user' | 'assistant';
  content: AnthropicMessageContent;
};

// Helper functions moved from AnthropicProvider.ts

export function mediaBlockToAnthropicImage(
  media: MediaBlock,
): AnthropicImageBlock {
  if (media.encoding === 'url') {
    return {
      type: 'image',
      source: { type: 'url', url: media.data },
    };
  }

  const rawData =
    media.data.startsWith('data:') && media.data.includes(';base64,')
      ? media.data.split(';base64,')[1]
      : media.data;

  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: media.mimeType || 'image/png',
      data: rawData,
    },
  };
}

export function mediaBlockToAnthropicDocument(
  media: MediaBlock,
): AnthropicDocumentBlock {
  const rawData =
    media.data.startsWith('data:') && media.data.includes(';base64,')
      ? media.data.split(';base64,')[1]
      : media.data;

  return {
    type: 'document',
    source: {
      type: 'base64',
      media_type: media.mimeType || 'application/pdf',
      data: rawData,
    },
    ...(media.filename ? { title: media.filename } : {}),
  };
}

// Conversion sub-functions (all under 80 lines)

function filterOrphanedToolResponses(contents: IContent[]): IContent[] {
  let startIndex = 0;
  while (
    startIndex < contents.length &&
    contents[startIndex].speaker === 'tool'
  ) {
    startIndex++;
  }
  return contents.slice(startIndex);
}

function mergeConsecutiveAIMessages(
  contents: IContent[],
  reasoningEnabled: boolean,
  logger: { debug: (fn: () => string) => void },
): IContent[] {
  const result: IContent[] = [];
  const consumedIndices = new Set<number>();

  for (let i = 0; i < contents.length; i++) {
    if (consumedIndices.has(i)) {
      continue;
    }

    const current = contents[i];

    if (reasoningEnabled && current.speaker === 'ai') {
      const currentThinking = current.blocks.filter(
        (b) => b.type === 'thinking' && b.sourceField === 'thinking',
      );
      const currentOther = current.blocks.filter(
        (b) => b.type !== 'thinking' || b.sourceField !== 'thinking',
      );

      if (currentThinking.length > 0 && currentOther.length === 0) {
        let endIndex = i;
        while (
          endIndex + 1 < contents.length &&
          contents[endIndex + 1].speaker === 'ai'
        ) {
          endIndex++;
        }

        if (endIndex > i) {
          const thinkingBlocks: ThinkingBlock[] = [
            ...(currentThinking as ThinkingBlock[]),
          ];
          const textBlocks: Array<TextBlock | CodeBlock> = [];
          const toolCallBlocks: ToolCallBlock[] = [];
          const otherBlocks: ContentBlock[] = [];

          for (let j = i + 1; j <= endIndex; j++) {
            for (const block of contents[j].blocks) {
              if (
                block.type === 'thinking' &&
                block.sourceField === 'thinking'
              ) {
                thinkingBlocks.push(block);
              } else if (block.type === 'text' || block.type === 'code') {
                textBlocks.push(block);
              } else if (block.type === 'tool_call') {
                toolCallBlocks.push(block);
              } else {
                otherBlocks.push(block);
              }
            }
            consumedIndices.add(j);
          }

          logger.debug(
            () =>
              `Merging ${endIndex - i + 1} consecutive AI messages (thinking-only followed by ${endIndex - i} message(s))`,
          );

          result.push({
            ...contents[endIndex],
            blocks: [
              ...thinkingBlocks,
              ...textBlocks,
              ...otherBlocks,
              ...toolCallBlocks,
            ],
          });
          consumedIndices.add(i);
          continue;
        }
      }
    }

    result.push(current);
  }

  return result;
}

function applyThinkingStripPolicy(
  contents: IContent[],
  options: {
    stripFromContext?: 'all' | 'allButLast' | 'none';
    includeInContext?: boolean;
    reasoningEnabled: boolean;
  },
): { contents: IContent[]; redactedIndices: Set<number> } {
  const redactedIndices = new Set<number>();

  const shouldStripAll =
    options.includeInContext === false || options.stripFromContext === 'all';
  const shouldStripAllButLast =
    options.includeInContext !== false &&
    options.stripFromContext === 'allButLast';

  if (shouldStripAll || shouldStripAllButLast) {
    const assistantIndices: number[] = [];
    contents.forEach((c, idx) => {
      if (c.speaker === 'ai' && c.blocks.some((b) => b.type === 'thinking')) {
        assistantIndices.push(idx);
      }
    });

    if (assistantIndices.length > 0) {
      assistantIndices.forEach((idx) => {
        let shouldRedact = false;
        if (shouldStripAll) {
          shouldRedact = true;
        } else if (shouldStripAllButLast) {
          const isLast = idx === assistantIndices[assistantIndices.length - 1];
          shouldRedact = !isLast;
        }

        if (shouldRedact) {
          redactedIndices.add(idx);
        }
      });
    }
  }

  return { contents, redactedIndices };
}

function blocksToText(blocks: ContentBlock[]): string {
  let combined = '';
  for (const block of blocks) {
    if (block.type === 'text') {
      combined += block.text;
    } else if (block.type === 'code') {
      const language = block.language ? block.language : '';
      combined += `\n\n\`\`\`${language}\n${block.code}\n\`\`\`\n`;
    }
  }
  return combined.trimStart();
}

function convertContentToMessages(
  contents: IContent[],
  redactedIndices: Set<number>,
  options: {
    isOAuth: boolean;
    reasoningEnabled: boolean;
    config: unknown;
    unprefixToolName: (name: string, isOAuth: boolean) => string;
    logger: { debug: (fn: () => string) => void };
  },
): AnthropicMessage[] {
  const messages: AnthropicMessage[] = [];
  let pendingToolResults: Array<{
    type: 'tool_result';
    tool_use_id: string;
    content: AnthropicToolResultContent;
    is_error?: boolean;
  }> = [];

  const flushToolResults = () => {
    if (pendingToolResults.length > 0) {
      messages.push({
        role: 'user',
        content: pendingToolResults,
      });
      pendingToolResults = [];
    }
  };

  for (let contentIndex = 0; contentIndex < contents.length; contentIndex++) {
    const c = contents[contentIndex];
    const toolResponseBlocks = c.blocks.filter(
      (b): b is ToolResponseBlock => b.type === 'tool_response',
    );
    const nonToolResponseBlocks = c.blocks.filter(
      (b) => b.type !== 'tool_response',
    );
    const toolTextContent = toolResponseBlocks.length
      ? blocksToText(nonToolResponseBlocks)
      : '';
    const onlyToolResponseContent =
      toolResponseBlocks.length > 0 &&
      nonToolResponseBlocks.every(
        (block) => block.type === 'text' || block.type === 'code',
      );

    if (toolResponseBlocks.length > 0) {
      const mediaBlocks = c.blocks.filter(
        (b): b is MediaBlock => b.type === 'media',
      );

      for (const toolResponseBlock of toolResponseBlocks) {
        const payload = buildToolResponsePayload(
          toolResponseBlock,
          options.config as Parameters<typeof buildToolResponsePayload>[1],
        );
        let contentPayload = toolTextContent
          ? `${toolTextContent}\n${payload.result}`
          : payload.result;

        if (payload.limitMessage) {
          contentPayload = contentPayload
            ? `${contentPayload}\n${payload.limitMessage}`
            : payload.limitMessage;
        }

        if (!contentPayload) {
          contentPayload = '[empty tool result]';
        }

        const toolResultContent: AnthropicToolResultContent =
          mediaBlocks.length > 0
            ? [
                { type: 'text' as const, text: contentPayload },
                ...mediaBlocks.map((mb) => {
                  const category = classifyMediaBlock(mb);
                  if (category === 'image') {
                    return mediaBlockToAnthropicImage(mb);
                  }
                  if (category === 'pdf') {
                    return mediaBlockToAnthropicDocument(mb);
                  }
                  return {
                    type: 'text' as const,
                    text: buildUnsupportedMediaPlaceholder(mb, 'Anthropic'),
                  };
                }),
              ]
            : contentPayload;

        const toolResult: {
          type: 'tool_result';
          tool_use_id: string;
          content: AnthropicToolResultContent;
          is_error?: boolean;
        } = {
          type: 'tool_result',
          tool_use_id: normalizeToAnthropicToolId(toolResponseBlock.callId),
          content: toolResultContent,
        };

        if (payload.status === 'error') {
          toolResult.is_error = true;
        }

        pendingToolResults.push(toolResult);
      }
    }

    if (c.speaker === 'human') {
      const skipHumanMessage = onlyToolResponseContent;
      flushToolResults();

      if (skipHumanMessage) {
        continue;
      }

      const hasMedia = c.blocks.some((b) => b.type === 'media');

      if (hasMedia) {
        const parts = convertHumanMessageWithMedia(c.blocks);
        if (parts.length > 0) {
          messages.push({ role: 'user', content: parts });
        }
      } else {
        const textBlock = c.blocks.find((b) => b.type === 'text');
        messages.push({ role: 'user', content: textBlock?.text || '' });
      }
    } else if (c.speaker === 'ai') {
      flushToolResults();
      convertAIMessage(c, contentIndex, redactedIndices, messages, options);
    } else if (c.speaker === 'tool') {
      if (toolResponseBlocks.length === 0) {
        throw new Error('Tool content must have a tool_response block');
      }
      if (onlyToolResponseContent) {
        continue;
      }
    } else {
      throw new Error(`Unknown speaker type: ${c.speaker}`);
    }
  }

  flushToolResults();
  return messages;
}

function convertHumanMessageWithMedia(
  blocks: ContentBlock[],
): Array<
  { type: 'text'; text: string } | AnthropicImageBlock | AnthropicDocumentBlock
> {
  const parts: Array<
    | { type: 'text'; text: string }
    | AnthropicImageBlock
    | AnthropicDocumentBlock
  > = [];

  for (const block of blocks) {
    if (block.type === 'text' && block.text) {
      parts.push({ type: 'text', text: block.text });
    } else if (block.type === 'code') {
      const language = block.language ? block.language : '';
      parts.push({
        type: 'text',
        text: `\n\n\`\`\`${language}\n${block.code}\n\`\`\`\n`,
      });
    } else if (block.type === 'media') {
      const category = classifyMediaBlock(block);
      if (category === 'image') {
        parts.push(mediaBlockToAnthropicImage(block));
      } else if (category === 'pdf') {
        parts.push(mediaBlockToAnthropicDocument(block));
      } else {
        parts.push({
          type: 'text',
          text: buildUnsupportedMediaPlaceholder(block, 'Anthropic'),
        });
      }
    }
  }

  return parts;
}

function convertAIMessage(
  c: IContent,
  contentIndex: number,
  redactedIndices: Set<number>,
  messages: AnthropicMessage[],
  options: {
    isOAuth: boolean;
    reasoningEnabled: boolean;
    unprefixToolName: (name: string, isOAuth: boolean) => string;
    logger: { debug: (fn: () => string) => void };
  },
): void {
  const toolCallBlocks = c.blocks.filter((b) => b.type === 'tool_call');
  const thinkingBlocks = c.blocks.filter((b) => b.type === 'thinking');

  if (toolCallBlocks.length > 0 || thinkingBlocks.length > 0) {
    const contentArray = buildAIMessageContent(
      c.blocks,
      contentIndex,
      redactedIndices,
      options,
    );

    if (contentArray.length === 0) {
      messages.push({ role: 'assistant', content: '' });
    } else {
      messages.push({ role: 'assistant', content: contentArray });
    }
  } else {
    const contentText = blocksToText(c.blocks);
    messages.push({ role: 'assistant', content: contentText });
  }
}

function buildAIMessageContent(
  blocks: ContentBlock[],
  contentIndex: number,
  redactedIndices: Set<number>,
  options: {
    isOAuth: boolean;
    unprefixToolName: (name: string, isOAuth: boolean) => string;
    logger: { debug: (fn: () => string) => void };
  },
): Array<
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'redacted_thinking'; data: string }
> {
  const contentArray: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
    | { type: 'thinking'; thinking: string; signature?: string }
    | { type: 'redacted_thinking'; data: string }
  > = [];

  const shouldRedactThinkingBase = redactedIndices.has(contentIndex);

  const shouldRedactBlock = (block: ThinkingBlock): boolean => {
    if (block.sourceField !== 'thinking' || !block.signature) {
      return false;
    }
    if (!shouldRedactThinkingBase) {
      return false;
    }
    return true;
  };

  for (const block of blocks) {
    if (block.type === 'thinking') {
      const thinkingBlock = block;
      if (thinkingBlock.sourceField !== 'thinking') {
        if (thinkingBlock.thought) {
          contentArray.push({ type: 'text', text: thinkingBlock.thought });
        }
        continue;
      }
      if (!thinkingBlock.signature) {
        if (!thinkingBlock.thought) {
          continue;
        }
        options.logger.debug(
          () =>
            `Including thinking block without signature at index ${contentIndex} (unsigned provider)`,
        );
        if (shouldRedactThinkingBase) {
          contentArray.push({ type: 'text', text: thinkingBlock.thought });
        } else {
          contentArray.push({
            type: 'thinking',
            thinking: thinkingBlock.thought,
          });
        }
        continue;
      }
      if (shouldRedactBlock(thinkingBlock)) {
        contentArray.push({
          type: 'redacted_thinking',
          data: thinkingBlock.signature,
        });
      } else {
        contentArray.push({
          type: 'thinking',
          thinking: thinkingBlock.thought,
          signature: thinkingBlock.signature,
        });
      }
      continue;
    }

    if (block.type === 'text') {
      contentArray.push({ type: 'text', text: block.text });
      continue;
    }

    if (block.type === 'code') {
      const language = block.language ? block.language : '';
      const codeText = `\n\n\`\`\`${language}\n${block.code}\n\`\`\`\n`;
      contentArray.push({ type: 'text', text: codeText });
      continue;
    }

    if (block.type === 'tool_call') {
      let parametersObj = block.parameters;
      if (typeof parametersObj === 'string') {
        try {
          parametersObj = JSON.parse(parametersObj);
        } catch {
          parametersObj = {};
        }
      }
      contentArray.push({
        type: 'tool_use',
        id: normalizeToAnthropicToolId(block.id),
        name: options.unprefixToolName(block.name, options.isOAuth),
        input: parametersObj,
      });
      continue;
    }
  }

  return contentArray;
}

/**
 * Main exported function: Convert IContent[] to AnthropicMessage[]
 */
export function convertToAnthropicMessages(
  contents: IContent[],
  options: {
    isOAuth: boolean;
    stripFromContext?: 'all' | 'allButLast' | 'none';
    includeInContext?: boolean;
    reasoningEnabled: boolean;
    config: unknown;
    unprefixToolName: (name: string, isOAuth: boolean) => string;
    logger: { debug: (fn: () => string) => void };
  },
): AnthropicMessage[] {
  const filtered = filterOrphanedToolResponses(contents);
  const merged = mergeConsecutiveAIMessages(
    filtered,
    options.reasoningEnabled,
    options.logger,
  );
  const { contents: processed, redactedIndices } = applyThinkingStripPolicy(
    merged,
    options,
  );

  let messages = convertContentToMessages(processed, redactedIndices, options);
  messages = validateToolResults(messages, options.logger);
  messages = enforceToolResultAdjacency(messages, options.logger);
  messages = ensureValidMessageSequence(
    messages,
    options.reasoningEnabled,
    options.logger,
  );

  return messages;
}
