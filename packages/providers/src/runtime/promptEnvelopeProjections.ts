/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  PromptEnvelopeProjection,
  UnsupportedMediaEntry,
} from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { estimateTokens } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';

const PROJECTION_REVISION = 2;
const BINARY_PAYLOAD_PLACEHOLDER = '[binary media bytes omitted]';
const BARE_BASE64_KEYS = new Set(['data']);
const BASE64_SYMBOLS = new Set(['+', '/', '=']);
const PROMPT_KEYS = {
  'anthropic-messages': ['system', 'messages', 'tools'],
  'openai-chat': ['messages', 'tools'],
  'openai-responses': ['instructions', 'input', 'tools'],
} as const;

export interface ProjectionOptions {
  readonly unsupportedMedia?: readonly UnsupportedMediaEntry[];
  readonly transportToken?: object;
}

type ProjectionIdentity = Pick<
  PromptEnvelopeProjection,
  'protocol' | 'method' | 'projectionRevision'
>;

function buildProjection(
  requestBody: unknown,
  promptKeys: readonly string[],
  identity: ProjectionIdentity,
  options?: ProjectionOptions,
): PromptEnvelopeProjection {
  const promptText = serializePromptBearingStructure(requestBody, promptKeys);
  const tokens = countPromptTokens(promptText);
  return {
    model: extractModel(requestBody),
    protocol: identity.protocol,
    method: identity.method,
    projectionRevision: identity.projectionRevision,
    unsupportedMedia: options?.unsupportedMedia ?? [],
    transportToken: options?.transportToken ?? Object.freeze({}),
    countProjectedTokens: () => Promise.resolve(tokens),
  };
}

function extractModel(requestBody: unknown): string {
  if (
    typeof requestBody === 'object' &&
    requestBody !== null &&
    'model' in requestBody &&
    typeof requestBody.model === 'string'
  ) {
    return requestBody.model;
  }
  return '';
}

function serializePromptBearingStructure(
  requestBody: unknown,
  promptKeys: readonly string[],
): string {
  if (typeof requestBody !== 'object' || requestBody === null) return '';
  const body = requestBody as Record<string, unknown>;
  const promptBody = Object.fromEntries(
    promptKeys
      .filter((key) => body[key] !== undefined)
      .map((key) => [key, canonicalizePromptValue(body[key], key)]),
  );
  return Object.keys(promptBody).length === 0 ? '' : JSON.stringify(promptBody);
}

function canonicalizePromptValue(value: unknown, key: string): unknown {
  if (typeof value === 'string') {
    return canonicalizePromptString(value, key);
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizePromptValue(item, key));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(
        ([childKey, child]) => [
          childKey,
          canonicalizePromptValue(child, childKey),
        ],
      ),
    );
  }
  return value;
}

function canonicalizePromptString(value: string, key: string): string {
  const base64Marker = ';base64,';
  const markerIndex = value.toLowerCase().indexOf(base64Marker);
  if (value.toLowerCase().startsWith('data:') && markerIndex >= 4) {
    return `${value.slice(0, markerIndex + base64Marker.length)}${BINARY_PAYLOAD_PLACEHOLDER}`;
  }
  if (
    BARE_BASE64_KEYS.has(key.toLowerCase()) &&
    value.length > 256 &&
    isProbableBase64(value)
  ) {
    return BINARY_PAYLOAD_PLACEHOLDER;
  }
  return value;
}

function isProbableBase64(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    const allowed =
      isAsciiAlphaNumeric(code) ||
      BASE64_SYMBOLS.has(character) ||
      isAsciiWhitespace(code);
    if (!allowed) return false;
  }
  return true;
}

function isAsciiAlphaNumeric(code: number): boolean {
  if (code >= 48 && code <= 57) return true;
  if (code >= 65 && code <= 90) return true;
  return code >= 97 && code <= 122;
}

function isAsciiWhitespace(code: number): boolean {
  return code === 32 || (code >= 9 && code <= 13);
}

function countPromptTokens(promptText: string): number {
  return promptText.trim() === '' ? 0 : estimateTokens(promptText);
}

export function projectAnthropicPromptEnvelope(
  requestBody: unknown,
  options?: ProjectionOptions,
): PromptEnvelopeProjection {
  return buildProjection(
    requestBody,
    PROMPT_KEYS['anthropic-messages'],
    {
      protocol: 'anthropic-messages',
      method: 'messages/v1',
      projectionRevision: PROJECTION_REVISION,
    },
    options,
  );
}

export function projectOpenAIChatPromptEnvelope(
  requestBody: unknown,
  options?: ProjectionOptions,
): PromptEnvelopeProjection {
  return buildProjection(
    requestBody,
    PROMPT_KEYS['openai-chat'],
    {
      protocol: 'openai-chat',
      method: 'chat/completions/v1',
      projectionRevision: PROJECTION_REVISION,
    },
    options,
  );
}

export function projectOpenAIResponsesPromptEnvelope(
  request: unknown,
  options?: ProjectionOptions,
): PromptEnvelopeProjection {
  return buildProjection(
    request,
    PROMPT_KEYS['openai-responses'],
    {
      protocol: 'openai-responses',
      method: 'responses/v1',
      projectionRevision: PROJECTION_REVISION,
    },
    options,
  );
}
