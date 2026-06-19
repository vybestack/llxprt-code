/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CommandArgumentSchema,
  LiteralArgument,
  TokenInfo,
  ValueArgument,
} from './types.js';

interface CompletionInputObject {
  args?: string;
  completedArgs?: readonly string[];
  partialArg?: string;
  commandPathLength?: number;
}

export type CompletionInput = string | CompletionInputObject;

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

export type ActiveContext =
  | ValueStepContext
  | LiteralStepContext
  | EmptyContext;

export function mergeSchemas(
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

export function gatherLiteralGroup(schema: CommandArgumentSchema): {
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

export function normalizeCompletionContext(
  input: CompletionInput | undefined,
  tokenInfo: TokenInfo,
): NormalizedInput {
  const tokens = [...tokenInfo.tokens];
  const hasTrailingSpace = tokenInfo.hasTrailingSpace;

  let commandPathLength = tokens.length > 0 ? 1 : 0;
  let completedArgs: string[] = [];
  let partialArg = hasTrailingSpace ? '' : tokenInfo.partialToken;
  let explicitCompleted = false;
  let explicitPartial = false;

  if (typeof input === 'object') {
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

  if (explicitCompleted === false) {
    completedArgs = [...argsFromTokens];
    if (
      hasTrailingSpace === false &&
      tokenInfo.partialToken !== '' &&
      argsFromTokens.length > 0
    ) {
      completedArgs = argsFromTokens.slice(0, -1);
    }
  }

  if (!explicitPartial) {
    partialArg = hasTrailingSpace ? '' : tokenInfo.partialToken;
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

export function buildArgumentTokenInfo(
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

function consumeLiteralMatch(
  literals: readonly LiteralArgument[],
  remainingArgs: string[],
): LiteralArgument | undefined {
  const candidate = remainingArgs[0];
  return literals.find((literal) => literal.value === candidate);
}

export function resolveActiveStep(
  schema: CommandArgumentSchema,
  completedArgs: readonly string[],
): ActiveContext {
  let currentSchema = schema;
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

      const matched = consumeLiteralMatch(literals, remainingArgs);

      if (matched) {
        remainingArgs.shift();
        consumedCount += 1;
        consumedLiterals += 1;
        const remainingSchema =
          matched.stopPropagation === true
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

    const valueNode = firstNode;

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
