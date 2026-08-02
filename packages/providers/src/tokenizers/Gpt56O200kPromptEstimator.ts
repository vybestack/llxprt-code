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
import type * as Tiktoken from '@dqbd/tiktoken';
import {
  PROJECTION_REVISION,
  type ProviderFinalizedPromptProjection,
} from '../runtime/promptEnvelopeProjections.js';
import { ModelPromptEstimatorError } from './ModelPromptEstimatorError.js';

export const GPT_56_ESTIMATOR_FAMILY = 'openai-gpt-5.6';
export const GPT_56_ESTIMATOR_VERSION = 'gpt-5.6-o200k-v1';
export const GPT_56_ASSET_REVISION =
  'o200k_base:446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d:@dqbd/tiktoken@1.0.22';

type TiktokenModule = typeof Tiktoken;
export type TiktokenModuleLoader = () => Promise<TiktokenModule>;

const loadTiktokenModule: TiktokenModuleLoader = () => import('@dqbd/tiktoken');
type TiktokenEncoder = ReturnType<TiktokenModule['get_encoding']>;
let sharedEncoder: Promise<TiktokenEncoder> | undefined;

async function createEncoder(
  loadModule: TiktokenModuleLoader,
): Promise<TiktokenEncoder> {
  const { get_encoding } = await loadModule();
  return get_encoding('o200k_base');
}

function getEncoder(
  loadModule: TiktokenModuleLoader,
): Promise<TiktokenEncoder> {
  if (loadModule !== loadTiktokenModule) {
    return createEncoder(loadModule);
  }
  sharedEncoder ??= createEncoder(loadModule);
  return sharedEncoder;
}

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

function createErrorContext(request: RuntimePromptEstimateRequest) {
  return {
    activeProvider: request.activeProvider,
    canonicalModel: request.canonicalModel,
    protocol: request.protocol,
    family: GPT_56_ESTIMATOR_FAMILY,
  };
}

function countProjectionTokens(
  encoder: TiktokenEncoder,
  projection: ProviderFinalizedPromptProjection,
): number {
  const segments = projection.promptSegments ?? [projection.promptText];
  return segments.reduce(
    (total, segment) => total + encoder.encode(segment, [], []).length,
    0,
  );
}

export async function estimateGpt56Prompt(
  request: RuntimePromptEstimateRequest,
  loadModule: TiktokenModuleLoader = loadTiktokenModule,
): Promise<RuntimePromptEstimateResult> {
  const projection = readProjection(request);
  let encoder: TiktokenEncoder;
  try {
    encoder = await getEncoder(loadModule);
  } catch (error) {
    throw new ModelPromptEstimatorError(
      'asset-unavailable',
      createErrorContext(request),
      'verify the local @dqbd/tiktoken o200k_base assets are installed and intact',
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
): RuntimeTokenizer {
  return {
    fallbackPolicy: 'deny',
    async countTokens(content: unknown): Promise<number> {
      const promptText = normalizeRuntimeTokenizerInput(
        content,
        activeProvider,
        canonicalModel,
      );
      const result = await estimateGpt56Prompt({
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
      });
      return result.count;
    },
  };
}
