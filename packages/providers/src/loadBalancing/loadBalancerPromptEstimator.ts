/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import type { GenerateChatOptions, IProvider } from '../IProvider.js';

export interface LoadBalancerPromptEstimate {
  readonly tokens: number;
  readonly source: string;
  readonly transportToken: object;
}

export async function estimateSelectedProviderPrompt(
  provider: IProvider,
  activeProvider: string,
  options: GenerateChatOptions,
  tokenizerFactory: RuntimeTokenizerFactory,
): Promise<LoadBalancerPromptEstimate | undefined> {
  if (typeof provider.projectPromptEnvelope !== 'function') return undefined;
  const projection = await provider.projectPromptEnvelope(options);
  if (projection === undefined) return undefined;
  const estimate = await estimatePromptEnvelope(
    activeProvider,
    projection,
    tokenizerFactory,
  );
  return {
    tokens: estimate.estimatedPromptTokens,
    transportToken: projection.transportToken,
    source: [
      estimate.estimatorMethod,
      estimate.estimatorFamily,
      estimate.estimatorVersion,
      estimate.assetRevision,
      `projection-${estimate.projectionRevision}`,
    ].join(':'),
  };
}
