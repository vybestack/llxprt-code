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

import type OpenAI from 'openai';
import type { DebugLogger } from '../../debug/index.js';
import type {
  ToolCallBlock,
  ThinkingBlock,
} from '../../services/history/IContent.js';
import { sanitizeProviderText } from '../utils/textSanitizer.js';
import { normalizeToolName } from '../utils/toolNameNormalization.js';
import { normalizeToHistoryToolId } from '../utils/toolIdNormalization.js';
import { processToolParameters } from '../../tools/doubleEscapeUtils.js';

/**
 * Coerce provider "content" (which may be a string or an array-of-parts)
 * into a plain string. Defensive for OpenAI-compatible providers that emit
 * structured content blocks.
 */
export function coerceMessageContentToString(
  content: unknown,
): string | undefined {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (
        // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        part === undefined ||
        part === null ||
        part === false ||
        part === 0 ||
        part === '' ||
        (typeof part === 'number' && Number.isNaN(part))
      ) {
        continue;
      }
      if (typeof part === 'string') {
        parts.push(part);
      } else if (
        typeof part === 'object' &&
        part !== null &&
        'text' in part &&
        typeof (part as { text?: unknown }).text === 'string'
      ) {
        parts.push((part as { text: string }).text);
      }
    }
    return parts.length > 0 ? parts.join('') : undefined;
  }
  return undefined;
}

/**
 * Sanitize raw tool argument payloads before JSON parsing:
 * - Remove thinking blocks (<think>...</think>, etc.).
 * - Strip Markdown code fences (```json ... ```).
 * - Try to isolate the main JSON object if wrapped in prose.
 */
export function sanitizeToolArgumentsString(
  raw: unknown,
  logger: DebugLogger,
): string {
  if (raw === null || raw === undefined) {
    return '{}';
  }

  let text: string;
  if (typeof raw === 'string') {
    text = raw;
  } else {
    try {
      text = JSON.stringify(raw);
    } catch {
      text = String(raw);
    }
  }

  text = text.trim();

  // Strip fenced code blocks like ```json { ... } ```.
  if (text.startsWith('```')) {
    // eslint-disable-next-line sonarjs/regular-expr -- Static regex reviewed for lint hardening; behavior preserved.
    text = text.replace(/^```[a-zA-Z0-9_-]*\s*/m, '');
    text = text.replace(/```$/m, '');
    text = text.trim();
  }

  // Remove provider reasoning / thinking markup.
  text = sanitizeProviderText(text, logger);

  // If provider wrapped JSON in explanation text, try to isolate the object.
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const candidate = text.slice(firstBrace, lastBrace + 1).trim();
    if (candidate.startsWith('{') && candidate.endsWith('}')) {
      return candidate;
    }
  }

  return text.length > 0 ? text : '{}';
}

/**
 * Parse Kimi-K2 `<|tool_calls_section_begin|> ... <|tool_calls_section_end|>`
 * blocks out of a text string.
 *
 * - Returns cleanedText with the whole section removed.
 * - Returns ToolCallBlock[] constructed from the section contents.
 *
 * This is used for HF/vLLM-style Kimi deployments where `tool_calls` is empty
 * and all tool info is only encoded in the text template.
 */
