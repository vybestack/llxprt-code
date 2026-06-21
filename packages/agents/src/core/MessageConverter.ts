/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * MessageConverter - Pure functions for Gemini SDK ↔ IContent format translation.
 * Handles format conversion, speaker semantics, finish-reason mapping, and validation.
 */

import type { GenerateContentResponse } from '@google/genai';
import {
  type Content,
  type Part,
  createUserContent,
  type PartListUnion,
  FinishReason,
} from '@google/genai';
import type {
  IContent,
  ContentBlock,
  ToolCallBlock,
  ToolResponseBlock,
  ThinkingBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  type ThoughtPart,
  isThoughtPart,
  type UsageMetadataWithCache,
} from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import { getResponseTextFromParts } from '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js';

const logger = new DebugLogger('llxprt:core:message-converter');

// ---------------------------------------------------------------------------
// Boundary-validation helpers (typed `unknown` so guards are necessary)
// ---------------------------------------------------------------------------

/**
 * Returns true if `value` is a non-null object. Items in `PartListUnion`
 * come from external/provider data where `typeof null === 'object'`.
 */
function isNonNullObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

/**
 * Type-guard for a Part carrying a `functionResponse`. Restores main's
 * `item !== null && typeof item === 'object' && 'functionResponse' in item`
 * check (`'functionResponse' in null` throws).
 */
function isFunctionResponsePart(item: unknown): boolean {
  return (
    typeof item === 'object' && item !== null && 'functionResponse' in item
  );
}

/**
 * Returns true if `part` is undefined, null, or an empty object. Restores
 * main's `part === undefined || Object.keys(part).length === 0` guard
 * (`Object.keys(undefined)` throws).
 */
function isEmptyOrMissingPart(part: unknown): boolean {
  return (
    part === undefined ||
    part === null ||
    Object.keys(part as Record<string, unknown>).length === 0
  );
}

/**
 * Reads a token count from provider usage metadata, defaulting to 0 when the
 * field is absent. `UsageStats` declares these counts as required numbers, but
 * `usage` is provider/runtime-boundary data that may omit them, so the default
 * (main's `?? 0`) must be preserved via boundary validation. Mirrors `?? 0`
 * exactly: only nullish values default; any present value passes through.
 */
function usageTokenCount(value: unknown): number {
  if (value === null || value === undefined) {
    return 0;
  }
  return value as number;
}

/**
 * Aggregates text from content blocks while preserving spacing around non-text blocks.
 */
export function aggregateTextWithSpacing(
  blocks: ContentBlock[],
  currentText: string,
  lastBlockWasNonText: boolean,
): { text: string; lastBlockWasNonText: boolean } {
  let aggregatedText = currentText;
  let wasNonText = lastBlockWasNonText;

  for (const block of blocks) {
    if (block.type === 'text') {
      if (wasNonText && aggregatedText.length > 0) {
        aggregatedText += ' ';
      }
      aggregatedText += block.text;
      wasNonText = false;
    } else {
      wasNonText = true;
    }
  }

  return { text: aggregatedText, lastBlockWasNonText: wasNonText };
}

/**
 * Pushes mixed content items into a parts array, flattening nested arrays.
 */
function pushMixedContentParts(
  message: Array<Part | string>,
  parts: Part[],
): void {
  for (const item of message) {
    if (typeof item === 'string') {
      parts.push({ text: item });
    } else if (Array.isArray(item)) {
      for (const subItem of item) {
        parts.push(subItem);
      }
    } else if (isNonNullObject(item)) {
      parts.push(item);
    }
  }
}

/**
 * Custom createUserContent that properly handles function response arrays.
 * Each response must be a separate Part in the same Content, not nested arrays.
 */
export function createUserContentWithFunctionResponseFix(
  message: PartListUnion,
): Content {
  if (typeof message === 'string') {
    return createUserContent(message);
  }

  // Handle array of parts or nested function response arrays
  const parts: Part[] = [];

  // If the message is an array, process each element
  if (Array.isArray(message)) {
    // First check if this is an array of functionResponse Parts
    // This happens when multiple tool responses are sent together
    const allFunctionResponses = message.every((item) =>
      isFunctionResponsePart(item),
    );

    if (allFunctionResponses) {
      // This is already a properly formatted array of function response Parts
      // Just use them directly without any wrapping
      // Cast is safe here because we've checked all items are objects with functionResponse
      parts.push(...(message as Part[]));
    } else {
      // Process mixed content
      pushMixedContentParts(message, parts);
    }
  } else {
    // Not an array, pass through to original createUserContent
    return createUserContent(message);
  }

  return {
    role: 'user' as const,
    parts,
  };
}

