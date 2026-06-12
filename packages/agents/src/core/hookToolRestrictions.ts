/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Content,
  FunctionCall,
  GenerateContentResponse,
  Part,
} from '@google/genai';
import { getFunctionCallsFromParts } from '../utils/generateContentResponseUtilities.js';
import { canonicalizeToolName } from './toolGovernance.js';

const responseRestrictions = new WeakMap<GenerateContentResponse, string[]>();
const responseFilteredRestrictedCalls = new WeakMap<
  GenerateContentResponse,
  boolean
>();
const functionCallRestrictions = new WeakMap<FunctionCall, string[]>();

const responseRestrictionsSymbol = Symbol('hookRestrictedAllowedTools');
const responseFilteredRestrictedCallsSymbol = Symbol(
  'hookRestrictedFilteredCalls',
);
const functionCallRestrictionsSymbol = Symbol('hookRestrictedAllowedTools');

type HookRestrictedResponse = GenerateContentResponse & {
  [responseRestrictionsSymbol]?: string[];
  [responseFilteredRestrictedCallsSymbol]?: boolean;
};

type HookRestrictedFunctionCall = FunctionCall & {
  [functionCallRestrictionsSymbol]?: string[];
};

function setResponseRestrictionMetadata(
  response: GenerateContentResponse,
  allowedTools: readonly string[],
): void {
  responseRestrictions.set(response, [...allowedTools]);
  Object.defineProperty(response, responseRestrictionsSymbol, {
    configurable: true,
    enumerable: false,
    value: [...allowedTools],
  });
}

function setResponseFilteredMetadata(response: GenerateContentResponse): void {
  responseFilteredRestrictedCalls.set(response, true);
  Object.defineProperty(response, responseFilteredRestrictedCallsSymbol, {
    configurable: true,
    enumerable: false,
    value: true,
  });
}

function stringifyFunctionCallArgs(args: unknown): string {
  try {
    // JSON.stringify can return undefined at runtime (e.g. for functions or
    // symbols) even though its type signature says string, so guard the result.
    const serialized = JSON.stringify(args === undefined ? {} : args) as
      | string
      | undefined;
    return serialized ?? '{}';
  } catch {
    return String(args);
  }
}

function functionCallKey(call: FunctionCall): string {
  if (typeof call.id === 'string' && call.id.trim() !== '') {
    return `id:${call.id}`;
  }
  const name = typeof call.name === 'string' ? call.name : '';
  return `name:${canonicalizeToolName(name)}:args:${stringifyFunctionCallArgs(
    call.args,
  )}`;
}

export function mergeHookRestrictedFunctionCalls(
  primaryCalls: readonly FunctionCall[],
  secondaryCalls: readonly FunctionCall[],
): FunctionCall[] {
  const seen = new Set(primaryCalls.map(functionCallKey));
  const merged = [...primaryCalls];
  for (const call of secondaryCalls) {
    const key = functionCallKey(call);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(call);
    }
  }
  return merged;
}

export function attachHookRestrictedAllowedTools(
  response: GenerateContentResponse,
  allowedTools: readonly string[] | undefined,
): GenerateContentResponse {
  if (allowedTools === undefined) {
    return response;
  }

  const restrictedResponse = Object.assign(
    Object.create(Object.getPrototypeOf(response)) as GenerateContentResponse,
    response,
  );
  restrictedResponse.candidates = response.candidates?.map((candidate) => ({
    ...candidate,
    content:
      candidate.content === undefined
        ? undefined
        : {
            ...candidate.content,
            parts:
              candidate.content.parts === undefined
                ? undefined
                : filterResponseCandidateParts(
                    restrictedResponse,
                    candidate.content.parts,
                    allowedTools,
                  ),
          },
  }));
  restrictedResponse.automaticFunctionCallingHistory =
    response.automaticFunctionCallingHistory === undefined
      ? undefined
      : filterHookRestrictedContents(
          response.automaticFunctionCallingHistory,
          allowedTools,
        ).filter((content) => (content.parts?.length ?? 0) > 0);

  const originalTopLevelCalls = response.functionCalls ?? [];
  const filteredTopLevelCalls = filterHookRestrictedFunctionCalls(
    originalTopLevelCalls,
    allowedTools,
  );
  if (filteredTopLevelCalls.length < originalTopLevelCalls.length) {
    setResponseFilteredMetadata(restrictedResponse);
  }
  setResponseRestrictionMetadata(restrictedResponse, allowedTools);
  Object.defineProperty(restrictedResponse, 'functionCalls', {
    configurable: true,
    enumerable: true,
    get() {
      return filteredTopLevelCalls.length > 0
        ? filteredTopLevelCalls
        : undefined;
    },
  });
  return restrictedResponse;
}