export function extractKimiToolCallsFromText(
  raw: string,
  logger: DebugLogger,
): {
  cleanedText: string;
  toolCalls: ToolCallBlock[];
} {
  // Return early only if input is null/undefined/empty
  if (!raw) {
    return { cleanedText: raw, toolCalls: [] };
  }

  const toolCalls: ToolCallBlock[] = [];
  let text = raw;

  // Extract tool calls from complete sections if present
  if (raw.includes('<|tool_calls_section_begin|>')) {
    const sectionRegex =
      /<\|tool_calls_section_begin\|>([\s\S]*?)<\|tool_calls_section_end\|>/g;

    text = text.replace(
      sectionRegex,
      (_sectionMatch: string, sectionBody: string) => {
        try {
          const callRegex =
            // eslint-disable-next-line sonarjs/regular-expr, sonarjs/slow-regex -- Static regex reviewed for lint hardening; bounded inputs preserve behavior.
            /<\|tool_call_begin\|>\s*([^<]+?)\s*<\|tool_call_argument_begin\|>\s*([\s\S]*?)\s*<\|tool_call_end\|>/g;

          let m: RegExpExecArray | null;
          while ((m = callRegex.exec(sectionBody)) !== null) {
            const rawId = m[1].trim();
            const rawArgs = m[2].trim();

            // Infer tool name from ID.
            let toolName = '';
            const match =
              // eslint-disable-next-line sonarjs/regular-expr -- Static regex reviewed for lint hardening; behavior preserved.
              /^functions\.([A-Za-z0-9_]+):\d+/i.exec(rawId) ??
              // eslint-disable-next-line sonarjs/regular-expr -- Static regex reviewed for lint hardening; behavior preserved.
              /^[A-Za-z0-9_]+\.([A-Za-z0-9_]+):\d+/.exec(rawId);
            // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
            if (match) {
              toolName = match[1];
            } else {
              const colonParts = rawId.split(':');
              const head = colonParts[0] || rawId;
              const dotParts = head.split('.');
              toolName = dotParts[dotParts.length - 1] || head;
            }

            // Normalize tool name (handles Kimi-K2 style prefixes like call_functionsglob7)
            toolName = normalizeToolName(toolName);

            const sanitizedArgs = sanitizeToolArgumentsString(rawArgs, logger);
            const processedParameters = processToolParameters(
              sanitizedArgs,
              toolName,
            );

            toolCalls.push({
              type: 'tool_call',
              id: normalizeToHistoryToolId(rawId),
              name: toolName,
              parameters: processedParameters,
            } as ToolCallBlock);
          }
        } catch (err) {
          logger.debug(
            () =>
              `[extractKimiToolCallsFromText] Failed to parse Kimi tool_calls_section: ${err}`,
          );
        }

        // Strip the entire tool section from user-visible text
        return '';
      },
    );

    if (toolCalls.length > 0) {
      logger.debug(
        () => `[extractKimiToolCallsFromText] Parsed Kimi tool_calls_section`,
        {
          toolCallCount: toolCalls.length,
          originalLength: raw.length,
          cleanedLength: text.length,
        },
      );
    }
  }

  // ALWAYS run stray token cleanup, even if no complete sections were found
  // This handles partial sections, malformed tokens, orphaned markers, etc.
  text = text.replace(/<\|tool_call(?:_(?:begin|end|argument_begin))?\|>/g, '');
  text = text.replace(/<\|tool_calls_section_(?:begin|end)\|>/g, '');

  // Don't trim - preserve leading/trailing newlines that are important for formatting
  // (e.g., numbered lists from Kimi K2 that have newlines between items)
  return { cleanedText: text, toolCalls };
}

/**
 * Clean Kimi K2 tool call tokens from thinking content.
 * Used when extracting thinking from <think> tags that may contain embedded tool calls.
 * @issue #749
 */
export function cleanThinkingContent(
  thought: string,
  logger: DebugLogger,
): string {
  return extractKimiToolCallsFromText(thought, logger).cleanedText;
}

/**
 * Parse reasoning_content from streaming delta.
 *
 * @plan PLAN-20251202-THINKING.P11, PLAN-20251202-THINKING.P16
 * @requirement REQ-THINK-003.1, REQ-THINK-003.3, REQ-THINK-003.4, REQ-KIMI-REASONING-001.1
 * @issue #749
 */
export function parseStreamingReasoningDelta(
  delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta | undefined,
  logger: DebugLogger,
): { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] } {
  if (delta == null) {
    return { thinking: null, toolCalls: [] };
  }

  // Access reasoning_content via type assertion since OpenAI SDK doesn't declare it
  const reasoningContent = (delta as unknown as Record<string, unknown>)
    .reasoning_content;

  // Handle absent, null, or non-string
  if (
    reasoningContent === null ||
    reasoningContent === undefined ||
    typeof reasoningContent !== 'string'
  ) {
    return { thinking: null, toolCalls: [] };
  }

  // Handle empty string only - preserve whitespace-only content (spaces, tabs)
  // to maintain proper formatting in accumulated reasoning (fixes issue #721)
  if (reasoningContent.length === 0) {
    return { thinking: null, toolCalls: [] };
  }

  // Extract Kimi K2 tool calls embedded in reasoning_content (fixes issue #749)
  const { cleanedText, toolCalls } = extractKimiToolCallsFromText(
    reasoningContent,
    logger,
  );

  // For streaming, preserve whitespace-only content for proper formatting (issue #721)
  // Only return null if the cleaned text is empty (length 0)
  const thinkingBlock =
    cleanedText.length === 0
      ? null
      : {
          type: 'thinking' as const,
          thought: cleanedText,
          sourceField: 'reasoning_content' as const,
          isHidden: false,
        };

  return { thinking: thinkingBlock, toolCalls };
}
