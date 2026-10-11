/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GoogleGenerativeAIProviderSettings } from '@ai-sdk/google';
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error('Expected an AI SDK request record');
  }
  return value;
}

function restorePatterns(wire: unknown, source: unknown): unknown {
  if (Array.isArray(wire) && Array.isArray(source)) {
    return wire.map((entry, index) => restorePatterns(entry, source[index]));
  }
  if (
    typeof wire !== 'object' ||
    wire === null ||
    Array.isArray(wire) ||
    typeof source !== 'object' ||
    source === null ||
    Array.isArray(source)
  ) {
    return wire;
  }
  const original = record(source);
  return {
    ...Object.fromEntries(
      Object.entries(wire).map(([key, value]) => [
        key,
        restorePatterns(value, original[key]),
      ]),
    ),
    ...(typeof original['pattern'] === 'string'
      ? { pattern: original['pattern'] }
      : {}),
  };
}

export function createPatternPreservingFetch(
  tools: LanguageModelV4CallOptions['tools'],
): NonNullable<GoogleGenerativeAIProviderSettings['fetch']> {
  const schemas = new Map(
    tools?.flatMap((tool) =>
      tool.type === 'function' ? [[tool.name, tool.inputSchema] as const] : [],
    ),
  );
  return async (input, init): Promise<Response> => {
    if (schemas.size === 0) {
      return globalThis.fetch(input, init);
    }
    if (typeof init?.body !== 'string') {
      throw new Error('Expected an AI SDK JSON request body');
    }
    const body = record(JSON.parse(init.body));
    if (!Array.isArray(body['tools'])) {
      throw new Error('Expected AI SDK function tools');
    }
    const projected = body['tools'].map((group: unknown) => {
      const tool = record(group);
      const declarations = tool['functionDeclarations'];
      if (!Array.isArray(declarations)) {
        return tool;
      }
      return {
        ...tool,
        functionDeclarations: declarations.map((value: unknown) => {
          const declaration = record(value);
          const name = declaration['name'];
          if (typeof name !== 'string' || !schemas.has(name)) {
            throw new Error('Unexpected AI SDK function declaration');
          }
          return {
            ...declaration,
            parameters: restorePatterns(
              declaration['parameters'],
              schemas.get(name),
            ),
          };
        }),
      };
    });
    return globalThis.fetch(input, {
      ...init,
      body: JSON.stringify({ ...body, tools: projected }),
    });
  };
}
