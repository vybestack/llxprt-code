/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  RuntimePromptEstimateRequest,
  RuntimePromptEstimateResult,
} from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import type { RuntimeTokenizer } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizer.js';
import type { PromptEnvelopeProtocol } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { estimateImageTokens } from '@vybestack/llxprt-code-tools/utils/imageTokenEstimation.js';
import { rm } from 'node:fs/promises';
import { NativeAnthropicEstimateProjection } from '../../anthropic/native-anthropic-estimate.js';
import type { ProviderFinalizedPromptProjection } from '../../runtime/promptEnvelopeProjections.js';
import {
  ModelPromptEstimatorError,
  type ModelPromptEstimatorErrorContext,
} from '../ModelPromptEstimatorError.js';
import type { ModelPromptEstimatorRegistration } from '../ModelPromptEstimatorRegistry.js';
import {
  countO200kBaseTokens,
  getO200kBaseEncoder,
  loadTiktokenModule,
  type O200kBaseEncoder,
  type O200kBaseEncoderResolver,
  type TiktokenModuleLoader,
} from '../o200kBaseCounter.js';
import {
  applyClaudeCalibration,
  applyClaudeMarginalCalibration,
} from './claudeCalibration.js';
import type { ClaudeCalibration } from './claudeCalibration.js';
import {
  addClaudeContentFeatures,
  extractClaudeContentFeatures,
  type ClaudeContentFeatureExtractor,
  type ClaudeContentFeatures,
} from './claudeContentFeatures.js';
import { countO200kBaseTokensChunked } from '../o200k-chunked-source.js';
import { SourceFamilyInput, spoolPromptText } from '../source-family-input.js';
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

const BASE_COUNTER_ASSET_REMEDIATION =
  'verify the local @dqbd/tiktoken o200k_base base-counter assets are installed and intact';

