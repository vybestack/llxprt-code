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
  estimateRowSourceTokens,
  type EstimationResult,
} from './loadBalancerTokenEstimator.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { collectContents } from '../utils/collectContents.js';
import { getRequestSignal } from '../utils/abortSignal.js';
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
  const requestRows = options.requestRows;
  if (requestRows !== undefined) {
    // Fold the neutral selection from its repeatable reader; the request is
    // never collected into an array just to be estimated.
    return estimateRowSourceTokens(
      {
        count: requestRows.count,
        open: () => requestRows.openReader(),
      },
      subProfile.providerName,
      model,
      { tokenizerFactory },
    );
  }
  return estimateRequestTokens(
    await collectContents(options.contents),
    subProfile.providerName,
    model,
    { tokenizerFactory },
  );
}

/**
 * Options whose history is the replacement selection. The selection stays
 * owned by whoever produced it; `contents` is its repeatable reader view bound
 * to the request signal.
 */
export function optionsWithRequestRows(
  options: GenerateChatOptions,
  rows: ProviderRequestSelection,
): GenerateChatOptions {
  const signal = getRequestSignal(options);
  return {
    ...options,
    contents: { [Symbol.asyncIterator]: () => rows.openReader(signal) },
    requestRows: rows,
    contentCount: rows.count,
  };
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
