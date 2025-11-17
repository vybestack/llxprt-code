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

export type CompletionInput =
  | string
  | {
      args?: string;
      completedArgs?: readonly string[];
      partialArg?: string;
      commandPathLength?: number;
    };

interface NormalizedInput {
  commandPathLength: number;
  completedArgs: string[];
  partialArg: string;
  hasTrailingSpace: boolean;
}

interface ValueStepContext {
  kind: 'value';
  node: ValueArgument;
  remainingSchema: CommandArgumentSchema;
  consumedCount: number;
  consumedLiterals: number;
}

interface LiteralStepContext {
  kind: 'literal';
  nodes: LiteralArgument[];
  remainingSchema: CommandArgumentSchema;
  consumedCount: number;
  consumedLiterals: number;
}

interface EmptyContext {
  kind: 'none';
  consumedCount: number;
  consumedLiterals: number;
}

type ActiveContext = ValueStepContext | LiteralStepContext | EmptyContext;

function mergeSchemas(
  primary: CommandArgumentSchema | undefined,
  secondary: CommandArgumentSchema,
): CommandArgumentSchema {
  if (!primary || primary.length === 0) {
    return secondary;
  }
  if (secondary.length === 0) {
    return primary;
  }
  return [...primary, ...secondary];
}

function gatherLiteralGroup(schema: CommandArgumentSchema): {
  literals: LiteralArgument[];
  nextIndex: number;
} {
  const literals: LiteralArgument[] = [];
  let index = 0;
  while (index < schema.length && schema[index]?.kind === 'literal') {
    literals.push(schema[index] as LiteralArgument);
    index += 1;
  }
  return { literals, nextIndex: index };
}

function normalizeCompletionContext(
  input: CompletionInput | undefined,
  tokenInfo: TokenInfo,
): NormalizedInput {
  const tokens = [...tokenInfo.tokens];
  const hasTrailingSpace = tokenInfo.hasTrailingSpace;

  let commandPathLength = tokens.length > 0 ? 1 : 0;
  let completedArgs: string[] = [];
  let partialArg = hasTrailingSpace ? '' : (tokenInfo.partialToken ?? '');
  let explicitCompleted = false;
  let explicitPartial = false;

  if (typeof input === 'object' && input !== null) {
    if (
      typeof input.commandPathLength === 'number' &&
      Number.isFinite(input.commandPathLength)
    ) {
      commandPathLength = Math.max(0, Math.floor(input.commandPathLength));
    }

    if (Array.isArray(input.completedArgs)) {
      completedArgs = [...input.completedArgs];
      explicitCompleted = true;
    }

    if (typeof input.partialArg === 'string') {
      partialArg = input.partialArg;
      explicitPartial = true;
    }

    if (typeof input.args === 'string' && !explicitCompleted) {
      const trimmed = input.args.trim();
      completedArgs = trimmed ? trimmed.split(/\s+/) : [];
    }
  } else if (typeof input === 'string') {
    const trimmed = input.trim();
    completedArgs = trimmed ? trimmed.split(/\s+/) : [];
  }

  const sanitizedPath = Math.max(0, Math.min(commandPathLength, tokens.length));
  const argsFromTokens = tokens.slice(sanitizedPath);

  if (!explicitCompleted) {
    completedArgs = [...argsFromTokens];
    if (!hasTrailingSpace && tokenInfo.partialToken && argsFromTokens.length) {
      completedArgs = argsFromTokens.slice(0, -1);
    }
  }

  if (!explicitPartial) {
    partialArg = hasTrailingSpace ? '' : (tokenInfo.partialToken ?? '');
    if (tokens.length <= sanitizedPath) {
      partialArg = '';
    }
  }

  return {
    commandPathLength: sanitizedPath,
    completedArgs,
    partialArg,
    hasTrailingSpace,
  };
}

function buildArgumentTokenInfo(
  completedArgs: readonly string[],
  partialArg: string,
  hasTrailingSpace: boolean,
): TokenInfo {
  const tokens = [...completedArgs];
  if (!hasTrailingSpace && partialArg) {
    tokens.push(partialArg);
  }

  const positionBase = completedArgs.length;
  const position = Math.max(1, positionBase + (partialArg ? 2 : 1));

  return {
    tokens,
    partialToken: hasTrailingSpace ? '' : partialArg,
    hasTrailingSpace,
    position,
  };
}

