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
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { isSanctionedGpt56Model } from '../openai/openaiModelPolicy.js';
import {
  createGpt56PromptEstimator,
  estimateGpt56Prompt,
  GPT_56_ESTIMATOR_FAMILY,
} from './Gpt56O200kPromptEstimator.js';
import { ModelPromptEstimatorError } from './ModelPromptEstimatorError.js';
import type { O200kBaseEncoderResolver } from './o200kBaseCounter.js';

export interface ModelPromptEstimatorRegistration {
  readonly family: string;
  readonly claim: RegExp;
  readonly matches: (model: string) => boolean;
  /**
   * Optional rule recognizing a *point release* of the family: a claimed
   * model that is not a sanctioned identity but is close enough to inherit
   * the family's estimate (with an explicit warning) instead of falling back
   * to the legacy heuristic.
   */
  readonly matchesPointRelease?: (model: string) => boolean;
  readonly protocols: ReadonlySet<PromptEnvelopeProtocol>;
  /**
   * Optional active-provider restriction.
   *
   * Exact-codec families are properties of the model and apply wherever the
   * model is served, so they omit this. A *calibrated* family is fitted
   * against one provider's request framing and is only valid there, so it
   * declares the providers it was measured on. A request from any other
   * provider is left unclaimed and keeps its existing estimation path rather
   * than receiving another endpoint's coefficients.
   */
  readonly appliesToProvider?: (activeProvider: string) => boolean;
  readonly estimate: (
    request: RuntimePromptEstimateRequest,
  ) => Promise<RuntimePromptEstimateResult>;
}

export const GPT_56_PROMPT_ESTIMATOR_REGISTRATION: ModelPromptEstimatorRegistration =
  Object.freeze({
    family: GPT_56_ESTIMATOR_FAMILY,
    claim: /^gpt-(?:0*5\.0*6)(?:$|-)/,
    matches: isSanctionedGpt56Model,
    protocols: new Set<PromptEnvelopeProtocol>([
      'openai-chat',
      'openai-responses',
    ]),
    estimate: estimateGpt56Prompt,
  });

/**
 * Bind the GPT-5.6 estimator registration to a factory-owned encoder resolver.
 *
 * Claim, identity, protocol, and provider-applicability policy are identical
 * to the process-wide {@link GPT_56_PROMPT_ESTIMATOR_REGISTRATION}; only the
 * encoder resolution is rebound. A composition root that injects a loader
 * uses this so its final prompt-envelope estimation shares one encoder with
 * readiness and runtime tokenization instead of falling back to the
 * process-wide encoder.
 */
export function createGpt56PromptEstimatorRegistration(
  resolveEncoder: O200kBaseEncoderResolver,
): ModelPromptEstimatorRegistration {
  return Object.freeze({
    ...GPT_56_PROMPT_ESTIMATOR_REGISTRATION,
    estimate: createGpt56PromptEstimator(resolveEncoder),
  });
}

export const DEFAULT_MODEL_PROMPT_ESTIMATOR_REGISTRATIONS = Object.freeze([
  GPT_56_PROMPT_ESTIMATOR_REGISTRATION,
]);

/**
 * Build the default estimator registration list bound to a composition-root
 * encoder resolver.
 *
 * Every entry in {@link DEFAULT_MODEL_PROMPT_ESTIMATOR_REGISTRATIONS} is
 * retained as-is except the GPT-5.6 entry, which is replaced with a
 * resolver-bound version so readiness, runtime tokenization, and final
 * prompt-envelope estimation share one encoder. This prevents future
 * divergence: adding a new default registration to the frozen list
 * automatically flows into every composition root that calls this helper,
 * without touching the factory.
 */
export function createDefaultEstimatorRegistrations(
  resolveEncoder: O200kBaseEncoderResolver,
  baseRegistrations: readonly ModelPromptEstimatorRegistration[] = DEFAULT_MODEL_PROMPT_ESTIMATOR_REGISTRATIONS,
): readonly ModelPromptEstimatorRegistration[] {
  return Object.freeze(
    baseRegistrations.map((registration) =>
      registration.family === GPT_56_ESTIMATOR_FAMILY
        ? createGpt56PromptEstimatorRegistration(resolveEncoder)
        : registration,
    ),
  );
}

