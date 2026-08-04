/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PromptEnvelopeProtocol } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { PROJECTION_REVISION } from '../../runtime/promptEnvelopeProjections.js';
import { O200K_BASE_ASSET_REVISION } from '../o200kBaseCounter.js';
import {
  isActivatableClaudeCalibration,
  type ClaudeCalibration,
} from './claudeCalibration.js';
import {
  CLAUDE_FABLE_5_CLAIM,
  CLAUDE_OPUS_5_CLAIM,
  isSanctionedClaudeFable5Model,
  isSanctionedClaudeOpus5Model,
} from './claudeModelIdentity.js';

/**
 * Immutable calibration assets for the Claude 5 estimator family.
 *
 * Anthropic does not publish the tokenizer for Claude 4.7 and later, so these
 * estimators are calibrated, never exact. The base counter is a pinned
 * `o200k_base` BPE asset used purely as a stable lexical yardstick; it is not
 * presented as, and is not, the Claude tokenizer, and no pre-4.7 Claude
 * vocabulary is used anywhere in this family.
 *
 * Each model is fitted and gated entirely within its own live corpus by
 * `scripts/claude-estimator-calibration.ts`. The two models arrive at very
 * similar coefficients, which is a finding about Anthropic's tokenization —
 * not a shared asset. Neither model's numbers are derived from, defaulted to,
 * or validated against the other's.
 */

export const CLAUDE_5_ANTHROPIC_PROTOCOLS: ReadonlySet<PromptEnvelopeProtocol> =
  new Set<PromptEnvelopeProtocol>(['anthropic-messages']);

export const CLAUDE_OPUS_5_ESTIMATOR_FAMILY = 'anthropic-claude-opus-5';
export const CLAUDE_FABLE_5_ESTIMATOR_FAMILY = 'anthropic-claude-fable-5';

export const CLAUDE_OPUS_5_CALIBRATION: ClaudeCalibration = Object.freeze({
  canonicalModelFamily: 'claude-opus-5',
  protocol: 'anthropic-messages',
  estimatorVersion: 'claude-opus-5-o200k-calibrated-2026-08-04-v1',
  baseCounterAssetRevision: O200K_BASE_ASSET_REVISION,
  projectionRevision: PROJECTION_REVISION,
  intercept: -1649.098251,
  baseTokenCoefficient: 0.657456,
  featureCoefficients: Object.freeze([
    Object.freeze({ feature: 'codePoints', coefficient: 0.231236 } as const),
    Object.freeze({
      feature: 'nonAsciiCodePoints',
      coefficient: 0.251193,
    } as const),
  ]),
  heldOut: Object.freeze({
    sampleCount: 13,
    mapePercent: 0.385796,
    rmse: 124.892877,
    underestimationP95Percent: 0.891037,
    baselineEstimator: 'AnthropicTokenizer character heuristic',
    baselineMapePercent: 33.542347,
    baselineRmse: 8854.35996,
    baselineUnderestimationP95Percent: 34.081849,
    relativeMapeImprovementPercent: 98.849823,
  }),
  provenance: Object.freeze({
    corpusId: 'claude-opus-5-provider-usage-v1',
    corpusObservations: 42,
    endpointHost: 'api.anthropic.com',
    groundTruth:
      'complete provider promptTokens including cached prompt tokens',
    fittedAt: '2026-08-04',
    modelSelection:
      'leave-one-category-out cross-validation over training rows only, across seven candidate feature sets',
    validatedBaseTokenRange: Object.freeze([15756, 20594] as const),
  }),
});

export const CLAUDE_FABLE_5_CALIBRATION: ClaudeCalibration = Object.freeze({
  canonicalModelFamily: 'claude-fable-5',
  protocol: 'anthropic-messages',
  estimatorVersion: 'claude-fable-5-o200k-calibrated-2026-08-04-v1',
  baseCounterAssetRevision: O200K_BASE_ASSET_REVISION,
  projectionRevision: PROJECTION_REVISION,
  intercept: -1658.009406,
  baseTokenCoefficient: 0.655462,
  featureCoefficients: Object.freeze([
    Object.freeze({ feature: 'codePoints', coefficient: 0.231865 } as const),
    Object.freeze({
      feature: 'nonAsciiCodePoints',
      coefficient: 0.251442,
    } as const),
  ]),
  heldOut: Object.freeze({
    sampleCount: 13,
    mapePercent: 0.389093,
    rmse: 125.934049,
    underestimationP95Percent: 0.895654,
    baselineEstimator: 'AnthropicTokenizer character heuristic',
    baselineMapePercent: 33.545883,
    baselineRmse: 8856.10434,
    baselineUnderestimationP95Percent: 34.088026,
    relativeMapeImprovementPercent: 98.840118,
  }),
  provenance: Object.freeze({
    corpusId: 'claude-fable-5-provider-usage-v1',
    corpusObservations: 42,
    endpointHost: 'api.anthropic.com',
    groundTruth:
      'complete provider promptTokens including cached prompt tokens',
    fittedAt: '2026-08-04',
    modelSelection:
      'leave-one-category-out cross-validation over training rows only, across seven candidate feature sets',
    validatedBaseTokenRange: Object.freeze([15756, 20594] as const),
  }),
});

