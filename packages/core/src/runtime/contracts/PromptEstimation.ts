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

export interface PromptEnvelopeEstimationProjection {
  readonly finalizedProjection: unknown;
  readonly legacyEstimate: () => Promise<number>;
}

export interface PromptEnvelopeAccountingProjection {
  readonly statefulParentUsed: boolean;
  readonly retainedBaselineTokens?: number;
  readonly incremental?: PromptEnvelopeEstimationProjection;
  readonly fullHistory?: PromptEnvelopeEstimationProjection;
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
  readonly accounting?: PromptEnvelopeAccountingProjection;
  readonly releaseIfUnsent?: () => Promise<void>;
}

export interface PromptEnvelopeEstimate {
  readonly estimatedPromptTokens: number;
  readonly transmittedTokens?: number;
  readonly incrementalTokens?: number;
  readonly retainedBaselineTokens?: number;
  readonly effectiveTokens?: number;
  readonly statefulParentUsed?: boolean;
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

function validateEstimationProjection(
  projection: PromptEnvelopeEstimationProjection,
  field: string,
): void {
  if (typeof projection.legacyEstimate !== 'function') {
    throw new Error(
      `PromptEnvelopeEstimate validation failed: ${field}.legacyEstimate must be a function`,
    );
  }
}

function validateProjectionAccounting(
  projection: PromptEnvelopeProjection,
): void {
  const accounting = projection.accounting;
  if (accounting === undefined) return;
  if (typeof accounting.statefulParentUsed !== 'boolean') {
    throw new Error(
      'PromptEnvelopeEstimate validation failed: statefulParentUsed must be a boolean',
    );
  }
  if (accounting.retainedBaselineTokens !== undefined) {
    assertFiniteNonNegativeInt(
      accounting.retainedBaselineTokens,
      'retainedBaselineTokens',
    );
  }
  if (!accounting.statefulParentUsed) {
    if (
      accounting.retainedBaselineTokens !== undefined ||
      accounting.incremental !== undefined ||
      accounting.fullHistory !== undefined
    ) {
      throw new Error(
        'PromptEnvelopeEstimate validation failed: stateless accounting cannot carry retained or continuation projections',
      );
    }
    return;
  }
  if (accounting.incremental === undefined) {
    throw new Error(
      'PromptEnvelopeEstimate validation failed: stateful accounting requires an incremental projection',
    );
  }
  validateEstimationProjection(
    accounting.incremental,
    'accounting.incremental',
  );
  if (accounting.fullHistory !== undefined) {
    validateEstimationProjection(
      accounting.fullHistory,
      'accounting.fullHistory',
    );
  }
  if (
    accounting.retainedBaselineTokens === undefined &&
    accounting.fullHistory === undefined
  ) {
    throw new Error(
      'PromptEnvelopeEstimate validation failed: stateful accounting without observed usage requires a full-history projection',
    );
  }
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
  validateProjectionAccounting(projection);
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

async function estimateProjection(
  activeProvider: string,
  projection: PromptEnvelopeProjection,
  estimationProjection: PromptEnvelopeEstimationProjection,
  factory: RuntimeTokenizerFactory,
): Promise<Awaited<ReturnType<RuntimeTokenizerFactory['estimatePrompt']>>> {
  const result = await factory.estimatePrompt({
    activeProvider,
    canonicalModel: projection.model,
    protocol: projection.protocol,
    wireMethod: projection.method,
    finalizedProjection: estimationProjection.finalizedProjection,
    projectionRevision: projection.projectionRevision,
    legacyEstimate: estimationProjection.legacyEstimate,
  });
  validateResult(projection, result);
  return result;
}

export async function estimatePromptEnvelope(
  activeProvider: string,
  projection: PromptEnvelopeProjection,
  factory: RuntimeTokenizerFactory,
): Promise<PromptEnvelopeEstimate> {
  const unsupportedMedia = validateProjection(activeProvider, projection);
  const wireResult = await estimateProjection(
    activeProvider,
    projection,
    projection,
    factory,
  );
  const accounting = projection.accounting;
  let incrementalTokens = wireResult.count;
  let retainedBaselineTokens = 0;
  let effectiveTokens = wireResult.count;
  let effectiveResult = wireResult;
  if (accounting?.statefulParentUsed === true) {
    const incremental = accounting.incremental;
    if (incremental === undefined) {
      throw new Error(
        'PromptEnvelopeEstimate validation failed: stateful accounting requires an incremental projection',
      );
    }
    const incrementalResult = await estimateProjection(
      activeProvider,
      projection,
      incremental,
      factory,
    );
    incrementalTokens = incrementalResult.count;
    if (accounting.retainedBaselineTokens !== undefined) {
      retainedBaselineTokens = accounting.retainedBaselineTokens;
      effectiveTokens = retainedBaselineTokens + incrementalTokens;
      effectiveResult = incrementalResult;
    } else {
      const fullHistory = accounting.fullHistory;
      if (fullHistory === undefined) {
        throw new Error(
          'PromptEnvelopeEstimate validation failed: stateful accounting without observed usage requires a full-history projection',
        );
      }
      const fullHistoryResult = await estimateProjection(
        activeProvider,
        projection,
        fullHistory,
        factory,
      );
      effectiveTokens = fullHistoryResult.count;
      if (effectiveTokens < incrementalTokens) {
        throw new Error(
          `PromptEnvelopeEstimate validation failed: full-history estimate (${effectiveTokens}) is smaller than the incremental estimate (${incrementalTokens})`,
        );
      }
      retainedBaselineTokens = effectiveTokens - incrementalTokens;
      effectiveResult = fullHistoryResult;
    }
  }
  return Object.freeze({
    estimatedPromptTokens: effectiveTokens,
    transmittedTokens: wireResult.count,
    incrementalTokens,
    retainedBaselineTokens,
    effectiveTokens,
    statefulParentUsed: accounting?.statefulParentUsed ?? false,
    activeProvider,
    model: projection.model,
    protocol: projection.protocol,
    method: projection.method,
    estimatorMethod: effectiveResult.method,
    estimatorFamily: effectiveResult.family,
    estimatorVersion: effectiveResult.estimatorVersion,
    assetRevision: effectiveResult.assetRevision,
    projectionRevision: projection.projectionRevision,
    unsupportedMedia,
  });
}
