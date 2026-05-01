/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GenerateContentResponse } from '@google/genai';
import {
  type Part,
  type FunctionCall,
  type PartListUnion,
} from '@google/genai';
import {
  limitOutputTokens,
  type ToolOutputSettingsProvider,
} from './toolOutputLimiter.js';
import type { ToolErrorType } from '../index.js';
import {
  type ToolCallRequestInfo,
  type ToolCallResponseInfo,
} from '../index.js';
import { DEFAULT_AGENT_ID } from '../core/turn.js';
import { DebugLogger } from '../debug/index.js';

const toolSchedulerLogger = new DebugLogger('llxprt:core:tool-scheduler');

export function getResponseText(
  response: GenerateContentResponse,
): string | undefined {
  const parts = response.candidates?.[0]?.content?.parts;
  if (!parts) {
    return undefined;
  }

  // Filter out thought parts - thinking content should only go through Thought events,
  // not be duplicated in Content events. Model context path handles thinking separately
  // via IContent blocks and reasoning ephemerals. (fixes #721 duplicate thinking)
  const textSegments = parts
    .filter((part) => (part as { thought?: boolean }).thought !== true)
    .map((part) => part.text)
    .filter((text): text is string => typeof text === 'string');

  if (textSegments.length === 0) {
    return undefined;
  }
  return textSegments.join('');
}

export function getResponseTextFromParts(parts: Part[]): string | undefined {
  // Filter out thought parts - same as getResponseText (fixes #721)
  const textSegments = parts
    .filter((part) => (part as { thought?: boolean }).thought !== true)
    .map((part) => part.text)
    .filter((text): text is string => typeof text === 'string');

  if (textSegments.length === 0) {
    return undefined;
  }
  return textSegments.join('');
}

export function getFunctionCalls(
  response: GenerateContentResponse,
): FunctionCall[] | undefined {
  const parts = response.candidates?.[0]?.content?.parts;
  if (!parts) {
    return undefined;
  }

  const functionCallParts = parts
    .filter((part) => !!part.functionCall)
    .map((part) => part.functionCall as FunctionCall);
  return functionCallParts.length > 0 ? functionCallParts : undefined;
}

export function getFunctionCallsFromParts(
  parts: Part[],
): FunctionCall[] | undefined {
  const functionCallParts = parts
    .filter((part) => !!part.functionCall)
    .map((part) => part.functionCall as FunctionCall);
  return functionCallParts.length > 0 ? functionCallParts : undefined;
}

export function getFunctionCallsAsJson(
  response: GenerateContentResponse,
): string | undefined {
  const functionCalls = getFunctionCalls(response);
  if (!functionCalls) {
    return undefined;
  }
  return JSON.stringify(functionCalls, null, 2);
}

export function getFunctionCallsFromPartsAsJson(
  parts: Part[],
): string | undefined {
  const functionCalls = getFunctionCallsFromParts(parts);
  if (!functionCalls) {
    return undefined;
  }
  return JSON.stringify(functionCalls, null, 2);
}

export function getStructuredResponse(
  response: GenerateContentResponse,
): string | undefined {
  const textContent = getResponseText(response);
  const functionCallsJson = getFunctionCallsAsJson(response);

  if (textContent && functionCallsJson) {
    return `${textContent}\n${functionCallsJson}`;
  }
  if (textContent) {
    return textContent;
  }
  if (functionCallsJson) {
    return functionCallsJson;
  }
  return undefined;
}

export function getStructuredResponseFromParts(
  parts: Part[],
): string | undefined {
  const textContent = getResponseTextFromParts(parts);
  const functionCallsJson = getFunctionCallsFromPartsAsJson(parts);

  if (textContent && functionCallsJson) {
    return `${textContent}\n${functionCallsJson}`;
  }
  if (textContent) {
    return textContent;
  }
  if (functionCallsJson) {
    return functionCallsJson;
  }
  return undefined;
}

/**
 * @plan PLAN-20260302-TOOLSCHEDULER.P05
 * @package @vybestack/llxprt-code-core
 *
 * Response formatting utilities extracted from CoreToolScheduler.
 * These are pure transformation functions with no state dependencies.
 */

export function createFunctionResponsePart(
  callId: string,
  toolName: string,
  output: string,
): Part {
  return {
    functionResponse: {
      id: callId,
      name: toolName,
      response: { output },
    },
  };
}

export function limitStringOutput(
  text: string,
  toolName: string,
  config?: ToolOutputSettingsProvider,
): string {
  if (!config || typeof config.getEphemeralSettings !== 'function') {
    return text;
  }
  const limited = limitOutputTokens(text, config, toolName);
  if (!limited.wasTruncated) {
    return limited.content;
  }
  if (limited.content && limited.content.length > 0) {
    return limited.content;
  }
  return limited.message ?? '';
}

