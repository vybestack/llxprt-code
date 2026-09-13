/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  PromptEnvelopeEstimationProjection,
  PromptEnvelopeProjection,
  UnsupportedMediaEntry,
} from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { estimateTokens } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import {
  parseImageDimensionsFromBase64,
  type ImageDimensions,
} from '@vybestack/llxprt-code-tools/utils/imageDimensions.js';

export const PROJECTION_REVISION = 4;
const BINARY_PAYLOAD_PLACEHOLDER = '[binary media bytes omitted]';
/**
 * With a stateful parent (previous_response_id), instructions and tools are
 * retained server-side and already inside the observed parent baseline, so
 * counting them again in the incremental estimate double-counts (issue
 * #3481). Mid-conversation instructions/tools changes would be under-counted.
 */
const STATEFUL_INCREMENTAL_PROMPT_KEYS = ['input'] as const;

/**
 * One image part found while canonicalizing a finalized request.
 *
 * `dimensions` is present when the base64 header parsed; estimators fall back
 * to their unknown-dimensions cost when it is omitted. PDFs and other
 * non-image binaries produce no entries (issue #3481).
 */
export interface ProjectionImageEntry {
  readonly dimensions?: ImageDimensions;
}

export interface ProviderFinalizedPromptProjection {
  readonly kind: 'llxprt-provider-prompt-v3';
  readonly protocol: PromptEnvelopeProjection['protocol'];
  readonly promptText: string;
  readonly promptSegments?: readonly string[];
  readonly imageEntries?: readonly ProjectionImageEntry[];
}
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

export interface OpenAIResponsesProjectionContext {
  readonly statefulParentUsed: boolean;
  readonly retainedBaselineTokens?: number;
  readonly incrementalRequest: unknown;
  readonly fullHistoryRequest?: unknown;
}

type ProjectionIdentity = Pick<
  PromptEnvelopeProjection,
  'protocol' | 'method' | 'projectionRevision'
>;

function buildEstimationProjection(
  requestBody: unknown,
  promptKeys: readonly string[],
  protocol: PromptEnvelopeProjection['protocol'],
): PromptEnvelopeEstimationProjection {
  const imageEntries: ProjectionImageEntry[] = [];
  const canonicalEntries = canonicalPromptEntries(
    requestBody,
    promptKeys,
    imageEntries,
  );
  const promptText = serializePromptBearingStructure(canonicalEntries);
  const promptSegments = serializePromptSegments(canonicalEntries);
  let legacyTokens: number | undefined;
  const finalizedProjection: ProviderFinalizedPromptProjection = Object.freeze({
    kind: 'llxprt-provider-prompt-v3',
    protocol,
    promptText,
    promptSegments,
    ...(imageEntries.length > 0
      ? { imageEntries: Object.freeze(imageEntries) }
      : {}),
  });
  return Object.freeze({
    finalizedProjection,
    legacyEstimate: () => {
      legacyTokens ??= countPromptTokens(promptText);
      return Promise.resolve(legacyTokens);
    },
  });
}

function buildProjection(
  requestBody: unknown,
  promptKeys: readonly string[],
  identity: ProjectionIdentity,
  options?: ProjectionOptions,
): PromptEnvelopeProjection {
  const estimationProjection = buildEstimationProjection(
    requestBody,
    promptKeys,
    identity.protocol,
  );
  const unsupportedMedia = freezeUnsupportedMedia(options?.unsupportedMedia);
  // PromptEnvelopeProjection declares every member readonly. Freezing enforces
  // that at runtime too, so a projection cached or replayed across retries
  // cannot be mutated out from under a later estimate (issue #2817).
  return Object.freeze({
    model: extractModelOrThrow(requestBody, identity),
    protocol: identity.protocol,
    method: identity.method,
    projectionRevision: identity.projectionRevision,
    unsupportedMedia,
    transportToken: options?.transportToken ?? EMPTY_TRANSPORT_TOKEN,
    ...estimationProjection,
  });
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

function canonicalPromptEntries(
  requestBody: unknown,
  promptKeys: readonly string[],
  imageEntries: ProjectionImageEntry[],
): ReadonlyArray<[string, unknown]> {
  if (typeof requestBody !== 'object' || requestBody === null) return [];
  const body = requestBody as Record<string, unknown>;
  return promptKeys.flatMap((key) =>
    body[key] === undefined
      ? []
      : [[key, canonicalizePromptValue(body[key], key, imageEntries)]],
  );
}

function serializePromptBearingStructure(
  canonicalEntries: ReadonlyArray<[string, unknown]>,
): string {
  const promptBody = Object.fromEntries(canonicalEntries);
  return Object.keys(promptBody).length === 0 ? '' : JSON.stringify(promptBody);
}

function serializePromptSegments(
  canonicalEntries: ReadonlyArray<[string, unknown]>,
): readonly string[] {
  return Object.freeze(
    canonicalEntries.map(([, canonicalValue]) =>
      typeof canonicalValue === 'string'
        ? canonicalValue
        : JSON.stringify(canonicalValue),
    ),
  );
}
function canonicalizePromptValue(
  value: unknown,
  key: string,
  imageEntries: ProjectionImageEntry[],
): unknown {
  if (typeof value === 'string') {
    return canonicalizePromptString(value, imageEntries);
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      canonicalizePromptValue(item, key, imageEntries),
    );
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(record).map(([childKey, child]) => [
        childKey,
        isBinaryPayloadField(record, childKey)
          ? recordBase64BinaryField(record, child, imageEntries)
          : canonicalizePromptValue(child, childKey, imageEntries),
      ]),
    );
  }
  return value;
}