/**
 * Normalizes tool interaction input for the provider.
 * Packages tool responses as user messages.
 */
export function normalizeToolInteractionInput(
  message: PartListUnion,
): Content | Content[] {
  // Handle simple string input
  if (typeof message === 'string') {
    return createUserContent(message);
  }

  // Handle single Part (not an array)
  if (!Array.isArray(message)) {
    return createUserContentWithFunctionResponseFix(message);
  }

  // Now we have an array of parts - check if it contains tool interactions
  const parts = message as Part[];

  // Detect if this is a tool response sequence (functionResponse parts only)
  const hasFunctionResponses = parts.some((part) =>
    isFunctionResponsePart(part),
  );

  // If no function responses, fall back to original behavior
  if (!hasFunctionResponses) {
    return createUserContentWithFunctionResponseFix(message);
  }

  // Tool responses go in a user message
  return createUserContentWithFunctionResponseFix(parts);
}

/**
 * Checks if a part contains valid non-thought text content.
 */
export function isValidNonThoughtTextPart(part: Part): boolean {
  const hasText = typeof part.text === 'string' && part.thought !== true;
  const hasNonTextPayload =
    Boolean(part.functionCall) ||
    Boolean(part.functionResponse) ||
    Boolean(part.inlineData) ||
    Boolean(part.fileData);
  // Technically, the model should never generate parts that have text and
  // any of these but we don't trust them so check anyways.
  return hasText && !hasNonTextPayload;
}

/**
 * Returns true if the response is valid, false otherwise.
 */
export function isValidResponse(response: GenerateContentResponse): boolean {
  if (response.candidates === undefined || response.candidates.length === 0) {
    return false;
  }
  const content = response.candidates[0]?.content;
  if (content === undefined) {
    return false;
  }
  return isValidContent(content);
}

/**
 * Validates if Content has valid parts.
 */
export function isValidContent(content: Content): boolean {
  if (content.parts === undefined || content.parts.length === 0) {
    return false;
  }
  for (const part of content.parts) {
    if (isEmptyOrMissingPart(part)) {
      return false;
    }
    if (part.thought !== true && part.text !== undefined && part.text === '') {
      return false;
    }
  }
  return true;
}

/**
 * Validates the history contains the correct roles.
 */
export function validateHistory(history: Content[]): void {
  for (const content of history) {
    if (content.role !== 'user' && content.role !== 'model') {
      throw new Error(`Role must be user or model, but got ${content.role}.`);
    }
  }
}

/**
 * Extracts valid history turns from comprehensive history.
 * Filters out invalid or empty contents from safety filters or recitation.
 */
export function extractCuratedHistory(
  comprehensiveHistory: Content[],
): Content[] {
  if (comprehensiveHistory.length === 0) {
    return [];
  }
  const curatedHistory: Content[] = [];
  const length = comprehensiveHistory.length;
  let i = 0;
  while (i < length) {
    if (comprehensiveHistory[i].role === 'user') {
      curatedHistory.push(comprehensiveHistory[i]);
      i++;
    } else {
      const result = collectModelRun(comprehensiveHistory, i, length);
      i = result.nextIndex;
      if (result.isValid) {
        curatedHistory.push(...result.modelOutput);
      }
    }
  }
  return curatedHistory;
}

/**
 * Collects a contiguous run of model-role content, tracking validity.
 */
function collectModelRun(
  history: Content[],
  startIndex: number,
  length: number,
): { modelOutput: Content[]; isValid: boolean; nextIndex: number } {
  const modelOutput: Content[] = [];
  let isValid = true;
  let i = startIndex;
  while (i < length && history[i].role === 'model') {
    modelOutput.push(history[i]);
    if (isValid && !isValidContent(history[i])) {
      isValid = false;
    }
    i++;
  }
  return { modelOutput, isValid, nextIndex: i };
}

/**
 * Checks if a Content has text content in the first part.
 */
export function hasTextContent(
  content: Content | undefined,
): content is Content & { parts: [{ text: string }, ...Part[]] } {
  if (
    !content ||
    content.role !== 'model' ||
    !content.parts ||
    content.parts.length === 0
  ) {
    return false;
  }
  const firstPartText = content.parts[0].text;
  return typeof firstPartText === 'string' && firstPartText !== '';
}

/**
 * Convert PartListUnion (user input) to IContent format.
 */
