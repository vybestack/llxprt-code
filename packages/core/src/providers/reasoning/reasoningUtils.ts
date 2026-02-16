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
} from '../../services/history/IContent.js';
import { processToolParameters } from '../../tools/doubleEscapeUtils.js';
import { normalizeToHistoryToolId } from '../utils/toolIdNormalization.js';
import { normalizeToolName } from '../utils/toolNameNormalization.js';
import { sanitizeProviderText } from '../utils/textSanitizer.js';
import { DebugLogger } from '../../debug/DebugLogger.js';

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
      result.push(block as ThinkingBlock);
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

  // Extract tool calls from complete sections if present
  if (raw.includes('<|tool_calls_section_begin|>')) {
    const sectionRegex =
      /<\|tool_calls_section_begin\|>([\s\S]*?)<\|tool_calls_section_end\|>/g;

    text = text.replace(
      sectionRegex,
      (_sectionMatch: string, sectionBody: string) => {
        try {
          const callRegex =
            /<\|tool_call_begin\|>\s*([^<]+?)\s*<\|tool_call_argument_begin\|>\s*([\s\S]*?)\s*<\|tool_call_end\|>/g;

          let m: RegExpExecArray | null;
          while ((m = callRegex.exec(sectionBody)) !== null) {
            const rawId = m[1].trim();
            const rawArgs = m[2].trim();

            // Infer tool name from ID.
            let toolName = '';
            const match =
              /^functions\.([A-Za-z0-9_]+):\d+/i.exec(rawId) ||
              /^[A-Za-z0-9_]+\.([A-Za-z0-9_]+):\d+/.exec(rawId);
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

            const sanitizedArgs = sanitizeToolArgumentsString(rawArgs);
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
          // Log malformed tool sections for debugging, then skip
          logger.debug(
            () =>
              `Failed to parse K2 tool section: ${err instanceof Error ? err.message : String(err)}`,
            { sectionPreview: sectionBody.substring(0, 200) },
          );
        }

        // Strip the entire tool section from user-visible text
        return '';
      },
    );
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
// normalizeToHistoryToolId is imported from ../utils/toolIdNormalization.js

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

  return text.length ? text : '{}';
}