/**
 * Providers whose Claude requests these calibrations were measured against.
 *
 * Both corpora were collected against `api.anthropic.com`. Both first-party
 * Anthropic aliases target that endpoint and therefore share its framing. An
 * Anthropic-compatible third-party endpoint frames requests differently and
 * must not silently receive these coefficients.
 */
export const CLAUDE_5_CALIBRATED_PROVIDERS: ReadonlySet<string> = new Set([
  'anthropic',
  'claudecode',
]);

export function isClaude5CalibratedProvider(activeProvider: string): boolean {
  return CLAUDE_5_CALIBRATED_PROVIDERS.has(activeProvider.toLowerCase());
}

export interface Claude5FamilySpec {
  readonly family: string;
  readonly canonicalModelFamily: string;
  readonly claim: RegExp;
  readonly matches: (model: string) => boolean;
  readonly protocols: ReadonlySet<PromptEnvelopeProtocol>;
  readonly appliesToProvider: (activeProvider: string) => boolean;
  readonly identityErrorHint: string;
  /** Absent when the model has no activatable calibration. */
  readonly calibration: ClaudeCalibration | undefined;
  /** Present exactly when `calibration` is absent. */
  readonly withheldReason: string | undefined;
}

export const CLAUDE_5_FAMILY_SPECS: readonly Claude5FamilySpec[] =
  Object.freeze([
    Object.freeze({
      family: CLAUDE_OPUS_5_ESTIMATOR_FAMILY,
      canonicalModelFamily: 'claude-opus-5',
      claim: CLAUDE_OPUS_5_CLAIM,
      matches: isSanctionedClaudeOpus5Model,
      protocols: CLAUDE_5_ANTHROPIC_PROTOCOLS,
      appliesToProvider: isClaude5CalibratedProvider,
      identityErrorHint:
        'use claude-opus-5, claude-opus-5-latest, or a claude-opus-5-YYYYMMDD snapshot with a real calendar date',
      calibration: CLAUDE_OPUS_5_CALIBRATION,
      withheldReason: undefined,
    }),
    Object.freeze({
      family: CLAUDE_FABLE_5_ESTIMATOR_FAMILY,
      canonicalModelFamily: 'claude-fable-5',
      claim: CLAUDE_FABLE_5_CLAIM,
      matches: isSanctionedClaudeFable5Model,
      protocols: CLAUDE_5_ANTHROPIC_PROTOCOLS,
      appliesToProvider: isClaude5CalibratedProvider,
      identityErrorHint:
        'use claude-fable-5, claude-fable-5-latest, or a claude-fable-5-YYYYMMDD snapshot with a real calendar date',
      calibration: CLAUDE_FABLE_5_CALIBRATION,
      withheldReason: undefined,
    }),
  ]);

/**
 * A spec activates only when it carries a calibration that is internally
 * consistent and cleared the held-out gate on its own corpus.
 *
 * A spec that declares no calibration is a deliberate withholding and stays on
 * the pre-existing generic path rather than borrowing another model's numbers.
 * A spec that *declares* a calibration which does not hold up is a corrupt
 * asset, so it throws at module load rather than quietly degrading to a
 * generic estimate that callers would read as normal.
 */
export function isActivatedClaude5Spec(spec: Claude5FamilySpec): boolean {
  if (spec.calibration === undefined) return false;
  if (!isActivatableClaudeCalibration(spec.calibration)) {
    throw new Error(
      `Claude calibration asset for ${spec.canonicalModelFamily} is inconsistent or does not clear the activation gate`,
    );
  }
  return true;
}
