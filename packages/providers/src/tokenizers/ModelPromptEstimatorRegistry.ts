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
  estimateGpt56Prompt,
  GPT_56_ESTIMATOR_FAMILY,
} from './Gpt56O200kPromptEstimator.js';
import { ModelPromptEstimatorError } from './ModelPromptEstimatorError.js';

export interface ModelPromptEstimatorRegistration {
  readonly family: string;
  readonly claim: RegExp;
  readonly matches: (model: string) => boolean;
  readonly protocols: ReadonlySet<PromptEnvelopeProtocol>;
  readonly identityErrorHint: string;
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

  claimsModel(canonicalModel: string): boolean {
    return this.getEstimatorFamily(canonicalModel) !== undefined;
  }

  getEstimatorFamily(canonicalModel: string): string | undefined {
    return findClaim(canonicalModel, this.registrations)?.family;
  }

  async estimatePrompt(
    request: RuntimePromptEstimateRequest,
  ): Promise<RuntimePromptEstimateResult> {
    const registration = findClaim(request.canonicalModel, this.registrations);
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
