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
} from '../services/history/IContent.js';
import {
  type ThoughtPart,
  isThoughtPart,
  type UsageMetadataWithCache,
} from './geminiChatTypes.js';

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
    const allFunctionResponses = message.every(
      (item) => item && typeof item === 'object' && 'functionResponse' in item,
    );

    if (allFunctionResponses) {
      // This is already a properly formatted array of function response Parts
      // Just use them directly without any wrapping
      // Cast is safe here because we've checked all items are objects with functionResponse
      parts.push(...(message as Part[]));
    } else {
      // Process mixed content
      for (const item of message) {
        if (typeof item === 'string') {
          parts.push({ text: item });
        } else if (Array.isArray(item)) {
          // Nested array case - flatten it
          for (const subItem of item) {
            parts.push(subItem);
          }
        } else if (item && typeof item === 'object') {
          // Individual part (function response, text, etc.)
          parts.push(item);
        }
      }
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
  const hasFunctionResponses = parts.some(
    (part) => part && typeof part === 'object' && 'functionResponse' in part,
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
  return (
    typeof part.text === 'string' &&
    !part.thought &&
    // Technically, the model should never generate parts that have text and
    // any of these but we don't trust them so check anyways.
    !part.functionCall &&
    !part.functionResponse &&
    !part.inlineData &&
    !part.fileData
  );
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
    if (part === undefined || Object.keys(part).length === 0) {
      return false;
    }
    if (!part.thought && part.text !== undefined && part.text === '') {
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
  if (comprehensiveHistory === undefined || comprehensiveHistory.length === 0) {
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
      const modelOutput: Content[] = [];
      let isValid = true;
      while (i < length && comprehensiveHistory[i].role === 'model') {
        modelOutput.push(comprehensiveHistory[i]);
        if (isValid && !isValidContent(comprehensiveHistory[i])) {
          isValid = false;
        }
        i++;
      }
      if (isValid) {
        curatedHistory.push(...modelOutput);
      }
    }
  }
  return curatedHistory;
}

/**
 * Checks if a Content has text content in the first part.
 */
export function hasTextContent(
  content: Content | undefined,
): content is Content & { parts: [{ text: string }, ...Part[]] } {
  return !!(
    content &&
    content.role === 'model' &&
    content.parts &&
    content.parts.length > 0 &&
    typeof content.parts[0].text === 'string' &&
    content.parts[0].text !== ''
  );
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
  const allFunctionResponses = parts.every(
    (part) => part && typeof part === 'object' && 'functionResponse' in part,
  );
  if (allFunctionResponses) {
    return convertAllFunctionResponses(parts);
  }

  // Mixed content: classify parts and determine speaker
  const { blocks, hasAIContent, hasToolContent } = classifyMixedParts(parts);

  return {
    speaker: hasToolContent ? 'tool' : hasAIContent ? 'ai' : 'human',
    blocks,
  };
}

function convertAllFunctionResponses(parts: Part[]): IContent {
  const blocks: ContentBlock[] = [];
  for (const part of parts) {
    if (
      typeof part === 'object' &&
      'functionResponse' in part &&
      part.functionResponse
    ) {
      blocks.push({
        type: 'tool_response',
        callId: part.functionResponse.id || '',
        toolName: part.functionResponse.name || '',
        result:
          (part.functionResponse.response as Record<string, unknown>) || {},
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
        id: part.functionCall.id || '',
        name: part.functionCall.name || '',
        parameters: (part.functionCall.args as Record<string, unknown>) || {},
      } as ToolCallBlock);
    } else if ('functionResponse' in part && part.functionResponse) {
      hasToolContent = true;
      blocks.push({
        type: 'tool_response',
        callId: part.functionResponse.id || '',
        toolName: part.functionResponse.name || '',
        result:
          (part.functionResponse.response as Record<string, unknown>) || {},
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
      return (
        parts
          .filter((p) => 'text' in p && !isThoughtPart(p))
          .map((p) => p.text)
          .join('') || ''
      );
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
      promptTokenCount: input.metadata.usage.promptTokens || 0,
      candidatesTokenCount: input.metadata.usage.completionTokens || 0,
      totalTokenCount: input.metadata.usage.totalTokens || 0,
      cache_read_input_tokens:
        input.metadata.usage.cache_read_input_tokens || 0,
      cache_creation_input_tokens:
        input.metadata.usage.cache_creation_input_tokens || 0,
    };
    response.usageMetadata = usageMetadata;
  }

  // Map stopReason and/or finishReason to Gemini finishReason
  // (issue #1844): providers may emit either field; honor both.
  const inputStopReason = input.metadata?.stopReason;
  const inputFinishReason = input.metadata?.finishReason;

  if ((inputStopReason || inputFinishReason) && response.candidates?.[0]) {
    // Build a unified mapping table covering Anthropic-style stop reasons,
    // OpenAI-style finish reasons, and Responses API statuses.
    const finishReasonMap: Record<string, FinishReason> = {
      // Anthropic-style stopReason values
      end_turn: FinishReason.STOP,
      max_tokens: FinishReason.MAX_TOKENS,
      stop_sequence: FinishReason.STOP,
      tool_use: FinishReason.STOP,
      pause_turn: FinishReason.STOP,
      refusal: FinishReason.STOP,
      model_context_window_exceeded: FinishReason.MAX_TOKENS,
      // OpenAI-style finishReason values
      stop: FinishReason.STOP,
      length: FinishReason.MAX_TOKENS,
      tool_calls: FinishReason.STOP,
      content_filter: FinishReason.STOP,
      // OpenAI Responses API status values
      completed: FinishReason.STOP,
      incomplete: FinishReason.MAX_TOKENS,
      failed: FinishReason.STOP,
    };

    // Prefer stopReason (Anthropic/Gemini native) over finishReason (OpenAI)
    const mappedReason =
      (inputStopReason && finishReasonMap[inputStopReason]) ??
      (inputFinishReason && finishReasonMap[inputFinishReason]);

    if (mappedReason) {
      response.candidates[0].finishReason = mappedReason;
    }
  }

  return response;
}
