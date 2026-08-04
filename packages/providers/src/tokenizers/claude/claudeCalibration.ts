/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PromptEnvelopeProtocol } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import {
  CLAUDE_CONTENT_FEATURE_NAMES,
  type ClaudeContentFeatureName,
  type ClaudeContentFeatures,
} from './claudeContentFeatures.js';

/**
 * Held-out evidence that justified activating a calibration.
 *
 * `underestimationP95Percent` is the 95th percentile of `max(0, (actual -
 * predicted) / actual)`: overestimates contribute zero, so the statistic only
 * grows when an estimator claims a prompt is smaller than it really is.
 */
export interface ClaudeCalibrationHeldOut {
  readonly sampleCount: number;
  readonly mapePercent: number;
  readonly rmse: number;
  readonly underestimationP95Percent: number;
  readonly baselineEstimator: string;
  readonly baselineMapePercent: number;
  readonly baselineRmse: number;
  readonly baselineUnderestimationP95Percent: number;
  readonly relativeMapeImprovementPercent: number;
}

export interface ClaudeCalibrationProvenance {
  readonly corpusId: string;
  readonly corpusObservations: number;
  readonly endpointHost: string;
  readonly groundTruth: string;
  readonly fittedAt: string;
  readonly modelSelection: string;
}

export interface ClaudeFeatureCoefficient {
  readonly feature: ClaudeContentFeatureName;
  readonly coefficient: number;
}

/**
 * An immutable, model-scoped correction from a base-counter reading to a
 * predicted provider prompt-token count.
 *
 * A calibration is only valid for the exact tuple it records: canonical model,
 * wire protocol, estimator version, base counter asset and finalized
 * request-projection revision. Any of those changing invalidates it.
 */
export interface ClaudeCalibration {
  readonly canonicalModelFamily: string;
  readonly protocol: PromptEnvelopeProtocol;
  readonly estimatorVersion: string;
  readonly baseCounterAssetRevision: string;
  readonly projectionRevision: number;
  readonly intercept: number;
  readonly baseTokenCoefficient: number;
  readonly featureCoefficients: readonly ClaudeFeatureCoefficient[];
  readonly heldOut: ClaudeCalibrationHeldOut;
  readonly provenance: ClaudeCalibrationProvenance;
}

/**
 * The part of a calibration that turns a reading into a count. Narrowing the
 * application contract to this keeps the fitting tool and the runtime using
 * one implementation without the tool having to invent held-out metrics
 * before it has computed them.
 */
export type ClaudeCalibrationCoefficients = Pick<
  ClaudeCalibration,
  'intercept' | 'baseTokenCoefficient' | 'featureCoefficients'
>;

/** Minimum relative held-out MAPE improvement required to activate (AC5). */
export const CLAUDE_ACTIVATION_MIN_RELATIVE_MAPE_IMPROVEMENT_PERCENT = 10;

function isKnownFeature(name: string): name is ClaudeContentFeatureName {
  return (CLAUDE_CONTENT_FEATURE_NAMES as readonly string[]).includes(name);
}

/**
 * Whether a calibration is internally consistent and cleared the activation
 * gate. Assets are validated at module load so a mis-edited coefficient table
 * fails immediately rather than silently shipping an unjustified estimate.
 */
function hasUsableCoefficients(calibration: ClaudeCalibration): boolean {
  return (
    Number.isFinite(calibration.intercept) &&
    Number.isFinite(calibration.baseTokenCoefficient) &&
    calibration.featureCoefficients.every(
      (entry) =>
        isKnownFeature(entry.feature) && Number.isFinite(entry.coefficient),
    )
  );
}

function clearsActivationGate(heldOut: ClaudeCalibrationHeldOut): boolean {
  if (heldOut.sampleCount <= 0) return false;
  if (
    heldOut.relativeMapeImprovementPercent <
    CLAUDE_ACTIVATION_MIN_RELATIVE_MAPE_IMPROVEMENT_PERCENT
  ) {
    return false;
  }
  return (
    heldOut.underestimationP95Percent <=
    heldOut.baselineUnderestimationP95Percent
  );
}

export function isActivatableClaudeCalibration(
  calibration: ClaudeCalibration,
): boolean {
  return (
    hasUsableCoefficients(calibration) &&
    clearsActivationGate(calibration.heldOut)
  );
}

/**
 * Apply a calibration to one base-counter reading and its content features.
 *
 * Pure, deterministic and allocation-free. An empty prompt yields exactly 0:
 * the intercept models per-request framing that only exists when there is a
 * request, so it is not added to nothing.
 */
export function applyClaudeCalibration(
  baseTokens: number,
  features: ClaudeContentFeatures,
  calibration: ClaudeCalibrationCoefficients,
): number {
  if (baseTokens === 0 && features.codePoints === 0) return 0;
  let total =
    calibration.intercept + calibration.baseTokenCoefficient * baseTokens;
  for (const entry of calibration.featureCoefficients) {
    total += entry.coefficient * features[entry.feature];
  }
  return total <= 0 ? 0 : Math.round(total);
}
