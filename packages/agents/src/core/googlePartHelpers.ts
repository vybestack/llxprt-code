/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Google Part-shaped helpers retained by the agents package until the full
 * #2349 retirement of the synthetic GenerateContentResponse pipeline. These
 * operate on legacy Google Part shapes and are NOT part of the neutral
 * llm-types layer.
 *
 * @issue #2348 — moved from core/src/core/chatSessionTypes.ts so core has zero
 * @google/genai imports.
 */

import type {
  Part,
  FunctionCall,
  GenerateContentResponseUsageMetadata,
} from '@google/genai';
import type { ThinkingBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ResponseOutcome } from '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js';

export type UsageMetadataWithCache = GenerateContentResponseUsageMetadata & {
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  toolUsePromptTokenCount?: number;
};

export type ThoughtPart = Part & {
  thought: true;
  text?: string;
  thoughtSignature?: string;
  llxprtSourceField?: ThinkingBlock['sourceField'];
};

export function isThoughtPart(part: Part | undefined): part is ThoughtPart {
  return Boolean(
    part &&
      typeof part === 'object' &&
      'thought' in part &&
      part.thought === true,
  );
}

/**
 * Extracts function calls from Google Part[]. Local copy retained in agents
 * until #2349 full retirement of the synthetic response pipeline. Core's
 * version migrates to ContentBlock[] (getToolCallBlocks).
 *
 * @issue #2348
 */
export function getFunctionCallsFromParts(
  parts: Part[],
): FunctionCall[] | undefined {
  const functionCallParts = parts
    .filter((part) => part.functionCall !== undefined)
    .map((part) => part.functionCall as FunctionCall);
  return functionCallParts.length > 0 ? functionCallParts : undefined;
}

/**
 * Extracts visible text from Google Part[], filtering out thought parts.
 * Local copy retained in agents until #2349 full retirement of the synthetic
 * response pipeline. Core's version migrates to ContentBlock[]
 * (getResponseTextFromBlocks).
 *
 * @issue #2348
 */
export function getResponseTextFromParts(parts: Part[]): string | undefined {
  const textSegments = parts
    .filter((part) => !isThoughtPart(part))
    .map((part) => part.text)
    .filter((text): text is string => typeof text === 'string');

  if (textSegments.length === 0) {
    return undefined;
  }
  return textSegments.join('');
}

/**
 * Analyzes Google Part[] to determine the canonical response outcome.
 * Local copy retained in agents until #2349 full retirement of the synthetic
 * response pipeline. Core's version operates on ContentBlock[].
 *
 * @issue #2348
 */
export function analyzeResponseOutcomeFromParts(
  parts: Part[],
): ResponseOutcome {
  let hasVisibleText = false;
  let hasThinking = false;
  let hasToolCalls = false;

  for (const part of parts) {
    const isThinking = isThoughtPart(part);
    if (isThinking) {
      hasThinking = true;
    }
    if (part.functionCall !== undefined) {
      hasToolCalls = true;
    }
    if (
      !isThinking &&
      typeof part.text === 'string' &&
      part.text.trim() !== ''
    ) {
      hasVisibleText = true;
    }
  }

  return {
    hasVisibleText,
    hasThinking,
    hasToolCalls,
    isActionable: hasVisibleText || hasToolCalls,
  };
}
