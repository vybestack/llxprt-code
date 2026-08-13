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
  readonly protocols: ReadonlySet<PromptEnvelopeProtocol>;
  readonly identityErrorHint: string;
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
    identityErrorHint:
      'use a sanctioned GPT-5.6 base, sol, terra, or luna alias with latest or a valid date snapshot',
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

function createIdentityError(
  request: RuntimePromptEstimateRequest,
  registration: ModelPromptEstimatorRegistration,
): ModelPromptEstimatorError {
  return new ModelPromptEstimatorError(
    'unresolved-model-identity',
    {
      activeProvider: request.activeProvider,
      canonicalModel: request.canonicalModel,
      protocol: request.protocol,
      family: registration.family,
    },
    registration.identityErrorHint,
  );
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
      return {
        count: await request.legacyEstimate(),
        method: 'calibrated',
        family: 'legacy-unregistered',
        estimatorVersion: 'core-estimate-tokens-v1',
        assetRevision: 'none',
        projectionRevision: request.projectionRevision,
      };
    }
    if (!registration.matches(request.canonicalModel)) {
      throw createIdentityError(request, registration);
    }
    if (!registration.protocols.has(request.protocol)) {
      throw createProtocolError(request, registration);
    }
    return registration.estimate(request);
  }
}
