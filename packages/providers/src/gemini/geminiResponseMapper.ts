/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Part, type FunctionCall, type Content } from '@google/genai';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  type IContent,
  type ToolCallBlock,
  type ThinkingBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { ContentConverters } from '@vybestack/llxprt-code-core/services/history/ContentConverters.js';
import { extractAfcHistory } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { GenerateContentResponse } from '@google/genai';

/** Subset of Gemini usage metadata consumed by chunk mapping. */
export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

interface GeminiResponseWithUsage {
  usageMetadata?: GeminiUsageMetadata;
}

/** Response-to-chunks mapping function signature. */
export type ResponseToChunksMapper = (
  response: GenerateContentResponse,
  includeThoughts?: boolean,
) => IContent[];

interface ThoughtExtraction {
  thoughtParts: Part[];
  nonThoughtTextParts: Part[];
  thoughtSignature: string | undefined;
}

function extractThoughtInfo(
  parts: Part[],
  thinkingLogger: DebugLogger,
): ThoughtExtraction {
  thinkingLogger.log(
    () => '[GeminiProvider] Response parts received',
    parts.map((p: Part) => ({
      hasText: 'text' in p,
      thought: (p as Part & { thought?: boolean }).thought,
      hasThoughtSignature: !!(p as Part & { thoughtSignature?: string })
        .thoughtSignature,
      hasFunctionCall: 'functionCall' in p,
      textPreview:
        'text' in p
          ? (p as { text: string }).text.substring(0, 100)
          : undefined,
    })),
  );
  const thoughtParts = parts.filter(
    (part: Part) =>
      'text' in part && (part as Part & { thought?: boolean }).thought === true,
  );
  const nonThoughtTextParts = parts.filter(
    (part: Part) =>
      'text' in part && (part as Part & { thought?: boolean }).thought !== true,
  );
  const firstPartWithSig = parts.find(
    (part: Part) =>
      (part as Part & { thoughtSignature?: string }).thoughtSignature,
  );
  const thoughtSignature = firstPartWithSig
    ? (firstPartWithSig as Part & { thoughtSignature?: string })
        .thoughtSignature
    : undefined;
  thinkingLogger.log(() => '[GeminiProvider] Thought extraction results', {
    thoughtPartsCount: thoughtParts.length,
    nonThoughtTextPartsCount: nonThoughtTextParts.length,
    thoughtTextLength: thoughtParts
      .map((p: Part) => (p as { text: string }).text)
      .join('').length,
    includeThoughts: true,
    willYieldThinkingBlock: thoughtParts.length > 0,
  });
  return { thoughtParts, nonThoughtTextParts, thoughtSignature };
}

function buildUsageMetadata(usageMetadata?: GeminiUsageMetadata):
  | {
      usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      };
    }
  | undefined {
  if (!usageMetadata) {
    return undefined;
  }
  return {
    usage: {
      promptTokens: usageMetadata.promptTokenCount ?? 0,
      completionTokens: usageMetadata.candidatesTokenCount ?? 0,
      totalTokens:
        usageMetadata.totalTokenCount ??
        (usageMetadata.promptTokenCount ?? 0) +
          (usageMetadata.candidatesTokenCount ?? 0),
    },
  };
}

