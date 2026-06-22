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

import crypto from 'node:crypto';

import type { LanguageModelUsage, Tool, TypedToolCall } from 'ai';

import {
  type ToolCallBlock,
  type ThinkingBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { cleanKimiTokensFromThinking } from '../reasoning/reasoningUtils.js';
import { extractThinkTagsAsBlock } from '../utils/thinkingExtraction.js';
import { processToolParameters } from '@vybestack/llxprt-code-tools/doubleEscapeUtils.js';
import {
  normalizeToOpenAIToolId,
  normalizeToHistoryToolId,
} from '@vybestack/llxprt-code-tools/toolIdNormalization.js';

import type { ReasoningSettings } from './vercelStreamTypes.js';

type VercelTools = Record<string, Tool<unknown, never>>;

/**
 * Extracts tool call input from a call that may use different field names
 * across AI SDK versions.
 */
export function extractToolCallInput(call: {
  input?: unknown;
  args?: unknown;
  arguments?: unknown;
}): unknown {
  if (call.input !== undefined && call.input !== null) {
    return call.input;
  }
  if (call.args !== undefined && call.args !== null) {
    return call.args;
  }
  return call.arguments;
}

/**
 * Extracts thinking/reasoning content from a non-streaming generateText result.
 */
export function extractNonStreamingThinking(
  result: {
    text?: string;
    reasoning?: string | Array<{ text: string }>;
  },
  rs: ReasoningSettings,
  logger: DebugLogger,
): string {
  let thinkingContent = '';
  if (rs.enabled && rs.includeInResponse && result.text) {
    const thinkBlock = extractThinkTagsAsBlock(result.text, logger);
    if (thinkBlock) {
      thinkingContent = thinkBlock.thought;
      logger.debug(
        () =>
          `[OpenAIVercelProvider] Extracted thinking from <tool_call> tags: ${thinkingContent.length} chars`,
      );
    }
  }
  if (rs.enabled && rs.includeInResponse) {
    const reasoningField = result.reasoning;
    let reasoning = '';
    if (typeof reasoningField === 'string') {
      reasoning = reasoningField;
    } else if (Array.isArray(reasoningField)) {
      reasoning = reasoningField
        .map((r) => r.text)
        .filter(
          (text): text is string => typeof text === 'string' && text !== '',
        )
        .join(' ');
    }
    if (reasoning !== '') {
      if (thinkingContent.length > 0) thinkingContent += ' ';
      thinkingContent += reasoning;
      logger.debug(
        () =>
          `[OpenAIVercelProvider] Extracted reasoning from result field: ${reasoning.length} chars`,
      );
    }
  }
  return thinkingContent;
}

/**
 * Builds ToolCallBlock array from a non-streaming generateText result.
 */
export function buildNonStreamingToolCallBlocks(result: {
  toolCalls?: Array<TypedToolCall<VercelTools>> | null;
  usage?: LanguageModelUsage;
}): ToolCallBlock[] {
  const resultToolCalls = result.toolCalls;
  const toolCalls = resultToolCalls ?? [];
  const blocks: ToolCallBlock[] = [];
  for (const call of toolCalls) {
    const callRuntime = call as {
      toolName?: unknown;
      toolCallId?: unknown;
    };
    const toolName =
      typeof callRuntime.toolName === 'string' && callRuntime.toolName !== ''
        ? callRuntime.toolName
        : 'unknown_tool';
    const id =
      typeof callRuntime.toolCallId === 'string' &&
      callRuntime.toolCallId !== ''
        ? callRuntime.toolCallId
        : crypto.randomUUID();
    const rawInput = extractToolCallInput(call);
    let argsString = '{}';
    try {
      argsString =
        typeof rawInput === 'string'
          ? rawInput
          : JSON.stringify(rawInput ?? {});
    } catch {
      argsString = '{}';
    }
    const processedParameters = processToolParameters(argsString, toolName);
    blocks.push({
      type: 'tool_call',
      id: normalizeToHistoryToolId(normalizeToOpenAIToolId(id)),
      name: toolName,
      parameters: processedParameters,
    } as ToolCallBlock);
  }
  return blocks;
}

/**
 * Cleans thinking content and returns it as a ThinkingBlock-compatible object.
 */
export function buildThinkingBlock(
  thinkingContent: string,
  rs: ReasoningSettings,
  logger: DebugLogger,
): ThinkingBlock | undefined {
  if (thinkingContent.length > 0 && rs.enabled && rs.includeInResponse) {
    const cleanedThinking = cleanKimiTokensFromThinking(thinkingContent);
    logger.debug(
      () =>
        `[OpenAIVercelProvider] Emitted ThinkingBlock in non-streaming: ${cleanedThinking.length} chars`,
    );
    return {
      type: 'thinking',
      thought: cleanedThinking,
      sourceField: 'reasoning_content',
      isHidden: false,
    } as ThinkingBlock;
  }
  return undefined;
}
