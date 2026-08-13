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
import {
  PROJECTION_REVISION,
  type ProviderFinalizedPromptProjection,
} from '../runtime/promptEnvelopeProjections.js';
import { ModelPromptEstimatorError } from './ModelPromptEstimatorError.js';
import {
  countO200kBaseTokens,
  getO200kBaseEncoder,
  loadTiktokenModule,
  O200K_BASE_ASSET_REVISION,
  type O200kBaseEncoder,
  type O200kBaseEncoderResolver,
  type TiktokenModuleLoader,
} from './o200kBaseCounter.js';

export const GPT_56_ESTIMATOR_FAMILY = 'openai-gpt-5.6';
export const GPT_56_ESTIMATOR_VERSION = 'gpt-5.6-o200k-v1';
export const GPT_56_ASSET_REVISION = O200K_BASE_ASSET_REVISION;

export type { TiktokenModuleLoader };

type TiktokenEncoder = O200kBaseEncoder;

function isFinalizedPromptProjection(
  value: unknown,
  protocol: RuntimePromptEstimateRequest['protocol'],
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
): ProviderFinalizedPromptProjection {
  const projection = request.finalizedProjection;
  if (!isFinalizedPromptProjection(projection, request.protocol)) {
    throw new ModelPromptEstimatorError(
      'tokenization-failed',
      createErrorContext(request),
      'rebuild the finalized provider projection with the active protocol',
    );
  }
  return projection;
}

function createGpt56ErrorContext(
  activeProvider: string,
  canonicalModel: string,
  protocol: RuntimePromptEstimateRequest['protocol'] = 'openai-responses',
) {
  return {
    activeProvider,
    canonicalModel,
    protocol,
    family: GPT_56_ESTIMATOR_FAMILY,
  };
}

function createErrorContext(request: RuntimePromptEstimateRequest) {
  return createGpt56ErrorContext(
    request.activeProvider,
    request.canonicalModel,
    request.protocol,
  );
}

function countProjectionTokens(
  encoder: TiktokenEncoder,
  projection: ProviderFinalizedPromptProjection,
): number {
  const segments = projection.promptSegments ?? [projection.promptText];
  return segments.reduce(
    (total, segment) => total + countO200kBaseTokens(encoder, segment),
    0,
  );
}

function formatCausalDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function prepareGpt56RuntimeTokenizer(
  activeProvider: string,
  canonicalModel: string,
  resolveEncoder: O200kBaseEncoderResolver = () => getO200kBaseEncoder(),
): Promise<void> {
  let encoder: TiktokenEncoder;
  try {
    encoder = await resolveEncoder();
  } catch (error) {
    throw new ModelPromptEstimatorError(
      'asset-unavailable',
      createGpt56ErrorContext(activeProvider, canonicalModel),
      `verify the local @dqbd/tiktoken o200k_base assets are installed and intact; cause: ${formatCausalDetail(error)}`,
      { cause: error },
    );
  }

  try {
    countO200kBaseTokens(encoder, 'readiness');
  } catch (error) {
    throw new ModelPromptEstimatorError(
      'tokenization-failed',
      createGpt56ErrorContext(activeProvider, canonicalModel),
      `verify the local @dqbd/tiktoken o200k_base encoder can encode ordinary text; cause: ${formatCausalDetail(error)}`,
      { cause: error },
    );
  }
}

export function estimateGpt56Prompt(
  request: RuntimePromptEstimateRequest,
  loadModule: TiktokenModuleLoader = loadTiktokenModule,
): Promise<RuntimePromptEstimateResult> {
  return estimateGpt56PromptWithEncoder(request, () =>
    getO200kBaseEncoder(loadModule),
  );
}

/**
 * Build a GPT-5.6 prompt estimator bound to a specific encoder resolver.
 *
 * The standalone {@link estimateGpt56Prompt} resolves the encoder from the
 * caller-supplied loader or, when omitted, the process-wide shared encoder.
 * A composition root that owns a factory-scoped resolver uses this so
 * readiness, runtime tokenization, and final prompt-envelope estimation all
 * share one encoder instance instead of diverging onto the process-wide one.
 */
export function createGpt56PromptEstimator(
  resolveEncoder: O200kBaseEncoderResolver,
): (
  request: RuntimePromptEstimateRequest,
) => Promise<RuntimePromptEstimateResult> {
  return (request) => estimateGpt56PromptWithEncoder(request, resolveEncoder);
}

async function estimateGpt56PromptWithEncoder(
  request: RuntimePromptEstimateRequest,
  resolveEncoder: O200kBaseEncoderResolver,
): Promise<RuntimePromptEstimateResult> {
  const projection = readProjection(request);
  let encoder: TiktokenEncoder;
  try {
    encoder = await resolveEncoder();
  } catch (error) {
    throw new ModelPromptEstimatorError(
      'asset-unavailable',
      createErrorContext(request),
      `verify the local @dqbd/tiktoken o200k_base assets are installed and intact; cause: ${formatCausalDetail(error)}`,
      { cause: error },
    );
  }
  try {
    return {
      count: countProjectionTokens(encoder, projection),
      method: 'exact',
      family: GPT_56_ESTIMATOR_FAMILY,
      estimatorVersion: GPT_56_ESTIMATOR_VERSION,
      assetRevision: GPT_56_ASSET_REVISION,
      projectionRevision: request.projectionRevision,
    };
  } catch (error) {
    throw new ModelPromptEstimatorError(
      'tokenization-failed',
      createErrorContext(request),
      'verify the finalized projection and retry with intact local tokenizer assets',
      { cause: error },
    );
  }
}
function normalizeRuntimeTokenizerInput(
  content: unknown,
  activeProvider: string,
  canonicalModel: string,
): string {
  try {
    const text =
      typeof content === 'string' ? content : JSON.stringify(content);
    if (typeof text === 'string') return text;
    throw new Error('input is not JSON-serializable');
  } catch (error) {
    throw new ModelPromptEstimatorError(
      'tokenization-failed',
      {
        activeProvider,
        canonicalModel,
        protocol: 'openai-responses',
        family: GPT_56_ESTIMATOR_FAMILY,
      },
      'provide string or JSON-serializable content to the runtime tokenizer',
      { cause: error },
    );
  }
}

export function createGpt56RuntimeTokenizer(
  activeProvider: string,
  canonicalModel: string,
  resolveEncoder: O200kBaseEncoderResolver = () => getO200kBaseEncoder(),
): RuntimeTokenizer {
  return {
    fallbackPolicy: 'deny',
    async countTokens(content: unknown): Promise<number> {
      const promptText = normalizeRuntimeTokenizerInput(
        content,
        activeProvider,
        canonicalModel,
      );
      const result = await estimateGpt56PromptWithEncoder(
        {
          activeProvider,
          canonicalModel,
          protocol: 'openai-responses',
          wireMethod: 'responses/v1',
          finalizedProjection: {
            kind: 'llxprt-provider-prompt-v3',
            protocol: 'openai-responses',
            promptText,
          },
          projectionRevision: PROJECTION_REVISION,
          legacyEstimate: () =>
            Promise.reject(new Error('unreachable legacy estimate')),
        },
        resolveEncoder,
      );
      return result.count;
    },
  };
}
