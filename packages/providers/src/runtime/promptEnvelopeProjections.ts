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
const EMPTY_TRANSPORT_TOKEN: object = Object.freeze({});
const EMPTY_UNSUPPORTED_MEDIA: readonly UnsupportedMediaEntry[] = Object.freeze(
  [],
);
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
  const unsupportedMedia = freezeUnsupportedMedia(options?.unsupportedMedia);
  return {
    model: extractModelOrThrow(requestBody, identity),
    protocol: identity.protocol,
    method: identity.method,
    projectionRevision: identity.projectionRevision,
    unsupportedMedia,
    transportToken: options?.transportToken ?? EMPTY_TRANSPORT_TOKEN,
    countProjectedTokens: () => Promise.resolve(tokens),
  };
}

function freezeUnsupportedMedia(
  value: readonly UnsupportedMediaEntry[] | undefined,
): readonly UnsupportedMediaEntry[] {
  if (value === undefined) return EMPTY_UNSUPPORTED_MEDIA;
  return Object.freeze(value.map((entry) => Object.freeze({ ...entry })));
}

function readModel(requestBody: unknown): string | undefined {
  if (typeof requestBody !== 'object' || requestBody === null) {
    return undefined;
  }
  const model = (requestBody as Record<string, unknown>).model;
  return typeof model === 'string' ? model : undefined;
}

function describeInvalidModel(requestBody: unknown): string {
  if (requestBody === null || requestBody === undefined) {
    return String(requestBody);
  }
  if (typeof requestBody === 'object') {
    const model = (requestBody as Record<string, unknown>).model;
    return `model=${JSON.stringify(model)}`;
  }
  return typeof requestBody;
}

/**
 * Fail fast at the projection boundary: `PromptEnvelopeProjection.model` is a
 * required non-empty string, and downstream estimate validation rejects empty
 * values. Returning a placeholder here would defer the failure to estimate
 * time, obscuring which request produced it (issue #2817).
 */
function extractModelOrThrow(
  requestBody: unknown,
  identity: ProjectionIdentity,
): string {
  const model = readModel(requestBody);
  if (model !== undefined && model.trim() !== '') {
    return model;
  }
  throw new Error(
    `PromptEnvelopeProjection (${identity.protocol}/${identity.method}): request body must carry a non-empty string "model" field, got ${describeInvalidModel(requestBody)}`,
  );
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
    return canonicalizePromptString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizePromptValue(item, key));
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(record).map(([childKey, child]) => [
        childKey,
        isAnthropicBase64Data(record, childKey)
          ? BINARY_PAYLOAD_PLACEHOLDER
          : canonicalizePromptValue(child, childKey),
      ]),
    );
  }
  return value;
}

function isAnthropicBase64Data(
  parent: Record<string, unknown>,
  key: string,
): boolean {
  return key === 'data' && parent.type === 'base64';
}

function canonicalizePromptString(value: string): string {
  if (!value.toLowerCase().includes(';base64,')) return value;
  return replaceAllBase64DataUris(value);
}

function replaceAllBase64DataUris(value: string): string {
  return value.replace(
    /data:(?:[^;,]+)?(?:;[^;,]*)*;base64,[A-Za-z0-9+/=]+/gi,
    (match) =>
      match.slice(0, match.toLowerCase().indexOf(';base64,') + 8) +
      BINARY_PAYLOAD_PLACEHOLDER,
  );
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
