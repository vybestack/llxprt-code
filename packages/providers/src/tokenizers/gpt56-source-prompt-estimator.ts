/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  RuntimePromptEstimateRequest,
  RuntimePromptEstimateResult,
} from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';

import {
  GPT_56_ASSET_REVISION,
  GPT_56_ESTIMATOR_FAMILY,
  GPT_56_ESTIMATOR_VERSION,
  prepareGpt56RuntimeTokenizer,
} from './Gpt56O200kPromptEstimator.js';
import {
  Gpt56SourceProjection,
  type Gpt56SourceLease,
} from './gpt56-source-projection.js';
import { ModelPromptEstimatorError } from './ModelPromptEstimatorError.js';
import type {
  O200kDiskCountOptions,
  countO200kBaseTokensFromDiskSource,
} from './o200k-disk-source.js';

type DiskCounter = typeof countO200kBaseTokensFromDiskSource;

function failure(
  request: RuntimePromptEstimateRequest,
  code: 'asset-unavailable' | 'tokenization-failed',
  cause?: unknown,
): ModelPromptEstimatorError {
  return new ModelPromptEstimatorError(
    code,
    {
      activeProvider: request.activeProvider,
      canonicalModel: request.canonicalModel,
      protocol: request.protocol,
      family: GPT_56_ESTIMATOR_FAMILY,
    },
    code === 'asset-unavailable'
      ? 'verify the pinned local o200k_base disk assets are installed and intact'
      : 'provide a live sealed prompt-key source projection and intact local tokenizer assets',
    { cause },
  );
}

async function prepareSourceAssets(
  request: RuntimePromptEstimateRequest,
): Promise<DiskCounter> {
  await prepareGpt56RuntimeTokenizer(
    request.activeProvider,
    request.canonicalModel,
  );
  try {
    const { diskAssets } = await import('./o200k-disk-assets.js');
    diskAssets();
    const { countO200kBaseTokensFromDiskSource } = await import(
      './o200k-disk-source.js'
    );
    return countO200kBaseTokensFromDiskSource;
  } catch (error) {
    throw failure(request, 'asset-unavailable', error);
  }
}

async function countSources(
  request: RuntimePromptEstimateRequest,
  projection: Gpt56SourceProjection,
  options: O200kDiskCountOptions,
  countDisk: DiskCounter,
  lease: Gpt56SourceLease,
): Promise<RuntimePromptEstimateResult> {
  try {
    let count = 0;
    for (const segment of projection.promptSegments) {
      count += await countDisk(segment.source, options);
    }
    options.signal?.throwIfAborted();
    count += await lease.countImageTokens(
      {
        provider: request.activeProvider,
        model: request.canonicalModel,
      },
      options.signal,
    );
    if (!Number.isSafeInteger(count))
      throw new RangeError('Token count exceeds JavaScript integer precision');
    return {
      count,
      method: 'exact',
      family: GPT_56_ESTIMATOR_FAMILY,
      estimatorVersion: GPT_56_ESTIMATOR_VERSION,
      assetRevision: GPT_56_ASSET_REVISION,
      projectionRevision: request.projectionRevision,
    };
  } catch (error) {
    throw failure(request, 'tokenization-failed', error);
  }
}

/**
 * Experimental opt-in adapter. The original string estimator, registry and
 * provider send routes remain unchanged. Uses only pinned real assets, never
 * an injected encoder or a string fallback. Large native parity remains RED.
 */
export async function estimateGpt56PromptFromSources(
  request: RuntimePromptEstimateRequest,
  options: O200kDiskCountOptions,
): Promise<RuntimePromptEstimateResult> {
  const projection = request.finalizedProjection;
  if (
    !(projection instanceof Gpt56SourceProjection) ||
    projection.protocol !== request.protocol
  )
    throw failure(request, 'tokenization-failed');
  let release: Gpt56SourceLease;
  try {
    release = projection.acquire();
  } catch (error) {
    throw failure(request, 'tokenization-failed', error);
  }
  try {
    const countDisk = await prepareSourceAssets(request);
    return await countSources(request, projection, options, countDisk, release);
  } finally {
    await release();
  }
}
