/**
 * Utility functions for handling reasoning/thinking content across providers.
 *
 * @plan PLAN-20251202-THINKING.P06
 * @requirement REQ-THINK-002
 */

import type {
  IContent,
  ThinkingBlock,
  ToolCallBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { processToolParameters } from '@vybestack/llxprt-code-tools/doubleEscapeUtils.js';
import { normalizeToHistoryToolId } from '@vybestack/llxprt-code-tools/toolIdNormalization.js';
import { normalizeToolName } from '../utils/toolNameNormalization.js';
import { sanitizeProviderText } from '../utils/textSanitizer.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';

const logger = new DebugLogger('llxprt:provider:reasoning');

/** Policy for stripping thinking blocks from context */
export type StripPolicy = 'all' | 'allButLast' | 'none';

/**
 * Extract all ThinkingBlock instances from an IContent.
 *
 * @plan PLAN-20251202-THINKING.P08
 * @requirement REQ-THINK-002.1
 */
export function extractThinkingBlocks(content: IContent): ThinkingBlock[] {
  const result: ThinkingBlock[] = [];
  for (const block of content.blocks) {
    if (block.type === 'thinking') {
      result.push(block);
    }
  }
  return result;
}

/**
 * Filter thinking blocks from contents based on strip policy.
 *
 * @plan PLAN-20251202-THINKING.P08
 * @requirement REQ-THINK-002.2
 */
export function filterThinkingForContext(
  contents: IContent[],
  policy: StripPolicy,
): IContent[] {
  if (policy === 'none') {
    return contents;
  }

  if (policy === 'all') {
    return contents.map(removeThinkingFromContent);
  }

  // policy === 'allButLast'
  // Find the last content that has thinking blocks
  let lastWithThinkingIndex = -1;
  for (let i = contents.length - 1; i >= 0; i--) {
    if (contents[i].blocks.some((b) => b.type === 'thinking')) {
      lastWithThinkingIndex = i;
      break;
    }
  }

  if (lastWithThinkingIndex === -1) {
    // No content has thinking blocks
    return contents;
  }

  return contents.map((content, index) => {
    if (index === lastWithThinkingIndex) {
      return content; // Keep thinking in the last one
    }
    return removeThinkingFromContent(content);
  });
}

/**
 * Convert ThinkingBlocks to a single reasoning_content string.
 *
 * @plan PLAN-20251202-THINKING.P08
 * @requirement REQ-THINK-002.3
 */
export function thinkingToReasoningField(
  blocks: ThinkingBlock[],
): string | undefined {
  if (blocks.length === 0) {
    return undefined;
  }
  return blocks.map((b) => b.thought).join('\n');
}

/**
 * Estimate token count for thinking blocks.
 *
 * @plan PLAN-20251202-THINKING.P08
 * @requirement REQ-THINK-002.4
 */
export function estimateThinkingTokens(blocks: ThinkingBlock[]): number {
  let total = 0;
  for (const block of blocks) {
    // Simple estimation: ~4 characters per token
    total += Math.ceil(block.thought.length / 4);
  }
  return total;
}

/**
 * Helper: Remove thinking blocks from a single IContent.
 *
 * @plan PLAN-20251202-THINKING.P08
 */
export function removeThinkingFromContent(content: IContent): IContent {
  return {
    ...content,
    blocks: content.blocks.filter((block) => block.type !== 'thinking'),
  };
}

/**
 * Extract and remove Kimi K2 tool call special tokens from text.
 * Handles both complete tool call sections and stray/malformed tokens.
 *
 * @param raw - Raw text that may contain Kimi K2 tool call tokens
 * @returns Object with cleanedText (tokens removed) and extracted toolCalls array
 *
 * @issue #722
 * @plan PLAN-20251202-THINKING.P06
 */
export function extractKimiToolCallsFromText(raw: string): {
  cleanedText: string;
  toolCalls: ToolCallBlock[];
} {
  // Return early only if input is null/undefined/empty
  if (!raw) {
    return { cleanedText: raw, toolCalls: [] };
  }

  const toolCalls: ToolCallBlock[] = [];
  let text = raw;

  // Extract tool calls from complete sections if present without regex backtracking.
  if (raw.includes('<|tool_calls_section_begin|>')) {
    const sectionBeginToken = '<|tool_calls_section_begin|>';
    const sectionEndToken = '<|tool_calls_section_end|>';
    const cleanedParts: string[] = [];
    let cursor = 0;

    let shouldContinue = true;
    while (shouldContinue && cursor < text.length) {
      const section = findNextKimiToolCallSection(
        text,
        cursor,
        sectionBeginToken,
        sectionEndToken,
      );
      if (section == null) {
        cleanedParts.push(text.slice(cursor));
        shouldContinue = false;
      } else {
        cleanedParts.push(text.slice(cursor, section.sectionBegin));
        extractKimiToolCallsFromSection(section.sectionBody, toolCalls);
        cursor = section.nextCursor;
      }
    }

    text = cleanedParts.join('');
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
 * Simple wrapper that just returns cleaned text without extracting tool calls.
 *
 * @param thought - Thinking content that may contain Kimi K2 tool call tokens
 * @returns Cleaned text with all K2 tool tokens removed
 *
 * @issue #722
 * @plan PLAN-20251202-THINKING.P06
 */
export function cleanKimiTokensFromThinking(thought: string): string {
  return extractKimiToolCallsFromText(thought).cleanedText;
}

// normalizeToolName is imported from ../utils/toolNameNormalization.js
// sanitizeProviderText is imported from ../utils/textSanitizer.js
// normalizeToHistoryToolId is imported from the core-owned tool ID utility.

/**
 * Helper: Sanitize raw tool argument payloads before JSON parsing.
 * Removes thinking blocks, markdown code fences, and prose wrappers.
 *
 * @internal
 */
function sanitizeToolArgumentsString(raw: unknown): string {
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

  // Remove provider reasoning / thinking markup
  text = sanitizeProviderText(text);

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

function findNextKimiToolCallSection(
  text: string,
  cursor: number,
  sectionBeginToken: string,
  sectionEndToken: string,
):
  | {
      sectionBegin: number;
      sectionBody: string;
      nextCursor: number;
    }
  | undefined {
  const sectionBegin = text.indexOf(sectionBeginToken, cursor);
  if (sectionBegin === -1) {
    return undefined;
  }

  const sectionBodyBegin = sectionBegin + sectionBeginToken.length;
  const sectionEnd = text.indexOf(sectionEndToken, sectionBodyBegin);
  if (sectionEnd === -1) {
    return undefined;
  }

  return {
    sectionBegin,
    sectionBody: text.slice(sectionBodyBegin, sectionEnd),
    nextCursor: sectionEnd + sectionEndToken.length,
  };
}

function extractKimiToolCallsFromSection(
  sectionBody: string,
  toolCalls: ToolCallBlock[],
): void {
  const callBeginToken = '<|tool_call_begin|>';
  const argumentBeginToken = '<|tool_call_argument_begin|>';
  const callEndToken = '<|tool_call_end|>';
  let cursor = 0;

  try {
    while (cursor < sectionBody.length) {
      const callBegin = sectionBody.indexOf(callBeginToken, cursor);
      if (callBegin === -1) {
        return;
      }

      const rawIdBegin = callBegin + callBeginToken.length;
      const argumentBegin = sectionBody.indexOf(argumentBeginToken, rawIdBegin);
      if (argumentBegin === -1) {
        return;
      }

      const rawArgsBegin = argumentBegin + argumentBeginToken.length;
      const callEnd = sectionBody.indexOf(callEndToken, rawArgsBegin);
      if (callEnd === -1) {
        return;
      }

      const rawId = sectionBody.slice(rawIdBegin, argumentBegin).trim();
      const rawArgs = sectionBody.slice(rawArgsBegin, callEnd).trim();
      const toolName = inferToolNameFromId(rawId);
      const normalizedToolName = normalizeToolName(toolName);
      const sanitizedArgs = sanitizeToolArgumentsString(rawArgs);
      const processedParameters = processToolParameters(
        sanitizedArgs,
        normalizedToolName,
      );

      toolCalls.push({
        type: 'tool_call',
        id: normalizeToHistoryToolId(rawId),
        name: normalizedToolName,
        parameters: processedParameters,
      } as ToolCallBlock);
      cursor = callEnd + callEndToken.length;
    }
  } catch (err) {
    logger.debug(
      () =>
        `Failed to parse K2 tool section: ${err instanceof Error ? err.message : String(err)}`,
      { sectionPreview: sectionBody.substring(0, 200) },
    );
  }
}

/**
 * Infer tool name from a raw tool ID string.
 * Handles various formats including functions.X:N, X.Y:N, etc.
 */
function inferToolNameFromId(rawId: string): string {
  const match =
    // eslint-disable-next-line sonarjs/regular-expr -- Static regex reviewed for lint hardening; behavior preserved.
    /^functions\.([A-Za-z0-9_]+):\d+/i.exec(rawId) ??
    // eslint-disable-next-line sonarjs/regular-expr -- Static regex reviewed for lint hardening; behavior preserved.
    /^[A-Za-z0-9_]+\.([A-Za-z0-9_]+):\d+/.exec(rawId);
  if (match) {
    return match[1];
  }
  const colonParts = rawId.split(':');
  const head = colonParts[0] || rawId;
  const dotParts = head.split('.');
  return dotParts[dotParts.length - 1] || head;
}