export function hasFilteredHookRestrictedToolCalls(
  response: GenerateContentResponse,
): boolean {
  return (
    responseFilteredRestrictedCalls.get(response) === true ||
    (response as HookRestrictedResponse)[
      responseFilteredRestrictedCallsSymbol
    ] === true
  );
}

function filterResponseCandidateParts(
  response: GenerateContentResponse,
  parts: Part[],
  allowedTools: readonly string[],
): Part[] {
  const originalCalls = getFunctionCallsFromParts(parts) ?? [];
  const filteredParts = filterHookRestrictedParts(parts, allowedTools);
  const filteredCalls = getFunctionCallsFromParts(filteredParts) ?? [];
  if (
    filteredCalls.length < originalCalls.length ||
    filteredParts.length < parts.length
  ) {
    setResponseFilteredMetadata(response);
  }
  return filteredParts;
}

export function filterHookRestrictedContent(
  content: Content,
  allowedTools: readonly string[] | undefined,
): Content {
  const parts = content.parts ?? [];
  return {
    ...content,
    parts: filterHookRestrictedParts(parts, allowedTools),
  };
}

export function filterHookRestrictedContents(
  contents: readonly Content[],
  allowedTools: readonly string[] | undefined,
): Content[] {
  if (allowedTools === undefined) {
    return [...contents];
  }
  return contents.map((content) =>
    filterHookRestrictedContent(content, allowedTools),
  );
}

export function getHookRestrictedAllowedTools(
  response: GenerateContentResponse,
): string[] | undefined {
  const allowedTools =
    responseRestrictions.get(response) ??
    (response as HookRestrictedResponse)[responseRestrictionsSymbol];
  return allowedTools === undefined ? undefined : [...allowedTools];
}

export function setHookRestrictedAllowedToolsOnFunctionCall(
  functionCall: FunctionCall,
  allowedTools: readonly string[] | undefined,
): void {
  if (allowedTools !== undefined) {
    functionCallRestrictions.set(functionCall, [...allowedTools]);
    Object.defineProperty(functionCall, functionCallRestrictionsSymbol, {
      configurable: true,
      enumerable: false,
      value: [...allowedTools],
    });
  }
}

export function getHookRestrictedAllowedToolsForFunctionCall(
  functionCall: FunctionCall,
): string[] | undefined {
  const allowedTools =
    functionCallRestrictions.get(functionCall) ??
    (functionCall as HookRestrictedFunctionCall)[
      functionCallRestrictionsSymbol
    ];
  return allowedTools === undefined ? undefined : [...allowedTools];
}

export function isHookRestrictedToolCall(
  fnCall: FunctionCall,
  allowedTools: readonly string[] | undefined,
): boolean {
  if (allowedTools === undefined) {
    return false;
  }
  if (typeof fnCall.name !== 'string' || fnCall.name.trim() === '') {
    return true;
  }
  const allowed = new Set(allowedTools.map(canonicalizeToolName));
  return !allowed.has(canonicalizeToolName(fnCall.name));
}

export function filterHookRestrictedParts(
  parts: readonly Part[],
  allowedTools: readonly string[] | undefined,
): Part[] {
  if (allowedTools === undefined) {
    return [...parts];
  }

  return parts.filter((part) => {
    if (part.functionCall !== undefined) {
      setHookRestrictedAllowedToolsOnFunctionCall(
        part.functionCall,
        allowedTools,
      );
      return !isHookRestrictedToolCall(part.functionCall, allowedTools);
    }

    if (part.functionResponse !== undefined) {
      const responseAsCall: FunctionCall = {
        id: part.functionResponse.id,
        name: part.functionResponse.name ?? '',
        args: {},
      };
      return !isHookRestrictedToolCall(responseAsCall, allowedTools);
    }

    return true;
  });
}

export function getHookRestrictedFunctionCallsFromParts(
  parts: readonly Part[],
  allowedTools: readonly string[] | undefined,
): FunctionCall[] {
  return (
    getFunctionCallsFromParts(filterHookRestrictedParts(parts, allowedTools)) ??
    []
  );
}

export function filterHookRestrictedFunctionCalls(
  calls: readonly FunctionCall[],
  allowedTools: readonly string[] | undefined,
): FunctionCall[] {
  if (allowedTools === undefined) {
    return [...calls];
  }

  return calls.filter((call) => {
    setHookRestrictedAllowedToolsOnFunctionCall(call, allowedTools);
    return !isHookRestrictedToolCall(call, allowedTools);
  });
}
