/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelGenerationSettings } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import { getCompletionBudget } from './compressionBudgeting.js';
import { tokenLimit } from '@vybestack/llxprt-code-core/core/tokenLimits.js';
import { computeMarginAdjustedLimit } from './contextLimitPolicy.js';

type CompletionSettingsService = { get: (key: string) => unknown };

interface ProviderContentEnforcementDeps {
  runtimeContext: AgentRuntimeContext;
  generationConfig: ModelGenerationSettings;
  providerRuntimeNullable:
    | { settingsService?: CompletionSettingsService }
    | null
    | undefined;
}

interface ContextLimits {
  completionBudget: number;
  limit: number;
  marginAdjustedLimit: number;
  compressionThreshold: number;
}

/** Initial context-limit policy of the provider source ladder. */
export class ProviderContentEnforcer {
  constructor(private readonly deps: ProviderContentEnforcementDeps) {}

  sourceContextLimits(provider: IProvider): ContextLimits {
    return this.computeContextLimits(provider, this.resolveModel(provider));
  }

  private resolveModel(provider?: IProvider): string {
    if (provider?.getDefaultModel) {
      const providerModel = provider.getDefaultModel();
      if (providerModel) {
        return providerModel;
      }
    }
    return this.deps.runtimeContext.state.model;
  }

  private computeCompressionThreshold(
    limit: number,
    completionBudget: number,
    marginAdjustedLimit: number,
  ): number {
    const threshold =
      this.deps.runtimeContext.ephemerals.compressionThreshold();
    const effectiveLimit = Math.max(0, limit - completionBudget);
    return Math.min(
      marginAdjustedLimit,
      threshold * effectiveLimit + completionBudget,
    );
  }

  private computeContextLimits(
    provider: IProvider | undefined,
    model: string,
  ): ContextLimits {
    const userContextLimit = this.deps.runtimeContext.ephemerals.contextLimit();
    const limit = tokenLimit(model, userContextLimit);
    const completionBudget = getCompletionBudget(
      this.deps.generationConfig,
      model,
      provider,
      this.deps.providerRuntimeNullable?.settingsService,
      limit,
    );
    const marginAdjustedLimit = computeMarginAdjustedLimit(limit);
    return {
      completionBudget,
      limit,
      marginAdjustedLimit,
      compressionThreshold: this.computeCompressionThreshold(
        limit,
        completionBudget,
        marginAdjustedLimit,
      ),
    };
  }
}