export function convertPartListUnionToIContent(input: PartListUnion): IContent {
  if (typeof input === 'string') {
    // Simple string input from user
    return {
      speaker: 'human',
      blocks: [{ type: 'text', text: input }],
    };
  }

  // Handle Part or Part[] - delegate to helper
  // After filtering out string case, input is PartUnion[] | PartUnion = (Part | string)[] | Part | string
  // But we know strings are already handled, so cast to Part[]
  const parts = (Array.isArray(input) ? input : [input]) as Part[];
  return convertMixedPartsToIContent(parts);
}

/**
 * Converts mixed Parts (function calls, responses, text, thoughts) to IContent.
 */
export function convertMixedPartsToIContent(parts: Part[]): IContent {
  // Fast path: all function responses → tool message
  const allFunctionResponses = parts.every((part) =>
    isFunctionResponsePart(part),
  );
  if (allFunctionResponses) {
    return convertAllFunctionResponses(parts);
  }

  // Mixed content: classify parts and determine speaker
  const { blocks, hasAIContent, hasToolContent } = classifyMixedParts(parts);

  return {
    speaker: resolveSpeaker(hasToolContent, hasAIContent),
    blocks,
  };
}

function resolveSpeaker(
  hasToolContent: boolean,
  hasAIContent: boolean,
): IContent['speaker'] {
  if (hasToolContent) {
    return 'tool';
  }
  if (hasAIContent) {
    return 'ai';
  }
  return 'human';
}

function convertAllFunctionResponses(parts: Part[]): IContent {
  const blocks: ContentBlock[] = [];
  for (const part of parts) {
    if (
      isNonNullObject(part) &&
      'functionResponse' in part &&
      part.functionResponse
    ) {
      blocks.push({
        type: 'tool_response',
        callId: part.functionResponse.id ?? '',
        toolName: part.functionResponse.name ?? '',
        result: part.functionResponse.response ?? {},
        error: undefined,
      } as ToolResponseBlock);
    }
  }
  return { speaker: 'tool', blocks };
}

function classifyMixedParts(parts: Part[]): {
  blocks: ContentBlock[];
  hasAIContent: boolean;
  hasToolContent: boolean;
} {
  const blocks: ContentBlock[] = [];
  let hasAIContent = false;
  let hasToolContent = false;

  for (const part of parts) {
    if (typeof part === 'string') {
      blocks.push({ type: 'text', text: part });
    } else if (isThoughtPart(part)) {
      const thinkingBlock: ThinkingBlock = {
        type: 'thinking',
        thought: part.text ?? '',
        isHidden: true,
        sourceField: part.llxprtSourceField ?? 'thought',
      };
      if (part.thoughtSignature) {
        thinkingBlock.signature = part.thoughtSignature;
      }
      blocks.push(thinkingBlock);
      hasAIContent = true;
    } else if ('text' in part && part.text !== undefined) {
      blocks.push({ type: 'text', text: part.text });
    } else if ('functionCall' in part && part.functionCall) {
      hasAIContent = true;
      blocks.push({
        type: 'tool_call',
        id: part.functionCall.id ?? '',
        name: part.functionCall.name ?? '',
        parameters: part.functionCall.args ?? {},
      } as ToolCallBlock);
    } else if ('functionResponse' in part && part.functionResponse) {
      hasToolContent = true;
      blocks.push({
        type: 'tool_response',
        callId: part.functionResponse.id ?? '',
        toolName: part.functionResponse.name ?? '',
        result: part.functionResponse.response ?? {},
        error: undefined,
      } as ToolResponseBlock);
    }
  }

  return { blocks, hasAIContent, hasToolContent };
}

/**
 * Converts IContent blocks to Gemini Parts array.
 */
export function convertBlocksToParts(blocks: ContentBlock[]): Part[] {
  const parts: Part[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        parts.push({ text: block.text });
        break;
      case 'tool_call': {
        const toolCall = block;
        parts.push({
          functionCall: {
            id: toolCall.id,
            name: toolCall.name,
            args: toolCall.parameters as Record<string, unknown>,
          },
        });
        break;
      }
      case 'tool_response': {
        const toolResponse = block;
        parts.push({
          functionResponse: {
            id: toolResponse.callId,
            name: toolResponse.toolName,
            response: toolResponse.result as Record<string, unknown>,
          },
        });
        break;
      }
      case 'thinking': {
        const thinkingBlock = block;
        const thoughtPart: ThoughtPart = {
          thought: true,
          text: thinkingBlock.thought,
        };
        if (thinkingBlock.signature) {
          thoughtPart.thoughtSignature = thinkingBlock.signature;
        }
        if (thinkingBlock.sourceField) {
          thoughtPart.llxprtSourceField = thinkingBlock.sourceField;
        }
        parts.push(thoughtPart);
        break;
      }
      default:
        break;
    }
  }

  return parts;
}