function findClaim(
  canonicalModel: string,
  registrations: readonly ModelPromptEstimatorRegistration[],
): ModelPromptEstimatorRegistration | undefined {
  return registrations.find((registration) =>
    registration.claim.test(canonicalModel),
  );
}

function appliesToRequest(
  registration: ModelPromptEstimatorRegistration,
  request: RuntimePromptEstimateRequest,
): boolean {
  return registration.appliesToProvider?.(request.activeProvider) ?? true;
}

const degradationLogger = new DebugLogger('llxprt:model-prompt-estimator');

/**
 * Degradation warnings fire once per provider+model per process: the first
 * estimate for a pair tells the user their token counts may be off, and
 * repeating that on every request would only bury it in noise.
 */
const warnedDegradations = new Set<string>();

function warnDegradationOnce(
  request: RuntimePromptEstimateRequest,
  detail: string,
): void {
  const key = `${request.activeProvider}:${request.canonicalModel}`;
  if (warnedDegradations.has(key)) return;
  warnedDegradations.add(key);
  degradationLogger.warn(
    `model ${request.canonicalModel} on provider ${request.activeProvider} ${detail}`,
  );
}

function warnPointReleaseOnce(
  request: RuntimePromptEstimateRequest,
  registration: ModelPromptEstimatorRegistration,
): void {
  warnDegradationOnce(
    request,
    `is not directly calibrated; applying ${registration.family} calibration until a dedicated calibration exists; estimates may be less accurate`,
  );
}

function warnLegacyFallbackOnce(
  request: RuntimePromptEstimateRequest,
  registration: ModelPromptEstimatorRegistration,
): void {
  warnDegradationOnce(
    request,
    `is not a sanctioned identity of ${registration.family}; falling back to the legacy estimate; token estimates may be inaccurate`,
  );
}

async function legacyEstimate(
  request: RuntimePromptEstimateRequest,
  family: string,
): Promise<RuntimePromptEstimateResult> {
  return {
    count: await request.legacyEstimate(),
    method: 'calibrated',
    family,
    estimatorVersion: 'core-estimate-tokens-v1',
    assetRevision: 'none',
    projectionRevision: request.projectionRevision,
  };
}

function createProtocolError(
  request: RuntimePromptEstimateRequest,
  registration: ModelPromptEstimatorRegistration,
): ModelPromptEstimatorError {
  return new ModelPromptEstimatorError(
    'unsupported-protocol',
    {
      activeProvider: request.activeProvider,
      canonicalModel: request.canonicalModel,
      protocol: request.protocol,
      family: registration.family,
    },
    `select one of the supported protocols for this family: ${[...registration.protocols].join(', ')}`,
  );
}

export class ModelPromptEstimatorRegistry {
  constructor(
    private readonly registrations: readonly ModelPromptEstimatorRegistration[] = DEFAULT_MODEL_PROMPT_ESTIMATOR_REGISTRATIONS,
  ) {}

  /**
   * Whether any registered family covers this model.
   *
   * Deliberately model-scoped: callers use it to label an estimator family in
   * diagnostics, where the model is the meaningful identity. Provider
   * applicability is enforced where it matters, at estimation time.
   */
  claimsModel(canonicalModel: string): boolean {
    return this.getEstimatorFamily(canonicalModel) !== undefined;
  }

  getEstimatorFamily(canonicalModel: string): string | undefined {
    return findClaim(canonicalModel, this.registrations)?.family;
  }

  async estimatePrompt(
    request: RuntimePromptEstimateRequest,
  ): Promise<RuntimePromptEstimateResult> {
    const claimed = findClaim(request.canonicalModel, this.registrations);
    const registration =
      claimed !== undefined && appliesToRequest(claimed, request)
        ? claimed
        : undefined;
    if (registration === undefined) {
      return legacyEstimate(request, 'legacy-unregistered');
    }
    if (!registration.matches(request.canonicalModel)) {
      // The registry sits on the request path, so an unresolved identity must
      // degrade, never throw: a point release inherits the family estimate,
      // anything else falls back to the legacy heuristic. Both warn once.
      if (registration.matchesPointRelease?.(request.canonicalModel) !== true) {
        warnLegacyFallbackOnce(request, registration);
        return legacyEstimate(request, 'legacy-unresolved-identity');
      }
      warnPointReleaseOnce(request, registration);
    }
    if (!registration.protocols.has(request.protocol)) {
      throw createProtocolError(request, registration);
    }
    return registration.estimate(request);
  }
}
