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
 * Coefficients are produced by `scripts/claude-estimator-calibration.ts` from
 * live provider `promptTokens` and are only valid for the recorded model,
 * protocol, base counter asset and projection revision.
 */

export const CLAUDE_5_ANTHROPIC_PROTOCOLS: ReadonlySet<PromptEnvelopeProtocol> =
  new Set<PromptEnvelopeProtocol>(['anthropic-messages']);

const OPUS_5_CALIBRATION_ID = 'claude-opus-5-o200k-calibrated-2026-08-03-v1';

export const CLAUDE_OPUS_5_ESTIMATOR_FAMILY = 'anthropic-claude-opus-5';
export const CLAUDE_FABLE_5_ESTIMATOR_FAMILY = 'anthropic-claude-fable-5';

export const CLAUDE_OPUS_5_CALIBRATION: ClaudeCalibration = Object.freeze({
  canonicalModelFamily: 'claude-opus-5',
  protocol: 'anthropic-messages',
  estimatorVersion: OPUS_5_CALIBRATION_ID,
  baseCounterAssetRevision: O200K_BASE_ASSET_REVISION,
  projectionRevision: PROJECTION_REVISION,
  /**
   * Zero. The corpus identifies a marginal content rate through
   * within-category deltas, in which any per-request constant cancels, so no
   * framing constant is estimable from it. Publishing an unidentifiable
   * intercept would be a fabricated number.
   */
  intercept: 0,
  baseTokenCoefficient: 0.944299,
  featureCoefficients: Object.freeze([
    Object.freeze({ feature: 'codePoints', coefficient: 0.153947 } as const),
  ]),
  heldOut: Object.freeze({
    sampleCount: 5,
    mapePercent: 5.820461,
    rmse: 38.084117,
    underestimationP95Percent: 17.266247,
    baselineEstimator: 'AnthropicTokenizer character heuristic',
    baselineMapePercent: 38.250059,
    baselineRmse: 271.463441,
    baselineUnderestimationP95Percent: 58.196217,
    relativeMapeImprovementPercent: 84.783132,
  }),
  provenance: Object.freeze({
    corpusId: 'claude-opus-5-provider-usage-v1',
    corpusObservations: 25,
    endpointHost: 'api.anthropic.com',
    groundTruth:
      'complete provider promptTokens including cached prompt tokens',
    fittedAt: '2026-08-03',
    modelSelection:
      'leave-one-category-out cross-validation across seven candidate feature sets',
  }),
});

/**
 * Why Claude Fable 5 has no calibrated registration.
 *
 * Fable 5 is a separate model with its own framing and tokenization rate.
 * Reusing Opus 5 coefficients for it would present an unmeasured guess as a
 * calibrated result, so Fable 5 stays on the existing generic path until it
 * has its own provider-ground-truth corpus and clears the activation gate on
 * that corpus.
 */
export const CLAUDE_FABLE_5_WITHHELD_REASON =
  'no trustworthy claude-fable-5 provider promptTokens observations exist yet; ' +
  'the activation gate cannot be evaluated and Opus 5 coefficients must not be borrowed';

export interface Claude5FamilySpec {
  readonly family: string;
  readonly canonicalModelFamily: string;
  readonly claim: RegExp;
  readonly matches: (model: string) => boolean;
  readonly protocols: ReadonlySet<PromptEnvelopeProtocol>;
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
      identityErrorHint:
        'use claude-fable-5, claude-fable-5-latest, or a claude-fable-5-YYYYMMDD snapshot with a real calendar date',
      calibration: undefined,
      withheldReason: CLAUDE_FABLE_5_WITHHELD_REASON,
    }),
  ]);

/**
 * A spec activates only when it carries a calibration that is internally
 * consistent and cleared the held-out gate. Everything else stays on the
 * pre-existing generic path rather than borrowing another model's numbers.
 */
export function isActivatedClaude5Spec(spec: Claude5FamilySpec): boolean {
  return (
    spec.calibration !== undefined &&
    isActivatableClaudeCalibration(spec.calibration)
  );
}
