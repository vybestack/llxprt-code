/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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
import type {
  ContentBlock,
  TextBlock,
  ToolCallBlock,
  ToolResponseBlock,
  MediaBlock,
} from '../services/history/IContent.js';
import { DebugLogger } from '../debug/index.js';

/**
 * Canonical outcome of a model response, derived from its blocks.
 * Single source of truth for whether a response produced visible text,
 * thinking content, tool calls, or any actionable output.
 */
export interface ResponseOutcome {
  hasVisibleText: boolean;
  hasThinking: boolean;
  hasToolCalls: boolean;
  isActionable: boolean;
}

/**
 * Analyze response blocks to determine the canonical outcome.
 * This is the single authoritative function for detecting visible text,
 * thinking content, and tool calls — eliminating ad-hoc duplication
 * across StreamProcessor, turn.ts, MessageConverter, and client.ts.
 */
export function analyzeResponseOutcome(
  blocks: ContentBlock[],
): ResponseOutcome {
  let hasVisibleText = false;
  let hasThinking = false;
  let hasToolCalls = false;

  for (const block of blocks) {
    if (block.type === 'thinking') {
      hasThinking = true;
    } else if (block.type === 'tool_call') {
      hasToolCalls = true;
    } else if (block.type === 'text' && block.text.trim() !== '') {
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

const toolSchedulerLogger = new DebugLogger('llxprt:core:tool-scheduler');

/**
 * Concatenate TextBlock text, filtering out thinking blocks.
 * Returns undefined when no non-empty text blocks exist.
 */
export function getResponseTextFromBlocks(
  blocks: ContentBlock[],
): string | undefined {
  const textSegments = blocks
    .filter((block): block is TextBlock => block.type === 'text')
    .map((block) => block.text)
    .filter((text) => text.trim() !== '');

  if (textSegments.length === 0) {
    return undefined;
  }
  return textSegments.join('');
}

/**
 * Extract tool-call blocks from content blocks.
 */
export function getToolCallBlocks(blocks: ContentBlock[]): ToolCallBlock[] {
  return blocks.filter(
    (block): block is ToolCallBlock => block.type === 'tool_call',
  );
}

/**
 * Extract tool-call blocks from content blocks and return as JSON string.
 */
function serializeToolCallBlocksAsJson(blocks: ToolCallBlock[]): string {
  return JSON.stringify(
    blocks.map((b) => ({
      id: b.id,
      name: b.name,
      args: b.parameters,
    })),
    null,
    2,
  );
}

export function getToolCallBlocksAsJson(blocks: ContentBlock[]): string {
  return serializeToolCallBlocksAsJson(getToolCallBlocks(blocks));
}

/**
 * Return a structured response string combining text and tool-call JSON.
 */
export function getStructuredResponseFromBlocks(
  blocks: ContentBlock[],
): string | undefined {
  const textContent = getResponseTextFromBlocks(blocks);
  const toolCallBlocks = getToolCallBlocks(blocks);

  if (textContent && toolCallBlocks.length > 0) {
    return `${textContent}\n${serializeToolCallBlocksAsJson(toolCallBlocks)}`;
  }
  if (textContent) {
    return textContent;
  }
  if (toolCallBlocks.length > 0) {
    return serializeToolCallBlocksAsJson(toolCallBlocks);
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

/**
 * Creates a ToolResponseBlock with the given callId, toolName, and output string.
 * The result payload uses { output: string } shape, matching the legacy
 * functionResponse.response shape so ContentConverters produces byte-identical
 * provider payloads.
 */
export function createToolResponseBlock(
  callId: string,
  toolName: string,
  output: string,
): ToolResponseBlock {
  return {
    type: 'tool_response',
    callId,
    toolName,
    result: { output },
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

/**
 * Applies output limiting to a ToolResponseBlock's result.output field.
 * Returns a new block if modified; returns the original block unchanged otherwise.
 */
export function limitToolResponseBlock(
  block: ToolResponseBlock,
  toolName: string,
  config?: ToolOutputSettingsProvider,
): ToolResponseBlock {
  if (!config) {
    return block;
  }
  const result = block.result;
  if (result == null || typeof result !== 'object') {
    return block;
  }
  const existingOutput = (result as Record<string, unknown>)['output'];
  if (typeof existingOutput !== 'string') {
    return block;
  }
  const limitedOutput = limitStringOutput(existingOutput, toolName, config);
  if (limitedOutput === existingOutput) {
    return block;
  }
  return {
    ...block,
    result: {
      ...(result as Record<string, unknown>),
      output: limitedOutput,
    },
  };
}

/**
 * Structural shape for legacy PartListUnion input. Operates on `unknown` with
 * structural checks — no @google/genai import needed.
 */
interface LegacyPartLike {
  text?: string;
  thought?: unknown;
  functionCall?: { id?: string; name?: string; args?: unknown } | undefined;
  functionResponse?:
    | { id?: string; name?: string; response?: unknown }
    | undefined;
  inlineData?: { mimeType?: string; data?: string } | undefined;
  fileData?: { fileUri?: string; mimeType?: string } | undefined;
}

function isLegacyPartLike(value: unknown): value is LegacyPartLike {
  return typeof value === 'object' && value !== null;
}
const CONTENT_BLOCK_TYPES = new Set<ContentBlock['type']>([
  'text',
  'thinking',
  'tool_call',
  'tool_response',
  'media',
  'code',
]);

function isContentBlock(value: unknown): value is ContentBlock {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }
  return CONTENT_BLOCK_TYPES.has(value.type as ContentBlock['type']);
}

function toBlocksFromLegacyParts(input: unknown): ContentBlock[] {
  const entries = (Array.isArray(input) ? input : [input]) as unknown[];
  const blocks: ContentBlock[] = [];

  for (const entry of entries) {
    if (typeof entry === 'string') {
      blocks.push({ type: 'text', text: entry });
    } else if (isContentBlock(entry)) {
      blocks.push(entry);
    } else if (
      entry !== null &&
      entry !== undefined &&
      isLegacyPartLike(entry)
    ) {
      blocks.push(...legacyPartToBlocks(entry));
    }
  }

  return blocks;
}

function legacyPartToBlocks(part: LegacyPartLike): ContentBlock[] {
  if ('thought' in part && part.thought === true) {
    return [
      {
        type: 'thinking',
        thought: part.text ?? '',
        isHidden: true,
        sourceField: 'thought',
      },
    ];
  }

  if ('text' in part && typeof part.text === 'string') {
    return [{ type: 'text', text: part.text }];
  }

  if (part.functionCall) {
    return [
      {
        type: 'tool_call',
        id: part.functionCall.id ?? '',
        name: part.functionCall.name ?? '',
        parameters: part.functionCall.args ?? {},
      },
    ];
  }

  if (part.functionResponse) {
    return [
      {
        type: 'tool_response',
        callId: part.functionResponse.id ?? '',
        toolName: part.functionResponse.name ?? '',
        result: part.functionResponse.response ?? {},
      },
    ];
  }

  if (part.inlineData) {
    return [
      {
        type: 'media',
        mimeType: part.inlineData.mimeType ?? '',
        data: part.inlineData.data ?? '',
        encoding: 'base64',
      },
    ];
  }

  if (part.fileData) {
    return [
      {
        type: 'media',
        mimeType: part.fileData.mimeType ?? 'application/octet-stream',
        data: part.fileData.fileUri ?? '',
        encoding: 'url',
      },
    ];
  }

  return [];
}

/**
 * Converts a legacy PartListUnion-shaped input (typed as `unknown` with
 * structural checks) to ContentBlock[]. Replaces the old `toParts` function.
 */
export function legacyPartsToBlocks(input: unknown): ContentBlock[] {
  return toBlocksFromLegacyParts(input);
}

/**
 * Converts a legacy PartListUnion-shaped input to tool-response ContentBlocks.
 *
 * Preserves ALL current behaviors:
 * - string → single tool_response block with limited output
 * - text parts → joined into single tool_response block
 * - functionResponse passthrough → single tool_response block preserving the
 *   existing response payload, with output limiting applied
 * - inlineData/fileData → sibling MediaBlocks after the tool_response block
 * - empty+binary → "Binary content provided (N item(s))." message
 * - output limiting via limitOutputTokens applied identically
 */
export function convertToFunctionResponse(
  toolName: string,
  callId: string,
  llmContent: unknown,
  config?: ToolOutputSettingsProvider,
): ContentBlock[] {
  if (typeof llmContent === 'string') {
    const limitedOutput = limitStringOutput(llmContent, toolName, config);
    return [createToolResponseBlock(callId, toolName, limitedOutput)];
  }

  const blocks = toBlocksFromLegacyParts(llmContent);

  const textParts: string[] = [];
  const mediaBlocks: MediaBlock[] = [];

  for (const block of blocks) {
    if (block.type === 'text') {
      textParts.push(block.text);
    } else if (block.type === 'media') {
      mediaBlocks.push(block);
    } else if (block.type === 'tool_response') {
      if (blocks.length > 1) {
        toolSchedulerLogger.warn(
          'convertToFunctionResponse received multiple blocks with a tool_response. ' +
            'Only the tool_response will be used, other blocks will be ignored',
        );
      }
      const passthroughBlock: ToolResponseBlock = {
        type: 'tool_response',
        callId,
        toolName,
        result: block.result,
      };
      return [limitToolResponseBlock(passthroughBlock, toolName, config)];
    }
  }

  const primaryBlock: ToolResponseBlock = {
    type: 'tool_response',
    callId,
    toolName,
    result: textParts.length > 0 ? { output: textParts.join('\n') } : {},
  };

  if (textParts.length === 0 && mediaBlocks.length > 0) {
    primaryBlock.result = {
      output: `Binary content provided (${mediaBlocks.length} item(s)).`,
    };
  }

  const limitedBlock = limitToolResponseBlock(primaryBlock, toolName, config);

  if (mediaBlocks.length > 0) {
    return [limitedBlock, ...mediaBlocks];
  }

  return [limitedBlock];
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
    {
      type: 'tool_response',
      callId: request.callId,
      toolName: request.name,
      result: { error: error.message },
    },
  ],
  resultDisplay: error.message,
  errorType,
  agentId: request.agentId ?? DEFAULT_AGENT_ID,
});
