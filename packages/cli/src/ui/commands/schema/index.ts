/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CommandArgumentSchema,
  CompletionResult,
  LiteralArgument,
  Option,
  TokenInfo,
  ValueArgument,
} from './types.js';
import type { CommandContext } from '../types.js';
import { filterCompletions } from '../../utils/fuzzyFilter.js';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import {
  normalizeCompletionContext,
  buildArgumentTokenInfo,
  resolveActiveStep,
} from './schemaHelpers.js';
import type { CompletionInput } from './schemaHelpers.js';

const logger = new DebugLogger('llxprt:ui:schema');

interface FlattenedPath {
  readonly path: readonly string[];
  readonly depth: number;
  readonly description?: string;
}

export type { CompletionInput } from './schemaHelpers.js';

async function suggestForValue(
  ctx: CommandContext,
  node: ValueArgument,
  partialArg: string,
  tokenInfo: TokenInfo,
): Promise<readonly Option[]> {
  try {
    if (node.completer) {
      const results = await node.completer(ctx, partialArg, tokenInfo);
      if (!Array.isArray(results)) {
        return [];
      }
      return results.map((option) => ({
        value: option.value,
        description: option.description,
      }));
    }

    if (node.options !== undefined && node.options.length > 0) {
      // Get the fuzzy filtering setting from context
      // Default to true if setting is not defined
      const settingValue = ctx.services.settings.merged.enableFuzzyFiltering;
      const enableFuzzy = settingValue ?? true;

      // Use filterCompletions for both fuzzy and exact prefix matching
      return filterCompletions(node.options, partialArg, { enableFuzzy });
    }
  } catch (error) {
    logger.warn(
      () =>
        `Error generating suggestions: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return [];
}

/**
 * Flatten nested schema paths into a list of multi-token paths
 * @plan:PLAN-411-DEEPCOMPLETION
 * @requirement:REQ-002
 */
function flattenValueOptions(
  nodePath: readonly string[],
  nextNode: ValueArgument,
): FlattenedPath[] {
  if (!nextNode.options) {
    return [];
  }
  return nextNode.options.map((option) => ({
    path: [...nodePath, option.value],
    depth: nodePath.length + 1,
    description: option.description,
  }));
}

function flattenSchemaPaths(
  nodes: LiteralArgument[],
  currentPath: readonly string[] = [],
): readonly FlattenedPath[] {
  const flattened: FlattenedPath[] = [];

  for (const node of nodes) {
    const nodePath = [...currentPath, node.value];

    // If this node has a 'next' that contains value arguments with options,
    // we can create deep paths
    if (node.next && node.next.length > 0) {
      collectNestedPaths(node.next, nodePath, flattened);
    }
  }

  return flattened;
}

function collectNestedPaths(
  nextNodes: CommandArgumentSchema,
  nodePath: readonly string[],
  flattened: FlattenedPath[],
): void {
  for (const nextNode of nextNodes) {
    if (nextNode.kind === 'value' && nextNode.options) {
      flattened.push(...flattenValueOptions(nodePath, nextNode));
    } else if (nextNode.kind === 'literal') {
      // Recursively flatten nested literals
      const nestedLiterals = nextNodes.filter(
        (n): n is LiteralArgument => n.kind === 'literal',
      );
      const nestedPaths = flattenSchemaPaths(nestedLiterals, nodePath);
      flattened.push(...nestedPaths);
    }
  }
}

function suggestForLiterals(
  ctx: CommandContext,
  nodes: LiteralArgument[],
  partialArg: string,
): readonly Option[] {
  // Single-level options (existing behavior)
  const singleLevelOptions = nodes.map((node) => ({
    value: node.value,
    description: node.description,
    depth: 1,
  }));

  // Get the fuzzy filtering setting from context
  // Default to true if setting is not defined
  const settingValue = ctx.services.settings.merged.enableFuzzyFiltering;
  const enableFuzzy = settingValue ?? true;

  // Filter single-level options
  const filteredSingleLevel = filterCompletions(
    singleLevelOptions,
    partialArg,
    { enableFuzzy },
  );

  // For empty queries, only return single-level options
  if (!partialArg || partialArg.trim() === '') {
    return filteredSingleLevel.map(({ value, description }) => ({
      value,
      description,
    }));
  }

  // Get deep paths and filter them
  const deepPaths = flattenSchemaPaths(nodes);
  const deepPathOptions = deepPaths.map((path) => ({
    value: path.path.join(' '),
    description: path.description,
    depth: path.depth,
  }));

  const filteredDeepPaths = filterCompletions(deepPathOptions, partialArg, {
    enableFuzzy,
  });

  // Combine and sort by depth (shorter first)
  const allOptions = [...filteredSingleLevel, ...filteredDeepPaths];
  const sorted = allOptions.sort((a, b) => {
    const depthA = 'depth' in a ? (a.depth as number) : 1;
    const depthB = 'depth' in b ? (b.depth as number) : 1;
    return depthA - depthB;
  });

  // Deduplicate by value and remove depth property from final results
  const seen = new Set<string>();
  const deduplicated = sorted.filter((option) => {
    if (seen.has(option.value)) {
      return false;
    }
    seen.add(option.value);
    return true;
  });

  return deduplicated.map(({ value, description }) => ({ value, description }));
}

async function computeHintForValue(
  ctx: CommandContext,
  node: ValueArgument,
  tokenInfo: TokenInfo,
): Promise<string> {
  try {
    if (node.hint != null && node.hint !== '') {
      if (typeof node.hint === 'function') {
        return await node.hint(ctx, tokenInfo);
      }
      return node.hint;
    }
  } catch (error) {
    logger.warn(
      () =>
        `Error computing hint: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (node.description) {
    return node.description;
  }

  return '';
}

function inferLiteralHint(nodes: LiteralArgument[]): string {
  if (nodes.length === 0) {
    return '';
  }

  if (nodes.length === 1) {
    return nodes[0].description ?? '';
  }

  // Check if all descriptions end with a common word (e.g., "parameter", "mode")
  // If so, suggest "Select <that_word>". Otherwise, fall back to "Select option".
  const descriptions = nodes
    .map((literal) => literal.description ?? '')
    .filter((desc) => desc.length > 0);

  if (descriptions.length > 1) {
    const lastTokens = descriptions
      .map((desc) => desc.trim().split(/\s+/))
      .filter((parts) => parts.length > 0)
      .map((parts) => parts[parts.length - 1].toLowerCase());

    if (
      lastTokens.length > 0 &&
      lastTokens.every((token) => token === lastTokens[0]) &&
      lastTokens[0]
    ) {
      const word = lastTokens[0];
      return `Select ${word}`;
    }
  }

  // If no common suffix, return the first available description (fallback to generic prompt)
  return descriptions[0] || 'Select option';
}

interface TokenizeState {
  current: string;
  inQuotes: boolean;
  escapeNext: boolean;
  hasTrailingSpace: boolean;
}

function processTokenChar(
  char: string,
  state: TokenizeState,
  tokens: string[],
): void {
  if (state.escapeNext) {
    state.current += char;
    state.escapeNext = false;
    return;
  }

  if (char === '\\') {
    state.escapeNext = true;
    return;
  }

  if (char === '"' || char === "'") {
    state.inQuotes = !state.inQuotes;
    return;
  }

  if (char === ' ' && !state.inQuotes) {
    if (state.current.length > 0) {
      tokens.push(state.current);
      state.current = '';
    }
    state.hasTrailingSpace = true;
    return;
  }

  state.current += char;
  state.hasTrailingSpace = false;
}

export function tokenize(fullLine: string): TokenInfo {
  const tokens: string[] = [];
  const state: TokenizeState = {
    current: '',
    inQuotes: false,
    escapeNext: false,
    hasTrailingSpace: false,
  };

  for (let i = 0; i < fullLine.length; i += 1) {
    processTokenChar(fullLine[i], state, tokens);
  }

  if (state.current.length > 0) {
    tokens.push(state.current);
  }

  const firstToken = tokens.length === 0 ? undefined : tokens[0];
  const prefixChars = new Set<string>(['/', '@']);
  const prefixChar = firstToken?.[0];
  // Stryker disable next-line BooleanLiteral
  const hasPrefixChar =
    typeof prefixChar === 'string' && prefixChars.has(prefixChar);
  // Stryker disable next-line ConditionalExpression -- ensures only `/` and `@` prefixes trigger schema stripping
  if (firstToken && hasPrefixChar) {
    const afterPrefix = firstToken.slice(1);
    if (afterPrefix.length === 0) {
      tokens.shift();
    } else if (tokens.length > 1 || state.hasTrailingSpace) {
      tokens[0] = afterPrefix;
    }
  }

  let partialTokenValue = '';
  // Stryker disable next-line ConditionalExpression
  const lastToken = tokens.length === 0 ? undefined : tokens[tokens.length - 1];
  if (!state.hasTrailingSpace) {
    const candidateLength = lastToken?.length ?? 0;
    // Stryker disable next-line ConditionalExpression, EqualityOperator
    if (candidateLength > 0 && lastToken) {
      partialTokenValue = lastToken;
    }
  }

  return {
    tokens,
    partialToken: partialTokenValue,
    hasTrailingSpace: state.hasTrailingSpace,
    position: tokens.length,
  };
}

export function createCompletionHandler(schema: CommandArgumentSchema) {
  return async (
    ctx: CommandContext,
    input: CompletionInput | undefined,
    fullLine: string,
  ): Promise<CompletionResult> => {
    const tokenInfo = tokenize(fullLine);
    const normalized = normalizeCompletionContext(input, tokenInfo);
    const active = resolveActiveStep(schema, normalized.completedArgs);

    const argumentTokenInfo = buildArgumentTokenInfo(
      normalized.completedArgs,
      normalized.partialArg,
      normalized.hasTrailingSpace,
    );

    let suggestions: readonly Option[] = [];
    let hint = '';
    if (active.kind === 'value') {
      suggestions = await suggestForValue(
        ctx,
        active.node,
        normalized.partialArg,
        argumentTokenInfo,
      );
      hint = await computeHintForValue(ctx, active.node, argumentTokenInfo);
    } else if (active.kind === 'literal') {
      suggestions = suggestForLiterals(
        ctx,
        active.nodes,
        normalized.partialArg,
      );
      hint = inferLiteralHint(active.nodes);
    }

    const baseIndex = active.consumedCount - active.consumedLiterals;
    const position = Math.max(
      1,
      baseIndex + 1 + (normalized.partialArg ? 1 : 0),
    );

    return {
      suggestions,
      hint,
      position,
    };
  };
}