/**
 * An anthropic-style `{type: 'base64', media_type, data}` field's `data` child
 * holds raw base64 bytes that must be replaced with a placeholder.
 */
function isBinaryPayloadField(
  parent: Record<string, unknown>,
  key: string,
): boolean {
  return key === 'data' && parent.type === 'base64';
}

function recordBase64BinaryField(
  parent: Record<string, unknown>,
  child: unknown,
  imageEntries: ProjectionImageEntry[],
): unknown {
  if (isImageMimeType(parent.media_type)) {
    recordImageEntry(child, imageEntries);
  }
  return BINARY_PAYLOAD_PLACEHOLDER;
}

function isImageMimeType(mediaType: unknown): mediaType is string {
  return typeof mediaType === 'string' && mediaType.startsWith('image/');
}

function recordImageEntry(
  base64: unknown,
  imageEntries: ProjectionImageEntry[],
): void {
  const entry: ProjectionImageEntry =
    typeof base64 === 'string'
      ? { dimensions: parseImageDimensionsFromBase64(base64) }
      : {};
  imageEntries.push(Object.freeze(entry));
}

function canonicalizePromptString(
  value: string,
  imageEntries: ProjectionImageEntry[],
): string {
  if (!value.toLowerCase().includes(';base64,')) return value;
  return replaceAllBase64DataUris(value, imageEntries);
}

function replaceAllBase64DataUris(
  value: string,
  imageEntries: ProjectionImageEntry[],
): string {
  return value.replace(
    /data:(?:[^;,]+)?(?:;[^;,]*)*;base64,[A-Za-z0-9+/=]+/gi,
    (match) => {
      const base64Start = match.toLowerCase().indexOf(';base64,') + 8;
      const payload = match.slice(base64Start);
      // The MIME segment is between `data:` and the first `;`; an empty
      // segment (RFC 2397 data URL) is not an image.
      const mimeSegment = match.slice(5, match.indexOf(';')).toLowerCase();
      if (isImageMimeType(mimeSegment)) {
        recordImageEntry(payload, imageEntries);
      }
      return match.slice(0, base64Start) + BINARY_PAYLOAD_PLACEHOLDER;
    },
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
  context?: OpenAIResponsesProjectionContext,
): PromptEnvelopeProjection {
  const projection = buildProjection(
    request,
    PROMPT_KEYS['openai-responses'],
    {
      protocol: 'openai-responses',
      method: 'responses/v1',
      projectionRevision: PROJECTION_REVISION,
    },
    options,
  );
  if (context === undefined) {
    return projection;
  }
  if (!context.statefulParentUsed) {
    return Object.freeze({
      ...projection,
      accounting: Object.freeze({ statefulParentUsed: false }),
    });
  }

  const incremental = buildEstimationProjection(
    context.incrementalRequest,
    // A stateful parent retains instructions and tools server-side (observed
    // provider usage), so the incremental estimate counts only the new input;
    // counting the re-sent instructions/tools again would double-count what
    // the observed parent baseline already includes (issue #3481). Mid-
    // conversation instructions/tools changes would be under-counted.
    context.retainedBaselineTokens !== undefined
      ? STATEFUL_INCREMENTAL_PROMPT_KEYS
      : PROMPT_KEYS['openai-responses'],
    projection.protocol,
  );
  const fullHistoryRequest = context.fullHistoryRequest;
  if (
    context.retainedBaselineTokens === undefined &&
    fullHistoryRequest === undefined
  ) {
    throw new Error(
      'OpenAI Responses projection without observed parent usage requires a full-history request',
    );
  }
  const accounting =
    context.retainedBaselineTokens === undefined
      ? Object.freeze({
          statefulParentUsed: true,
          incremental,
          fullHistory: buildEstimationProjection(
            fullHistoryRequest,
            PROMPT_KEYS['openai-responses'],
            projection.protocol,
          ),
        })
      : Object.freeze({
          statefulParentUsed: true,
          retainedBaselineTokens: context.retainedBaselineTokens,
          incremental,
        });
  return Object.freeze({ ...projection, accounting });
}