function resolveActiveStep(
  schema: CommandArgumentSchema,
  completedArgs: readonly string[],
): ActiveContext {
  let currentSchema = schema ?? [];
  const remainingArgs = [...completedArgs];
  let consumedCount = 0;
  let consumedLiterals = 0;

  while (currentSchema.length > 0) {
    const firstNode = currentSchema[0];

    if (firstNode.kind === 'literal') {
      const { literals, nextIndex } = gatherLiteralGroup(currentSchema);

      if (remainingArgs.length === 0) {
        return {
          kind: 'literal',
          nodes: literals,
          remainingSchema: currentSchema.slice(nextIndex),
          consumedCount,
          consumedLiterals,
        };
      }

      const candidate = remainingArgs[0];
      const matched = literals.find((literal) => literal.value === candidate);

      if (matched) {
        remainingArgs.shift();
        consumedCount += 1;
        consumedLiterals += 1;
        const remainingSchema = matched.stopPropagation
          ? []
          : currentSchema.slice(nextIndex);
        currentSchema = mergeSchemas(matched.next, remainingSchema);
        continue;
      }

      return {
        kind: 'literal',
        nodes: literals,
        remainingSchema: currentSchema.slice(nextIndex),
        consumedCount,
        consumedLiterals,
      };
    }

    const valueNode = firstNode as ValueArgument;

    if (remainingArgs.length === 0) {
      return {
        kind: 'value',
        node: valueNode,
        remainingSchema: currentSchema.slice(1),
        consumedCount,
        consumedLiterals,
      };
    }

    remainingArgs.shift();
    consumedCount += 1;
    currentSchema = mergeSchemas(valueNode.next, currentSchema.slice(1));
  }

  return {
    kind: 'none',
    consumedCount,
    consumedLiterals,
  };
}

async function suggestForValue(
  ctx: CommandContext,
  node: ValueArgument,
  partialArg: string,
  tokenInfo: TokenInfo,
): Promise<readonly Option[]> {
  try {
    if (node.options?.length) {
      const lowerPartial = partialArg.toLowerCase();
      return node.options
        .filter((option) =>
          lowerPartial.length === 0
            ? true
            : option.value.toLowerCase().startsWith(lowerPartial),
        )
        .map((option) => ({
          value: option.value,
          description: option.description,
        }));
    }

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
  } catch (error) {
    console.warn('Error generating suggestions:', error);
  }

  return [];
}

function suggestForLiterals(
  nodes: LiteralArgument[],
  partialArg: string,
): readonly Option[] {
  const lowerPartial = partialArg.toLowerCase();
  return nodes
    .filter((node) =>
      lowerPartial.length === 0
        ? true
        : node.value.toLowerCase().startsWith(lowerPartial),
    )
    .map((node) => ({
      value: node.value,
      description: node.description,
    }));
}

async function computeHintForValue(
  ctx: CommandContext,
  node: ValueArgument,
  tokenInfo: TokenInfo,
): Promise<string> {
  try {
    if (node.hint) {
      if (typeof node.hint === 'function') {
        return await node.hint(ctx, tokenInfo);
      }
      return node.hint;
    }
  } catch (error) {
    console.warn('Error computing hint:', error);
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

export function tokenize(fullLine: string): TokenInfo {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  let escapeNext = false;
  let hasTrailingSpace = false;

  for (let i = 0; i < fullLine.length; i += 1) {
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
      inQuotes = !inQuotes;
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

  if (current.length > 0) {
    tokens.push(current);
  }

  const firstToken = tokens[0];
  const prefixChars = new Set<string>(['/', '@']);
  const prefixChar = firstToken?.[0];
  // Stryker disable next-line BooleanLiteral
  const hasPrefixChar =
    typeof prefixChar === 'string' && prefixChars.has(prefixChar);
  // Stryker disable next-line ConditionalExpression -- ensures only `/` and `@` prefixes trigger schema stripping
  if (firstToken && hasPrefixChar) {
    const afterPrefix = firstToken!.slice(1);
    if (afterPrefix.length === 0) {
      tokens.shift();
    } else if (tokens.length > 1 || hasTrailingSpace) {
      tokens[0] = afterPrefix;
    }
  }

  let partialTokenValue = '';
  // Stryker disable next-line ConditionalExpression
  const lastToken = tokens.length === 0 ? undefined : tokens[tokens.length - 1];
  if (!hasTrailingSpace) {
    const candidateLength = lastToken?.length ?? 0;
    // Stryker disable next-line ConditionalExpression, EqualityOperator
    if (candidateLength > 0 && lastToken) {
      partialTokenValue = lastToken;
    }
  }

  return {
    tokens,
    partialToken: partialTokenValue,
    hasTrailingSpace,
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
      suggestions = suggestForLiterals(active.nodes, normalized.partialArg);
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