export function limitFunctionResponsePart(
  part: Part,
  toolName: string,
  config?: ToolOutputSettingsProvider,
): Part {
  if (!config || !part.functionResponse) {
    return part;
  }
  const response = part.functionResponse.response;
  if (!response || typeof response !== 'object') {
    return part;
  }
  const existingOutput = response['output'];
  if (typeof existingOutput !== 'string') {
    return part;
  }
  const limitedOutput = limitStringOutput(existingOutput, toolName, config);
  if (limitedOutput === existingOutput) {
    return part;
  }
  return {
    ...part,
    functionResponse: {
      ...part.functionResponse,
      response: {
        ...response,
        output: limitedOutput,
      },
    },
  };
}

export function toParts(input: PartListUnion): Part[] {
  const parts: Part[] = [];
  for (const part of Array.isArray(input) ? input : [input]) {
    if (typeof part === 'string') {
      parts.push({ text: part });
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- SDK PartListUnion callers can pass nullish entries at runtime.
    } else if (part !== null && part !== undefined) {
      parts.push(part);
    }
  }
  return parts;
}

export function convertToFunctionResponse(
  toolName: string,
  callId: string,
  llmContent: PartListUnion,
  config?: ToolOutputSettingsProvider,
): Part[] {
  // Handle simple string case
  if (typeof llmContent === 'string') {
    const limitedOutput = limitStringOutput(llmContent, toolName, config);
    return [createFunctionResponsePart(callId, toolName, limitedOutput)];
  }

  const parts = toParts(llmContent);

  // Separate text from binary types
  const textParts: string[] = [];
  const inlineDataParts: Part[] = [];
  const fileDataParts: Part[] = [];

  for (const part of parts) {
    if (part.text !== undefined) {
      textParts.push(part.text);
    } else if (part.inlineData) {
      inlineDataParts.push(part);
    } else if (part.fileData) {
      fileDataParts.push(part);
    } else if (part.functionResponse) {
      // Passthrough case - preserve existing response
      if (parts.length > 1) {
        toolSchedulerLogger.warn(
          'convertToFunctionResponse received multiple parts with a functionResponse. ' +
            'Only the functionResponse will be used, other parts will be ignored',
        );
      }
      const passthroughPart = {
        functionResponse: {
          id: callId,
          name: toolName,
          response: part.functionResponse.response,
        },
      };
      // Apply output limits to the passthrough case as well
      return [limitFunctionResponsePart(passthroughPart, toolName, config)];
    }
    // Ignore other part types (e.g., functionCall)
  }

  // Build the primary response part
  const part: Part = {
    functionResponse: {
      id: callId,
      name: toolName,
      response: textParts.length > 0 ? { output: textParts.join('\n') } : {},
    },
  };

  // Handle binary content - use sibling format for all providers
  const siblingParts: Part[] = [...fileDataParts, ...inlineDataParts];

  // Add descriptive text if response object is empty but we have binary content
  if (
    textParts.length === 0 &&
    (inlineDataParts.length > 0 || fileDataParts.length > 0)
  ) {
    const totalBinaryItems = inlineDataParts.length + fileDataParts.length;
    part.functionResponse!.response = {
      output: `Binary content provided (${totalBinaryItems} item(s)).`,
    };
  }

  // Apply output limits to the functionResponse
  const limitedPart = limitFunctionResponsePart(part, toolName, config);

  if (siblingParts.length > 0) {
    return [limitedPart, ...siblingParts];
  }

  return [limitedPart];
}

export function extractAgentIdFromMetadata(
  metadata: Record<string, unknown> | undefined,
): string | undefined {
  if (!metadata) {
    return undefined;
  }
  const candidate = metadata['agentId'];
  if (typeof candidate === 'string' && candidate.trim().length > 0) {
    return candidate;
  }
  return undefined;
}

export const createErrorResponse = (
  request: ToolCallRequestInfo,
  error: Error,
  errorType: ToolErrorType | undefined,
): ToolCallResponseInfo => ({
  callId: request.callId,
  error,
  responseParts: [
    // Only functionResponse — the functionCall is already recorded in history
    // from the model's assistant message. Re-emitting it here would create
    // orphan tool_use blocks for Anthropic (Issue #244).
    {
      functionResponse: {
        id: request.callId,
        name: request.name,
        response: { error: error.message },
      },
    },
  ],
  resultDisplay: error.message,
  errorType,
  agentId: request.agentId ?? DEFAULT_AGENT_ID,
});
