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

type PatternFetch = NonNullable<GoogleGenerativeAIProviderSettings['fetch']>;

export function createPatternPreservingFetch(
  tools: LanguageModelV4CallOptions['tools'],
  onRequestBytes?: (bytes: number) => void,
  innerFetch: PatternFetch = globalThis.fetch,
): PatternFetch {
  const schemas = new Map(
    tools?.flatMap((tool) =>
      tool.type === 'function' ? [[tool.name, tool.inputSchema] as const] : [],
    ),
  );
  const patternFetch = async (
    input: Parameters<PatternFetch>[0],
    init?: Parameters<PatternFetch>[1],
  ): Promise<Response> => {
    if (schemas.size === 0) {
      if (typeof init?.body === 'string') {
        onRequestBytes?.(Buffer.byteLength(init.body, 'utf8'));
      }
      return innerFetch(input, init);
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
    const projectedBody = JSON.stringify({ ...body, tools: projected });
    onRequestBytes?.(Buffer.byteLength(projectedBody, 'utf8'));
    return innerFetch(input, { ...init, body: projectedBody });
  };
  // `preconnect` is a Bun-only member of `fetch`. The build tsconfig does not
  // see globalThis.fetch with that member even though the AI SDK's fetch type
  // requires it, so forward by runtime lookup instead of by static type.
  return Object.assign(patternFetch, {
    preconnect: (url: string | URL) => {
      const preconnect: unknown = Reflect.get(globalThis.fetch, 'preconnect');
      if (typeof preconnect === 'function') {
        Reflect.apply(preconnect, globalThis.fetch, [url]);
      }
    },
  });
}