function pushTextAndToolCallChunks(
  chunks: IContent[],
  text: string,
  functionCalls: FunctionCall[],
  usageMetadata?: GeminiUsageMetadata,
): void {
  if (text) {
    const textContent: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text }],
    };
    const usage = buildUsageMetadata(usageMetadata);
    if (usage) {
      textContent.metadata = usage;
    }
    chunks.push(textContent);
  }
  if (functionCalls.length > 0) {
    const blocks: ToolCallBlock[] = functionCalls.map((call: FunctionCall) => ({
      type: 'tool_call' as const,
      id:
        call.id ??
        `call_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      name: call.name ?? 'unknown_function',
      parameters: call.args ?? {},
    }));
    const toolCallContent: IContent = { speaker: 'ai', blocks };
    const usage = buildUsageMetadata(usageMetadata);
    if (usage) {
      toolCallContent.metadata = usage;
    }
    chunks.push(toolCallContent);
  }
}

function pushFallbackChunks(
  chunks: IContent[],
  text: string,
  functionCalls: FunctionCall[],
  usageMetadata?: GeminiUsageMetadata,
): void {
  if (usageMetadata && !text && functionCalls.length === 0) {
    const content: IContent = {
      speaker: 'ai',
      blocks: [],
      metadata: buildUsageMetadata(usageMetadata),
    } as IContent;
    chunks.push(content);
  }
  if (!usageMetadata && !text && functionCalls.length === 0) {
    chunks.push({ speaker: 'ai', blocks: [] } as IContent);
  }
}

/**
 * Converts the Gemini SDK automatic-function-calling (AFC) history into
 * neutral IContent[] and stamps it onto the FIRST emitted chunk's
 * `metadata.providerMetadata.automaticFunctionCallingHistory` so that the core
 * conversion boundary (`toModelStreamChunk`) can promote it into the neutral
 * first-class `afcHistory` field (and strip the raw key).
 *
 * Provider boundary responsibility: this is the ONLY place Gemini's
 * `Content[]` AFC shape is translated to neutral IContent. After this point,
 * downstream consumers see neutral IContent exclusively.
 *
 * Behavior:
 *  - No-op when there is no AFC history (undefined/empty).
 *  - Converts each Gemini `Content` via `ContentConverters.toIContent`.
 *  - Validates the neutral sequence through the core boundary helper
 *    (`extractAfcHistory`). Malformed histories are NOT attached — the
 *    carrier chunk's metadata is left untouched.
 *  - Attaches EXACTLY ONCE to the first chunk, preserving any existing
 *    metadata (e.g. usage) and provider metadata.
 */
function attachAfcHistory(
  chunks: IContent[],
  afcHistory: Content[] | undefined,
): void {
  if (afcHistory === undefined || afcHistory.length === 0) {
    return;
  }
  if (chunks.length === 0) {
    return;
  }

  const neutralHistory = afcHistory.map((content: Content) =>
    ContentConverters.toIContent(content),
  );

  // Validate each entry via the core AFC boundary helper by constructing a
  // carrier whose provider metadata holds the neutral history. Cross-entry
  // pairing is intentionally not enforced; structurally invalid entries cause
  // the helper to return undefined and nothing is attached.
  const validationCarrier: IContent = {
    speaker: 'ai',
    blocks: [],
    metadata: {
      providerMetadata: {
        automaticFunctionCallingHistory: neutralHistory,
      },
    },
  };
  const validated = extractAfcHistory(validationCarrier);
  if (validated === undefined) {
    return;
  }

  const target = chunks[0];
  target.metadata = {
    ...target.metadata,
    providerMetadata: {
      ...target.metadata?.providerMetadata,
      automaticFunctionCallingHistory: validated,
    },
  };
}

/**
 * Creates the response-to-chunks mapper used by streaming and non-streaming
 * generation paths.
 */
export function createGeminiResponseMapper(): ResponseToChunksMapper {
  const thinkingLogger = new DebugLogger('llxprt:provider:gemini:thinking');
  return (
    response: GenerateContentResponse,
    includeThoughts = true,
  ): IContent[] => {
    const chunks: IContent[] = [];
    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const { thoughtParts, nonThoughtTextParts, thoughtSignature } =
      extractThoughtInfo(parts, thinkingLogger);
    const text = nonThoughtTextParts
      .map((part: Part) => (part as { text: string }).text)
      .join('');
    const thoughtText = thoughtParts
      .map((part: Part) => (part as { text: string }).text)
      .join('');
    const functionCalls = parts
      .filter((part: Part) => 'functionCall' in part)
      .map(
        (part: Part) => (part as { functionCall: FunctionCall }).functionCall,
      );
    const usageMetadata = (response as GeminiResponseWithUsage).usageMetadata;

    if (thoughtText && includeThoughts) {
      const thinkingBlock: ThinkingBlock = {
        type: 'thinking',
        thought: thoughtText,
        sourceField: 'thought',
        isHidden: false,
      };
      if (thoughtSignature) {
        thinkingBlock.signature = thoughtSignature;
      }
      chunks.push({ speaker: 'ai', blocks: [thinkingBlock] });
    }
    pushTextAndToolCallChunks(chunks, text, functionCalls, usageMetadata);
    pushFallbackChunks(chunks, text, functionCalls, usageMetadata);
    attachAfcHistory(chunks, response.automaticFunctionCallingHistory);
    return chunks;
  };
}
