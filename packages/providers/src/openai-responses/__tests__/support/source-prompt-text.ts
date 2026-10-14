/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { Gpt56SourceProjection } from '../../../tokenizers/gpt56-source-projection.js';
import { promptTextPieces } from '../../../tokenizers/source-family-input.js';

/**
 * The finalized prompt text of a Responses projection, read from the
 * prompt-key files the request is sent from.
 */
export async function sourcePromptText(
  projection: PromptEnvelopeProjection,
): Promise<string> {
  const finalized = projection.finalizedProjection;
  if (!(finalized instanceof Gpt56SourceProjection)) {
    throw new Error('Expected a disk-backed finalized prompt projection');
  }
  let text = '';
  for await (const piece of promptTextPieces(finalized)) text += piece;
  return text;
}