/**
 * Convert IContent to GenerateContentResponse for SDK compatibility.
 */
export function convertIContentToResponse(
  input: IContent,
): GenerateContentResponse {
  const parts = convertBlocksToParts(input.blocks);

  const response = {
    candidates: [
      {
        content: {
          role: 'model',
          parts,
        },
      },
    ],
    get text() {
      return getResponseTextFromParts(parts) ?? '';
    },
    functionCalls: parts
      .filter((p) => 'functionCall' in p)
      .map((p) => p.functionCall!),
    executableCode: undefined,
    codeExecutionResult: undefined,
  } as GenerateContentResponse;

  return applyResponseMetadata(response, input, parts);
}

/**
 * Maps termination reason (stopReason/finishReason) to Gemini FinishReason
 * and applies it to the first candidate. Logs warnings for unmapped or
 * missing-candidate cases.
 */
function applyFinishReasonMapping(
  response: GenerateContentResponse,
  input: IContent,
): void {
  const terminationReason =
    input.metadata?.stopReason ?? input.metadata?.finishReason;

  if (terminationReason && response.candidates?.[0]) {
    const finishReasonByTerminationReason: Record<string, FinishReason> = {
      // Anthropic/Gemini-style values
      end_turn: FinishReason.STOP,
      max_tokens: FinishReason.MAX_TOKENS,
      stop_sequence: FinishReason.STOP,
      tool_use: FinishReason.STOP,
      pause_turn: FinishReason.STOP,
      refusal: FinishReason.STOP,
      model_context_window_exceeded: FinishReason.MAX_TOKENS,
      // OpenAI Chat Completions-style values
      stop: FinishReason.STOP,
      length: FinishReason.MAX_TOKENS,
      tool_calls: FinishReason.STOP,
      function_call: FinishReason.STOP,
      content_filter: FinishReason.SAFETY,
      // OpenAI Responses API status values
      completed: FinishReason.STOP,
      incomplete: FinishReason.MAX_TOKENS,
      failed: FinishReason.STOP,
    };
    const hasMapping = Object.prototype.hasOwnProperty.call(
      finishReasonByTerminationReason,
      terminationReason,
    );
    if (hasMapping) {
      const mappedReason = finishReasonByTerminationReason[terminationReason];
      response.candidates[0].finishReason = mappedReason;
      logger.debug(
        () => `[stream:message-converter] applied terminal metadata`,
        {
          speaker: input.speaker,
          blockCount: input.blocks.length,
          stopReason: input.metadata?.stopReason,
          finishReason: input.metadata?.finishReason,
          terminationReason,
          mappedFinishReason: mappedReason,
        },
      );
    } else {
      logger.warn(
        () =>
          `[stream:message-converter] terminal metadata did not map to Gemini finishReason`,
        {
          speaker: input.speaker,
          blockCount: input.blocks.length,
          stopReason: input.metadata?.stopReason,
          finishReason: input.metadata?.finishReason,
          terminationReason,
        },
      );
    }
  } else if (input.metadata?.stopReason || input.metadata?.finishReason) {
    logger.warn(
      () =>
        `[stream:message-converter] terminal metadata present but response candidate missing`,
      {
        speaker: input.speaker,
        blockCount: input.blocks.length,
        stopReason: input.metadata.stopReason,
        finishReason: input.metadata.finishReason,
        hasCandidate: Boolean(response.candidates?.[0]),
      },
    );
  }
}

/**
 * Adds usage metadata, finish reason, and data property to the response.
 */
export function applyResponseMetadata(
  response: GenerateContentResponse,
  input: IContent,
  _parts: Part[],
): GenerateContentResponse {
  // Add data property that returns self-reference
  // Make it non-enumerable to avoid circular reference in JSON.stringify
  Object.defineProperty(response, 'data', {
    get() {
      return response;
    },
    enumerable: false,
    configurable: true,
  });

  // Add usage metadata if present
  if (input.metadata?.usage) {
    const usageMetadata: UsageMetadataWithCache = {
      promptTokenCount: usageTokenCount(input.metadata.usage.promptTokens),
      candidatesTokenCount: usageTokenCount(
        input.metadata.usage.completionTokens,
      ),
      totalTokenCount: usageTokenCount(input.metadata.usage.totalTokens),
      cache_read_input_tokens:
        input.metadata.usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens:
        input.metadata.usage.cache_creation_input_tokens ?? 0,
    };
    response.usageMetadata = usageMetadata;
  }

  applyFinishReasonMapping(response, input);

  return response;
}
