/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Core-owned structural contract for tokenizer factory injection.
 *
 * CLI/providers runtime supplies a factory that returns the correct
 * RuntimeTokenizer for a given provider + model combination.
 * Core never imports or constructs provider tokenizer types.
 *
 * @plan:PLAN-20260603-ISSUE1584.P03
 * @requirement:REQ-DEP-001
 * @pseudocode component-boundaries.md C-CB-01, lines 10-15
 */

import type { RuntimeTokenizer } from './RuntimeTokenizer.js';
import type {
  PromptEnvelopeMethod,
  PromptEnvelopeProtocol,
} from './PromptEstimation.js';

export type RuntimePromptEstimateMethod = 'exact' | 'calibrated';

export interface RuntimePromptEstimateRequest {
  readonly activeProvider: string;
  readonly canonicalModel: string;
  readonly protocol: PromptEnvelopeProtocol;
  readonly wireMethod: PromptEnvelopeMethod;
  readonly finalizedProjection: unknown;
  readonly projectionRevision: number;
  readonly legacyEstimate: () => Promise<number>;
}

export interface RuntimePromptEstimateResult {
  readonly count: number;
  readonly method: RuntimePromptEstimateMethod;
  readonly family: string;
  readonly estimatorVersion: string;
  readonly assetRevision: string;
  readonly projectionRevision: number;
}

/**
 * Factory contract for obtaining a tokenizer for a given provider and model.
 *
 * CLI constructs a factory that maps provider names to concrete tokenizer
 * implementations from the providers package. Core HistoryService accepts
 * this factory to obtain tokenizers without importing provider code.
 *
 * @plan:PLAN-20260603-ISSUE1584.P03
 * @requirement:REQ-DEP-001
 */
export interface RuntimeTokenizerFactory {
  getTokenizer(
    providerName: string,
    model?: string,
  ): RuntimeTokenizer | undefined;
  estimatePrompt(
    request: RuntimePromptEstimateRequest,
  ): Promise<RuntimePromptEstimateResult>;
  claimsModel?(canonicalModel: string): boolean;
  getEstimatorFamily?(canonicalModel: string): string | undefined;
}