function errorContext(
  request: RuntimePromptEstimateRequest,
  family: string,
): ModelPromptEstimatorErrorContext {
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
):
  | ProviderFinalizedPromptProjection
  | SourceFamilyInput
  | NativeAnthropicEstimateProjection {
  const source = request.finalizedProjection;
  if (
    source instanceof NativeAnthropicEstimateProjection &&
    source.protocol === request.protocol
  )
    return source;
  if (
    source instanceof SourceFamilyInput &&
    source.projection.protocol === request.protocol
  ) {
    return source;
  }
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

interface MeasuredPrompt {
  readonly baseTokens: number;
  readonly features: ClaudeContentFeatures;
  readonly imageTokens: number;
}

type O200kEncoder = Awaited<ReturnType<typeof getO200kBaseEncoder>>;

/** One base tokenization and one feature scan over the projection text. */
function measureProjection(
  projection: ProviderFinalizedPromptProjection,
  request: RuntimePromptEstimateRequest,
  encoder: O200kEncoder,
  extractFeatures: ClaudeContentFeatureExtractor,
): MeasuredPrompt {
  const { promptText } = projection;
  let imageTokens = 0;
  for (const entry of projection.imageEntries ?? []) {
    imageTokens += estimateImageTokens({
      provider: request.activeProvider,
      model: request.canonicalModel,
      dimensions: entry.dimensions,
    });
  }
  return {
    baseTokens: countO200kBaseTokens(encoder, promptText),
    features: extractFeatures(promptText),
    imageTokens,
  };
}

const NO_FEATURES: ClaudeContentFeatures = Object.freeze({
  codePoints: 0,
  nonAsciiCodePoints: 0,
  structuralCodePoints: 0,
  whitespaceCodePoints: 0,
});

/**
 * The same measurements over sealed prompt segments. The prompt text is
 * spooled to a scratch file piece by piece (a piece never splits a code
 * point, so the additive signals sum to the signals of the whole text) and
 * counted by the chunked o200k counter, so the text is never one string.
 */
async function measureSource(
  source: SourceFamilyInput,
  request: RuntimePromptEstimateRequest,
  encoder: O200kEncoder,
  extractFeatures: ClaudeContentFeatureExtractor,
): Promise<MeasuredPrompt> {
  let features = NO_FEATURES;
  const spool = await spoolPromptText(source, (piece) => {
    features = addClaudeContentFeatures(features, extractFeatures(piece));
  });
  try {
    return {
      baseTokens: await countO200kBaseTokensChunked(
        { path: spool.path },
        encoder,
        {
          workspaceDirectory: source.workspaceDirectory,
          signal: source.signal,
        },
      ),
      features,
      imageTokens: await source.countImageTokens({
        provider: request.activeProvider,
        model: request.canonicalModel,
      }),
    };
  } finally {
    await rm(spool.directory, { recursive: true, force: true });
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
      BASE_COUNTER_ASSET_REMEDIATION,
      { cause: error },
    );
  }

  try {
    let measured: MeasuredPrompt;
    if (projection instanceof NativeAnthropicEstimateProjection)
      measured = await projection.measure(request, encoder, extractFeatures);
    else if (projection instanceof SourceFamilyInput)
      measured = await measureSource(
        projection,
        request,
        encoder,
        extractFeatures,
      );
    else
      measured = measureProjection(
        projection,
        request,
        encoder,
        extractFeatures,
      );
    let count = applyClaudeCalibration(
      measured.baseTokens,
      measured.features,
      calibration,
    );
    // Image cost is added post-calibration because the anthropic formula
    // already returns provider-billed image tokens and the coefficients are
    // text-fitted; scaling them here would shrink the billed cost (issue
    // #3663).
    count += measured.imageTokens;
    return {
      count,
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

function acceptsModelIdentity(
  spec: Claude5FamilySpec,
  canonicalModel: string,
): boolean {
  return (
    spec.matches(canonicalModel) ||
    (spec.matchesPointRelease?.(canonicalModel) ?? false)
  );
}

/**
 * Per-entry token counter for incremental history accounting.
 *
 * Uses the same calibration as the pre-send estimate but in its marginal form,
 * because a history entry carries content, not the per-request framing the
 * intercept models. Point releases are counted with their family's marginal
 * calibration, matching how their envelope is estimated. Returns undefined
 * for anything this family has not measured, so unclaimed models keep their
 * existing counter rather than receiving coefficients fitted elsewhere.
 */
export function createClaudeRuntimeTokenizer(
  activeProvider: string,
  canonicalModel: string,
  resolveEncoder: O200kBaseEncoderResolver = () => getO200kBaseEncoder(),
): RuntimeTokenizer | undefined {
  const spec = CLAUDE_5_FAMILY_SPECS.find(
    (candidate) =>
      candidate.claim.test(canonicalModel) &&
      acceptsModelIdentity(candidate, canonicalModel) &&
      candidate.appliesToProvider(activeProvider),
  );
  const calibration = spec?.calibration;
  if (spec === undefined || calibration === undefined) return undefined;
  const context: ModelPromptEstimatorErrorContext = {
    activeProvider,
    canonicalModel,
    protocol: 'anthropic-messages',
    family: spec.family,
  };
  return {
    fallbackPolicy: 'deny',
    async countTokens(content: unknown): Promise<number> {
      const text = serializeRuntimeTokenizerInput(content, context);
      let encoder: O200kBaseEncoder;
      try {
        encoder = await resolveEncoder();
      } catch (error) {
        throw new ModelPromptEstimatorError(
          'asset-unavailable',
          context,
          BASE_COUNTER_ASSET_REMEDIATION,
          { cause: error },
        );
      }
      try {
        return applyClaudeMarginalCalibration(
          countO200kBaseTokens(encoder, text),
          extractClaudeContentFeatures(text),
          calibration,
        );
      } catch (error) {
        throw new ModelPromptEstimatorError(
          'tokenization-failed',
          context,
          'verify the history entry and retry with intact local base-counter assets',
          { cause: error },
        );
      }
    },
  };
}

function serializeRuntimeTokenizerInput(
  content: unknown,
  context: ModelPromptEstimatorErrorContext,
): string {
  const remediation =
    'provide string or JSON-serializable content to the runtime tokenizer';
  if (typeof content === 'string') return content;
  let text: string | undefined;
  try {
    text = JSON.stringify(content);
  } catch (error) {
    throw new ModelPromptEstimatorError(
      'tokenization-failed',
      context,
      remediation,
      { cause: error },
    );
  }
  if (typeof text !== 'string') {
    throw new ModelPromptEstimatorError(
      'tokenization-failed',
      context,
      remediation,
    );
  }
  return text;
}

function toRegistration(
  spec: Claude5FamilySpec,
): ModelPromptEstimatorRegistration {
  return Object.freeze({
    family: spec.family,
    claim: spec.claim,
    matches: spec.matches,
    matchesPointRelease: spec.matchesPointRelease,
    protocols: spec.protocols,
    appliesToProvider: spec.appliesToProvider,
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
