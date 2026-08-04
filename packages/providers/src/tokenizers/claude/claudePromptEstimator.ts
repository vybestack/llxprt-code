/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  RuntimePromptEstimateRequest,
  RuntimePromptEstimateResult,
} from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import type { PromptEnvelopeProtocol } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { ProviderFinalizedPromptProjection } from '../../runtime/promptEnvelopeProjections.js';
import { ModelPromptEstimatorError } from '../ModelPromptEstimatorError.js';
import type { ModelPromptEstimatorRegistration } from '../ModelPromptEstimatorRegistry.js';
import {
  countO200kBaseTokens,
  getO200kBaseEncoder,
  loadTiktokenModule,
  type TiktokenModuleLoader,
} from '../o200kBaseCounter.js';
import { applyClaudeCalibration } from './claudeCalibration.js';
import type { ClaudeCalibration } from './claudeCalibration.js';
import {
  extractClaudeContentFeatures,
  type ClaudeContentFeatureExtractor,
} from './claudeContentFeatures.js';
import {
  CLAUDE_5_FAMILY_SPECS,
  isActivatedClaude5Spec,
  type Claude5FamilySpec,
} from './claudeCalibrationAssets.js';

/**
 * Calibrated local prompt estimation for the Claude 5 family.
 *
 * One base tokenization and one feature scan, both over the same finalized
 * projection text. The base counter never varies with content, so no input can
 * cause a different tokenizer to be chosen, and results are always reported as
 * calibrated rather than exact.
 */

function errorContext(
  request: RuntimePromptEstimateRequest,
  family: string,
): ConstructorParameters<typeof ModelPromptEstimatorError>[1] {
  return {
    activeProvider: request.activeProvider,
    canonicalModel: request.canonicalModel,
    protocol: request.protocol,
    family,
  };
}

function isFinalizedPromptProjection(
  value: unknown,
  protocol: PromptEnvelopeProtocol,
): value is ProviderFinalizedPromptProjection {
  if (typeof value !== 'object' || value === null) return false;
  const projection = value as Partial<ProviderFinalizedPromptProjection>;
  return (
    projection.kind === 'llxprt-provider-prompt-v3' &&
    projection.protocol === protocol &&
    typeof projection.promptText === 'string'
  );
}

function readProjection(
  request: RuntimePromptEstimateRequest,
  family: string,
): ProviderFinalizedPromptProjection {
  if (
    !isFinalizedPromptProjection(request.finalizedProjection, request.protocol)
  ) {
    throw new ModelPromptEstimatorError(
      'projection-unavailable',
      errorContext(request, family),
      'rebuild the finalized provider projection with the active protocol',
    );
  }
  return request.finalizedProjection;
}

/**
 * A calibration is fitted against one finalized projection revision. Applying
 * it to a differently shaped projection would silently attribute the shape
 * change to the model, so the mismatch is surfaced instead.
 */
function assertProjectionRevision(
  request: RuntimePromptEstimateRequest,
  calibration: ClaudeCalibration,
  family: string,
): void {
  if (request.projectionRevision !== calibration.projectionRevision) {
    throw new ModelPromptEstimatorError(
      'asset-unavailable',
      errorContext(request, family),
      `recalibrate this family: the calibration was fitted for projection revision ${calibration.projectionRevision}, not ${request.projectionRevision}`,
    );
  }
}

export interface Claude5EstimatorSeams {
  readonly loadModule?: TiktokenModuleLoader;
  readonly extractFeatures?: ClaudeContentFeatureExtractor;
}

export async function estimateClaude5Prompt(
  request: RuntimePromptEstimateRequest,
  spec: Claude5FamilySpec,
  seams: Claude5EstimatorSeams = {},
): Promise<RuntimePromptEstimateResult> {
  const loadModule = seams.loadModule ?? loadTiktokenModule;
  const extractFeatures = seams.extractFeatures ?? extractClaudeContentFeatures;
  const calibration = spec.calibration;
  if (calibration === undefined) {
    throw new ModelPromptEstimatorError(
      'asset-unavailable',
      errorContext(request, spec.family),
      spec.withheldReason ?? 'no calibration is available for this model',
    );
  }
  const projection = readProjection(request, spec.family);
  assertProjectionRevision(request, calibration, spec.family);

  let encoder;
  try {
    encoder = await getO200kBaseEncoder(loadModule);
  } catch (error) {
    throw new ModelPromptEstimatorError(
      'asset-unavailable',
      errorContext(request, spec.family),
      'verify the local @dqbd/tiktoken o200k_base base-counter assets are installed and intact',
      { cause: error },
    );
  }

  try {
    const promptText = projection.promptText;
    const baseTokens = countO200kBaseTokens(encoder, promptText);
    const features = extractFeatures(promptText);
    return {
      count: applyClaudeCalibration(baseTokens, features, calibration),
      method: 'calibrated',
      family: spec.family,
      estimatorVersion: calibration.estimatorVersion,
      assetRevision: `${calibration.baseCounterAssetRevision}+calibration:${calibration.estimatorVersion}`,
      projectionRevision: request.projectionRevision,
    };
  } catch (error) {
    if (error instanceof ModelPromptEstimatorError) throw error;
    throw new ModelPromptEstimatorError(
      'tokenization-failed',
      errorContext(request, spec.family),
      'verify the finalized projection and retry with intact local base-counter assets',
      { cause: error },
    );
  }
}

function toRegistration(
  spec: Claude5FamilySpec,
): ModelPromptEstimatorRegistration {
  return Object.freeze({
    family: spec.family,
    claim: spec.claim,
    matches: spec.matches,
    protocols: spec.protocols,
    appliesToProvider: spec.appliesToProvider,
    identityErrorHint: spec.identityErrorHint,
    estimate: (request: RuntimePromptEstimateRequest) =>
      estimateClaude5Prompt(request, spec),
  });
}

/**
 * Only models whose calibration cleared the activation gate are registered.
 * A model without an activatable calibration is deliberately left unclaimed so
 * it keeps its existing behavior instead of inheriting another model's
 * coefficients.
 */
export const CLAUDE_5_PROMPT_ESTIMATOR_REGISTRATIONS: readonly ModelPromptEstimatorRegistration[] =
  Object.freeze(
    CLAUDE_5_FAMILY_SPECS.filter(isActivatedClaude5Spec).map(toRegistration),
  );
