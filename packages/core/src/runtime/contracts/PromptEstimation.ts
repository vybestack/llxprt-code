/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  RuntimePromptEstimateMethod,
  RuntimeTokenizerFactory,
} from './RuntimeTokenizerFactory.js';

export type PromptEnvelopeProtocol =
  | 'anthropic-messages'
  | 'openai-chat'
  | 'openai-responses';

export type PromptEnvelopeMethod =
  | 'messages/v1'
  | 'chat/completions/v1'
  | 'responses/v1';

export interface UnsupportedMediaEntry {
  readonly kind: 'unsupported';
  readonly reason: string;
  readonly mediaType?: string;
}

export interface PromptEnvelopeProjection {
  readonly model: string;
  readonly protocol: PromptEnvelopeProtocol;
  readonly method: PromptEnvelopeMethod;
  readonly projectionRevision: number;
  readonly unsupportedMedia: readonly UnsupportedMediaEntry[];
  readonly transportToken: object;
  readonly finalizedProjection: unknown;
  readonly legacyEstimate: () => Promise<number>;
  readonly releaseIfUnsent?: () => Promise<void>;
}

export interface PromptEnvelopeEstimate {
  readonly estimatedPromptTokens: number;
  readonly activeProvider: string;
  readonly model: string;
  readonly protocol: PromptEnvelopeProtocol;
  readonly method: PromptEnvelopeMethod;
  readonly estimatorMethod: RuntimePromptEstimateMethod;
  readonly estimatorFamily: string;
  readonly estimatorVersion: string;
  readonly assetRevision: string;
  readonly projectionRevision: number;
  readonly unsupportedMedia: readonly UnsupportedMediaEntry[];
}

const SUPPORTED_METHODS_BY_PROTOCOL: Readonly<
  Record<PromptEnvelopeProtocol, readonly PromptEnvelopeMethod[]>
> = Object.freeze({
  'anthropic-messages': Object.freeze(['messages/v1'] as const),
  'openai-chat': Object.freeze(['chat/completions/v1'] as const),
  'openai-responses': Object.freeze(['responses/v1'] as const),
});

function assertNonEmptyString(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `PromptEnvelopeEstimate validation failed: ${field} must be a non-empty string`,
    );
  }
}

function assertSupportedProtocolMethodPair(
  protocol: PromptEnvelopeProtocol,
  method: PromptEnvelopeMethod,
): void {
  if (!Object.keys(SUPPORTED_METHODS_BY_PROTOCOL).includes(protocol)) {
    throw new Error(
      `PromptEnvelopeEstimate validation failed: protocol must be one of ${Object.keys(
        SUPPORTED_METHODS_BY_PROTOCOL,
      ).join(', ')} (received "${protocol}")`,
    );
  }
  const supportedMethods = SUPPORTED_METHODS_BY_PROTOCOL[protocol];
  if (!supportedMethods.includes(method)) {
    throw new Error(
      `PromptEnvelopeEstimate validation failed: protocol "${protocol}" does not support method "${method}" (supported: ${supportedMethods.join(
        ', ',
      )})`,
    );
  }
}

function assertFiniteNonNegativeInt(value: number, field: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(
      `PromptEnvelopeEstimate validation failed: ${field} must be a finite non-negative integer`,
    );
  }
}

function validateUnsupportedMedia(
  value: unknown,
): readonly UnsupportedMediaEntry[] {
  if (!Array.isArray(value)) {
    throw new Error(
      'PromptEnvelopeEstimate validation failed: unsupportedMedia must be an array',
    );
  }
  return Object.freeze(value.map(validateUnsupportedMediaEntry));
}

function validateUnsupportedMediaEntry(
  entry: unknown,
  index: number,
): Readonly<UnsupportedMediaEntry> {
  if (!isUnsupportedMediaEntry(entry)) {
    throw new Error(
      `PromptEnvelopeEstimate validation failed: unsupportedMedia[${index}] must be a valid unsupported media entry`,
    );
  }
  return Object.freeze({ ...entry });
}

function isUnsupportedMediaEntry(
  entry: unknown,
): entry is UnsupportedMediaEntry {
  if (typeof entry !== 'object' || entry === null) return false;
  if (!('kind' in entry) || entry.kind !== 'unsupported') return false;
  if (
    !('reason' in entry) ||
    typeof entry.reason !== 'string' ||
    entry.reason.trim() === ''
  ) {
    return false;
  }
  return (
    !('mediaType' in entry) ||
    entry.mediaType === undefined ||
    typeof entry.mediaType === 'string'
  );
}

function validateProjection(
  activeProvider: string,
  projection: PromptEnvelopeProjection,
): readonly UnsupportedMediaEntry[] {
  assertNonEmptyString(activeProvider, 'activeProvider');
  assertNonEmptyString(projection.model, 'model');
  assertNonEmptyString(projection.protocol, 'protocol');
  assertNonEmptyString(projection.method, 'method');
  assertSupportedProtocolMethodPair(projection.protocol, projection.method);
  assertFiniteNonNegativeInt(
    projection.projectionRevision,
    'projectionRevision',
  );
  if (typeof projection.legacyEstimate !== 'function') {
    throw new Error(
      'PromptEnvelopeEstimate validation failed: legacyEstimate must be a function',
    );
  }
  return validateUnsupportedMedia(projection.unsupportedMedia);
}

function validateResult(
  projection: PromptEnvelopeProjection,
  result: Awaited<ReturnType<RuntimeTokenizerFactory['estimatePrompt']>>,
): void {
  assertFiniteNonNegativeInt(result.count, 'estimatedPromptTokens');
  const method: unknown = result.method;
  if (method !== 'exact' && method !== 'calibrated') {
    throw new Error(
      'PromptEnvelopeEstimate validation failed: estimator method must be exact or calibrated',
    );
  }
  assertNonEmptyString(result.family, 'estimatorFamily');
  assertNonEmptyString(result.estimatorVersion, 'estimatorVersion');
  assertNonEmptyString(result.assetRevision, 'assetRevision');
  assertFiniteNonNegativeInt(result.projectionRevision, 'projectionRevision');
  if (result.projectionRevision !== projection.projectionRevision) {
    throw new Error(
      'PromptEnvelopeEstimate validation failed: estimator projection revision must match provider projection revision',
    );
  }
}

export async function estimatePromptEnvelope(
  activeProvider: string,
  projection: PromptEnvelopeProjection,
  factory: RuntimeTokenizerFactory,
): Promise<PromptEnvelopeEstimate> {
  const unsupportedMedia = validateProjection(activeProvider, projection);
  const result = await factory.estimatePrompt({
    activeProvider,
    canonicalModel: projection.model,
    protocol: projection.protocol,
    wireMethod: projection.method,
    finalizedProjection: projection.finalizedProjection,
    projectionRevision: projection.projectionRevision,
    legacyEstimate: projection.legacyEstimate,
  });
  validateResult(projection, result);
  return Object.freeze({
    estimatedPromptTokens: result.count,
    activeProvider,
    model: projection.model,
    protocol: projection.protocol,
    method: projection.method,
    estimatorMethod: result.method,
    estimatorFamily: result.family,
    estimatorVersion: result.estimatorVersion,
    assetRevision: result.assetRevision,
    projectionRevision: projection.projectionRevision,
    unsupportedMedia,
  });
}
