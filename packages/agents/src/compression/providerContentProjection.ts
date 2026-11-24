/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelGenerationSettings } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { PromptEnvelopeBudgetEstimate } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { isRequestByteOverflowError } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import type { ContextLimits } from './enforcementLimits.js';
import { computeContextLimits as computeLimits } from './enforcementLimits.js';
import { measureRequestTokens } from './guardCalibration.js';

export interface PromptProjectionRuntime {
  readonly historyService: HistoryService;
  readonly generationConfig: ModelGenerationSettings;
  readonly readCompletionBudgetSetting: () => unknown;
  readonly estimateFinalizedPromptTokens?: (
    contents: IContent[],
  ) => Promise<PromptEnvelopeBudgetEstimate>;
  readonly runtimeContext: {
    readonly ephemerals: {
      compressionThreshold(): number;
      contextLimit(): number;
    };
  };
}

export function estimateByContents(
  deps: PromptProjectionRuntime,
  contents: IContent[],
  model: string,
): Promise<number> {
  return deps.historyService.estimateTokensForContents(contents, model);
}

export async function estimateInitialPrompt(
  deps: PromptProjectionRuntime,
  contents: IContent[],
  model: string,
  preferContents: boolean,
): Promise<{ tokens: number; maxOutputTokens?: number }> {
  try {
    if (deps.estimateFinalizedPromptTokens === undefined) {
      return {
        tokens: await deps.historyService.estimateTokensForContents(
          contents,
          model,
        ),
      };
    }
    const estimate = await deps.estimateFinalizedPromptTokens(contents);
    const tokens =
      typeof estimate === 'number' ? estimate : estimate.estimatedPromptTokens;
    return {
      tokens: preferContents
        ? await estimateByContents(deps, contents, model)
        : tokens,
      ...(typeof estimate === 'number' || estimate.maxOutputTokens === undefined
        ? {}
        : { maxOutputTokens: estimate.maxOutputTokens }),
    };
  } catch (error) {
    if (isRequestByteOverflowError(error)) throw error;
    const projectionError = normalizeError(error);
    throw new Error(
      `Token projection failed at initial stage during provider-content hard-limit enforcement: ${projectionError.message}`,
      { cause: projectionError },
    );
  }
}

export async function estimateProviderProjection(
  deps: PromptProjectionRuntime,
  contents: IContent[],
  completionBudget: number,
  model: string,
  preferContents: boolean,
  stage: string,
): Promise<number> {
  try {
    const requestTokens = await measureRequestTokens(
      {
        finalized:
          deps.estimateFinalizedPromptTokens === undefined
            ? undefined
            : async (candidate) => {
                const estimate =
                  await deps.estimateFinalizedPromptTokens?.(candidate);
                if (estimate === undefined) {
                  throw new Error(
                    'Finalized prompt estimator returned no estimate',
                  );
                }
                return typeof estimate === 'number'
                  ? estimate
                  : estimate.estimatedPromptTokens;
              },
        byContents: (candidate) => estimateByContents(deps, candidate, model),
        preferContents,
      },
      contents,
    );
    return requestTokens + completionBudget;
  } catch (error) {
    if (isRequestByteOverflowError(error)) throw error;
    const projectionError = normalizeError(error);
    throw new Error(
      `Token projection failed at ${stage} stage during provider-content hard-limit enforcement: ${projectionError.message}`,
      { cause: projectionError },
    );
  }
}

export function computeProviderContextLimits(
  deps: PromptProjectionRuntime,
  provider: RuntimeProvider | undefined,
  model: string,
  maxOutputTokens?: number,
): ContextLimits {
  const generationConfig =
    maxOutputTokens === undefined
      ? deps.generationConfig
      : { ...deps.generationConfig, maxOutputTokens };
  return computeLimits(
    {
      userContextLimit: deps.runtimeContext.ephemerals.contextLimit(),
      compressionThreshold:
        deps.runtimeContext.ephemerals.compressionThreshold(),
      generationConfig,
      completionBudgetSetting:
        maxOutputTokens === undefined
          ? deps.readCompletionBudgetSetting()
          : undefined,
    },
    provider,
    model,
  );
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
