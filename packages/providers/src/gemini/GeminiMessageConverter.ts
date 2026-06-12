/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Part } from '@google/genai';
import type {
  IContent,
  MediaBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { isGemini3Model } from '@vybestack/llxprt-code-core/config/models.js';
import { buildToolResponsePayload } from '../utils/toolResponsePayload.js';

export function convertMediaBlockToGeminiParts(block: {
  type: 'media';
  encoding: string;
  mimeType: string;
  data: string;
}): Part[] {
  if (block.encoding === 'url') {
    return [
      { fileData: { mimeType: block.mimeType, fileUri: block.data } } as Part,
    ];
  }
  let imageData = block.data;
  if (imageData.startsWith('data:')) {
    const base64Index = imageData.indexOf('base64,');
    if (base64Index !== -1) {
      imageData = imageData.substring(base64Index + 7);
    }
  }
  return [
    { inlineData: { mimeType: block.mimeType, data: imageData } } as Part,
  ];
}

export function convertHumanBlocksToGeminiParts(
  blocks: IContent['blocks'],
): Part[] {
  const parts: Part[] = [];
  for (const block of blocks) {
    if (block.type === 'text') {
      parts.push({ text: block.text });
    } else if (block.type === 'media') {
      parts.push(...convertMediaBlockToGeminiParts(block));
    }
  }
  return parts;
}

export function convertAiBlocksToGeminiParts(
  blocks: IContent['blocks'],
): Part[] {
  const parts: Part[] = [];
  for (const block of blocks) {
    if (block.type === 'text') {
      parts.push({ text: block.text });
    } else if (block.type === 'tool_call') {
      parts.push({
        functionCall: {
          id: block.id,
          name: block.name,
          args: block.parameters,
        },
      } as Part);
    }
  }
  return parts;
}

export function convertToolContentToGeminiContents(
  content: IContent,
  currentModel: string,
  configForMessages: unknown,
  contents: Array<{ role: string; parts: Part[] }>,
): void {
  const toolResponseBlock = content.blocks.find(
    (b) => b.type === 'tool_response',
  );
  if (!toolResponseBlock) {
    throw new Error('Tool content must have a tool_response block');
  }
  const mediaBlocks = content.blocks.filter(
    (b): b is MediaBlock => b.type === 'media',
  );
  const payload = buildToolResponsePayload(
    toolResponseBlock,
    configForMessages as Config | undefined,
  );
  const frPart: Part = {
    functionResponse: {
      id: toolResponseBlock.callId,
      name: toolResponseBlock.toolName,
      response: {
        status: payload.status,
        result: payload.result,
        error: payload.error,
        truncated: payload.truncated,
        originalLength: payload.originalLength,
        limitMessage: payload.limitMessage,
      },
    },
  };
  if (mediaBlocks.length > 0 && isGemini3Model(currentModel)) {
    frPart.functionResponse!.parts = mediaBlocks.map((mb) => ({
      inlineData: { mimeType: mb.mimeType, data: mb.data },
    }));
    contents.push({ role: 'user', parts: [frPart] });
  } else if (mediaBlocks.length > 0) {
    const parts: Part[] = [frPart];
    for (const mb of mediaBlocks) {
      parts.push({
        inlineData: { mimeType: mb.mimeType, data: mb.data },
      } as Part);
    }
    contents.push({ role: 'user', parts });
  } else {
    contents.push({ role: 'user', parts: [frPart] });
  }
}

export function convertHistoryToGeminiFormat(
  content: IContent[],
  currentModel = 'gemini-2.5-pro',
  configForMessages?: unknown,
): Array<{ role: string; parts: Part[] }> {
  const contents: Array<{ role: string; parts: Part[] }> = [];
  for (const c of content) {
    switch (c.speaker) {
      case 'human': {
        const parts = convertHumanBlocksToGeminiParts(c.blocks);
        if (parts.length > 0) {
          contents.push({ role: 'user', parts });
        }
        break;
      }
      case 'ai': {
        const parts = convertAiBlocksToGeminiParts(c.blocks);
        if (parts.length > 0) {
          contents.push({ role: 'model', parts });
        }
        break;
      }
      case 'tool':
        convertToolContentToGeminiContents(
          c,
          currentModel,
          configForMessages,
          contents,
        );
        break;
      default:
        break;
    }
  }
  return contents;
}
