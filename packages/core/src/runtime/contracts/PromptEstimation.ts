/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Core-owned structural contract for provider-neutral prompt-envelope
 * estimation (issue #2817).
 *
 * The agent layer asks the provider to *prepare* the finalized prompt attempt
 * ONCE. From that single preparation it derives both the estimate (token count
 * + identity) and the opaque request token that transport reuses — so
 * estimation and transport never independently rebuild the same request body.
 *
 * Core never embeds tokenizer or provider-payload knowledge. Providers own the
 * preparation representation and count tokens against it themselves.
 */

/**
 * The wire protocol family of the finalized prompt envelope.
 */
export type PromptEnvelopeProtocol =
  | 'anthropic-messages'
  | 'openai-chat'
  | 'openai-responses';

/**
 * The concrete wire method (and its version) that will carry the finalized
 * envelope.
 */
export type PromptEnvelopeMethod =
  | 'messages/v1'
  | 'chat/completions/v1'
  | 'responses/v1';

/**
 * A single piece of media the provider cannot forward to the model.
 *
 * Surfaced explicitly so callers know the finalized envelope omits or replaces
 * that media (acceptance A9).
 */
export interface UnsupportedMediaEntry {
  readonly kind: 'unsupported';
  readonly reason: string;
  readonly mediaType?: string;
}

/**
 * Provider-implemented projection seam: exposes the finalized prompt
 * envelope's identity and a token count computed against the provider's own
 * finalized preparation representation — WITHOUT exposing raw prompt material.
 */
export interface PromptEnvelopeProjection {
  readonly model: string;
  readonly protocol: PromptEnvelopeProtocol;
  readonly method: PromptEnvelopeMethod;
  readonly projectionRevision: number;
  readonly unsupportedMedia: readonly UnsupportedMediaEntry[];
  readonly transportToken: object;
  /**
   * Count prompt tokens against the provider's own finalized representation.
   */
  readonly countProjectedTokens: () => Promise<number>;
}

/**
 * The provider-neutral estimate result. Carries the token count and envelope
 * identity but NO raw prompt payload.
 */
export interface PromptEnvelopeEstimate {
  readonly estimatedPromptTokens: number;
  readonly model: string;
  readonly protocol: PromptEnvelopeProtocol;
  readonly method: PromptEnvelopeMethod;
  readonly projectionRevision: number;
  readonly unsupportedMedia: readonly UnsupportedMediaEntry[];
}

function assertNonEmptyString(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `PromptEnvelopeEstimate validation failed: ${field} must be a non-empty string`,
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

/**
 * Derive a {@link PromptEnvelopeEstimate} from a projection by asking the
 * provider to count tokens against its finalized representation. The result is
 * validated and frozen so callers receive an immutable value.
 */
export async function estimatePromptEnvelope(
  projection: PromptEnvelopeProjection,
): Promise<PromptEnvelopeEstimate> {
  assertNonEmptyString(projection.model, 'model');
  assertNonEmptyString(projection.protocol, 'protocol');
  assertNonEmptyString(projection.method, 'method');
  assertFiniteNonNegativeInt(
    projection.projectionRevision,
    'projectionRevision',
  );

  const validatedUnsupportedMedia = validateUnsupportedMedia(
    projection.unsupportedMedia,
  );

  const estimatedPromptTokens = await projection.countProjectedTokens();
  assertFiniteNonNegativeInt(estimatedPromptTokens, 'estimatedPromptTokens');

  const estimate: PromptEnvelopeEstimate = {
    estimatedPromptTokens,
    model: projection.model,
    protocol: projection.protocol,
    method: projection.method,
    projectionRevision: projection.projectionRevision,
    unsupportedMedia: validatedUnsupportedMedia,
  };
  return Object.freeze(estimate);
}
