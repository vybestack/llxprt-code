/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import type { GenerateChatOptions, IProvider } from '../IProvider.js';
import { ModelPromptEstimatorError } from '../tokenizers/ModelPromptEstimatorError.js';
import type {
  LoadBalancerSubProfile,
  ResolvedSubProfile,
} from './loadBalancerTypes.js';
import { estimateSelectedProviderPrompt } from './loadBalancerPromptEstimator.js';
import {
  estimateRequestTokens,
  type EstimationResult,
} from './loadBalancerTokenEstimator.js';
import { resolveSubProfileModel } from './subProfileHelpers.js';

export async function estimatePreparedPrompt(
  subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
  options: GenerateChatOptions,
  delegateProvider: IProvider,
  tokenizerFactory: RuntimeTokenizerFactory | undefined,
): Promise<EstimationResult> {
  const model = resolveSubProfileModel(subProfile);
  const projected =
    tokenizerFactory !== undefined
      ? await estimateSelectedProviderPrompt(
          delegateProvider,
          subProfile.providerName,
          options,
          tokenizerFactory,
        )
      : undefined;
  if (projected !== undefined) return projected;
  const estimatorFamily =
    tokenizerFactory?.getEstimatorFamily?.(model) ??
    (tokenizerFactory?.claimsModel?.(model) === true
      ? 'registered-model'
      : undefined);
  if (estimatorFamily !== undefined) {
    throw new ModelPromptEstimatorError(
      'projection-unavailable',
      {
        activeProvider: subProfile.providerName,
        canonicalModel: model,
        protocol: 'unknown',
        family: estimatorFamily,
      },
      'configure the selected provider to expose its finalized prompt projection',
    );
  }
  return estimateRequestTokens(
    options.contents,
    subProfile.providerName,
    model,
    { tokenizerFactory },
  );
}

export function optionsWithPromptProjection(
  options: GenerateChatOptions,
  result: EstimationResult,
): GenerateChatOptions {
  if (result.transportToken === undefined) return options;
  return {
    ...options,
    promptEnvelopeTransportToken: result.transportToken,
  };
}
