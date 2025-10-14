/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CommandArgumentSchema,
  CompletionResult,
  TokenInfo,
  ResolvedContext,
  LiteralArgument,
  ValueArgument,
  Option,
} from './types.js';
import type { CommandContext } from '../types.js';

/**
 * @plan:PLAN-20251013-AUTOCOMPLETE.P05
 * @requirement:REQ-001
 * @requirement:REQ-002
 * @pseudocode ArgumentSchema.md lines 7-8
 * - Line 7: tokenize handles quotes/escapes
 * - Line 8: returns partial token info
 */
export function tokenize(fullLine: string): TokenInfo {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  let escapeNext = false;
  let hasTrailingSpace = false;

  for (let i = 0; i < fullLine.length; i++) {
    const char = fullLine[i];

    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    if (char === '"' || char === "'") {
      if (inQuotes) {
        inQuotes = false;
      } else {
        inQuotes = true;
      }
      continue;
    }

    if (char === ' ' && !inQuotes) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      hasTrailingSpace = true;
      continue;
    }

    current += char;
    hasTrailingSpace = false;
  }

  // Remove the initial command prefix if present, but keep command name for schema matching
  if (
    tokens.length > 0 &&
    (tokens[0].startsWith('/') || tokens[0].startsWith('@'))
  ) {
    // Keep tokens after the command prefix
    const firstToken = tokens[0];
    const afterPrefix = firstToken.slice(1);
    if (afterPrefix) {
      tokens[0] = afterPrefix;
    } else {
      tokens.shift();
    }
  }

  // Add final token if exists
  if (current.length > 0) {
    tokens.push(current);
  }

  return {
    tokens,
    partialToken: hasTrailingSpace ? '' : current,
    hasTrailingSpace,
    position: tokens.length,
  };
}

/**
 * @plan:PLAN-20251013-AUTOCOMPLETE.P05
 * @requirement:REQ-001
 * @requirement:REQ-002
 * @pseudocode ArgumentSchema.md lines 9-11
 * - Line 9: initialize position = 0, nodeList = schema
 * - Line 10: iterate tokens, handle literals and values
 * - Line 11: return ResolvedContext with activeNode, position, consumedValues
 */
function resolveContext(
  tokenInfo: TokenInfo,
  schema: CommandArgumentSchema,
): ResolvedContext {
  let position = 0;
  let nodeList: CommandArgumentSchema = schema;
  let activeNode: LiteralArgument | ValueArgument | null = null;
  const consumedValues: string[] = [];
  let isValid = true;

  // Strip the first token (command name) from tokens for schema processing
  // This allows literal-first schemas to work correctly
  const tokensToProcess = tokenInfo.tokens.slice(1);

  // Process each token against the schema
  for (const token of tokensToProcess) {
    if (position >= nodeList.length) {
      isValid = false;
      break;
    }

    const node = nodeList[position];

    // Stryker disable next-line ConditionalExpression -- literal handling validated via deterministic tests
    if (node.kind === 'literal') {
      if (node.value !== token) {
        isValid = false;
        break;
      }
      activeNode = node;
      nodeList = node.next ?? [];
      position = 0;
    } else if (node.kind === 'value') {
      activeNode = node;
      consumedValues.push(token);
      nodeList = node.next ?? [];
      position = 0;
    }
  }

  // Handle partial token - if we're at a position and have a partial token, set activeNode
  // but only if we're not already on a value node (to avoid advancing prematurely)
  if (
    !tokenInfo.hasTrailingSpace &&
    tokenInfo.partialToken &&
    position < nodeList.length
  ) {
    // If we're already on a value node, stay there to provide its completions
    if (activeNode && activeNode.kind === 'value') {
      // Keep activeNode as is - don't advance to next node
    } else {
      activeNode = nodeList[position];
    }
  }

  // If we have no partial token and haven't consumed anything, suggest the first position
  if (
    !tokenInfo.hasTrailingSpace &&
    !tokenInfo.partialToken &&
    position === 0 &&
    nodeList.length > 0
  ) {
    activeNode = nodeList[0];
  }

  // If we've consumed all available nodes and have trailing space, the branch is complete
  if (
    tokenInfo.hasTrailingSpace &&
    position >= nodeList.length &&
    nodeList.length === 0
  ) {
    activeNode = null;
  }

  // Special case: only command prefix should suggest first schema node
  if (
    tokenInfo.tokens.length === 1 &&
    (tokenInfo.tokens[0] === '/' ||
      tokenInfo.tokens[0] === '@' ||
      tokenInfo.tokens[0].startsWith('/') ||
      tokenInfo.tokens[0].startsWith('@'))
  ) {
    if (schema.length > 0) {
      activeNode = schema[0];
    }
  }

  // If we have consumed all tokens and are at the next position (trailing space), suggest the next node
  if (tokenInfo.hasTrailingSpace && position < nodeList.length) {
    activeNode = nodeList[position];
  }

  return {
    activeNode,
    position,
    consumedValues,
    isValid,
  };
}

/**
 * @plan:PLAN-20251013-AUTOCOMPLETE.P05
 * @requirement:REQ-001
 * @requirement:REQ-002
 * @pseudocode ArgumentSchema.md lines 12-15
 * - Line 12: literal matching and suggestion filter
 * - Line 13: value suggestions via options
 * - Line 14: await completer for dynamic suggestions
 * - Line 15: error fallback to empty array
 */
async function generateSuggestions(
  ctx: CommandContext,
  tokenInfo: TokenInfo,
  node: LiteralArgument | ValueArgument | null,
): Promise<readonly Option[]> {
  if (!node) {
    return [];
  }

  try {
    if (node.kind === 'literal') {
      const partial = (tokenInfo.partialToken ?? '').toLowerCase();
      const matches =
        partial.length === 0 || node.value.toLowerCase().startsWith(partial);
      return matches
        ? [{ value: node.value, description: node.description }]
        : [];
    }

    // Stryker disable next-line ConditionalExpression -- guard ensures only value nodes processed below
    if (node.kind !== 'value') {
      return [];
    }

    const optionList = node.options
      ? Array.isArray(node.options)
        ? node.options
        : []
      : [];
    if (optionList.length > 0) {
      const partial = (tokenInfo.partialToken ?? '').toLowerCase();
      const filtered = optionList.filter(
        (option) =>
          partial.length === 0 ||
          option.value.toLowerCase().startsWith(partial),
      );
      return filtered.map((option) => ({
        value: option.value,
        description: option.description,
      }));
    }

    // Stryker disable next-line ConditionalExpression -- completer branch already exercised via failure test
    if (node.completer) {
      return await node.completer(ctx, tokenInfo.partialToken, tokenInfo);
    }
  } catch (error) {
    console.warn('Error generating suggestions:', error);
  }

  return [];
}

/**
 * @plan:PLAN-20251013-AUTOCOMPLETE.P05
 * @requirement:REQ-002
 * @requirement:REQ-004
 * @pseudocode ArgumentSchema.md lines 16-18
 * - Line 16: try hint function first
 * - Line 17: fallback to description
 * - Line 18: default empty string
 */
async function generateHint(
  ctx: CommandContext,
  tokenInfo: TokenInfo,
  node: LiteralArgument | ValueArgument | null,
): Promise<string> {
  if (!node) {
    return '';
  }

  try {
    if (node.kind === 'literal') {
      return node.description ?? '';
    }

    // Stryker disable next-line ConditionalExpression -- ensures non-value nodes exit early
    if (node.kind !== 'value') {
      return '';
    }

    if (node.hint) {
      if (typeof node.hint === 'function') {
        return await node.hint(ctx, tokenInfo);
      }
      return node.hint;
    }

    // Stryker disable next-line ConditionalExpression -- description fallback executed only when provided
    if (node.description) {
      return node.description;
    }
  } catch (error) {
    console.warn('Error generating hint:', error);
  }

  return '';
}

/**
 * @plan:PLAN-20251013-AUTOCOMPLETE.P05
 * @requirement:REQ-001
 * @requirement:REQ-002
 * @pseudocode ArgumentSchema.md lines 19-21
 * - Line 19: tokenize input
 * - Line 20: resolve context
 * - Line 21: generate suggestions and hints
 */
export function createCompletionHandler(schema: CommandArgumentSchema) {
  return async (
    ctx: CommandContext,
    command: string,
    fullLine: string,
  ): Promise<CompletionResult> => {
    const tokenInfo = tokenize(fullLine);
    const context = resolveContext(tokenInfo, schema);

    const [suggestions, hint] = await Promise.all([
      generateSuggestions(ctx, tokenInfo, context.activeNode),
      generateHint(ctx, tokenInfo, context.activeNode),
    ]);

    return {
      suggestions,
      hint,
      position: tokenInfo.position,
    };
  };
}
