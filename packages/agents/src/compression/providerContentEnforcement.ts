/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelGenerationSettings } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { ProviderContentEnvelope } from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { getCompletionBudget } from './compressionBudgeting.js';
import { tokenLimit } from '@vybestack/llxprt-code-core/core/tokenLimits.js';
import { buildProviderContent } from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';
import { buildContextOverflowError } from './contextOverflowError.js';
import {
  truncateOversizedToolResponsesUnified,
  type UnifiedTruncationResult,
} from './toolResultTruncator.js';

const TOKEN_SAFETY_MARGIN = 1000;
const INEFFECTIVE_COMPRESSION_REDUCTION_THRESHOLD = 0.05;
type CompletionSettingsService = { get: (key: string) => unknown };

export interface ProviderContentEnforcementDeps {
  historyService: HistoryService;
  runtimeContext: AgentRuntimeContext;
  generationConfig: ModelGenerationSettings;
  providerRuntimeNullable:
    | { settingsService?: CompletionSettingsService }
    | null
    | undefined;
  logger: DebugLogger;
  ensureDensityOptimized: () => Promise<void>;
  performCompression: (
    promptId: string,
    options: { bypassCooldown: true; trigger: 'auto' },
  ) => Promise<PerformCompressionResult>;
  performFallbackCompression: (
    promptId: string,
    applyResult: (newHistory: IContent[]) => void,
  ) => Promise<boolean>;
}

interface ContextLimits {
  completionBudget: number;
  limit: number;
  marginAdjustedLimit: number;
  compressionThreshold: number;
}

export class ProviderContentEnforcer {
  constructor(private readonly deps: ProviderContentEnforcementDeps) {}

  async enforce(
    envelope: ProviderContentEnvelope,
    promptId: string,
    provider?: IProvider,
  ): Promise<IContent[]> {
    await this.deps.historyService.waitForTokenUpdates();
    const model = this.resolveModel(provider);
    const {
      completionBudget,
      limit,
      marginAdjustedLimit,
      compressionThreshold,
    } = this.computeContextLimits(provider, model);
    const initialProjected = await this.estimateProviderProjection(
      envelope.contents,
      completionBudget,
      model,
    );

    if (initialProjected <= compressionThreshold) {
      return envelope.contents;
    }

    if (envelope.pendingContents === undefined) {
      // marginAdjustedLimit (limit minus TOKEN_SAFETY_MARGIN) is this enforcer's
      // effective hard limit — the same acceptance criterion used for compressed
      // contents later in enforce() — so the unrecoverable-boundary policy
      // ("send as-is under the hard limit / throw over it", issue #2306)
      // intentionally uses it for consistency and to protect against
      // token-estimate error.
      if (initialProjected <= marginAdjustedLimit) {
        return envelope.contents;
      }
      throw new Error(
        'Context overflow requires compression, but the pending-content boundary is unrecoverable: ' +
          'a BeforeModel hook replaced or restructured the conversation contents, and no usable ' +
          'llm_request_boundary metadata was available, so compression cannot safely recompose the pending region. ' +
          'Consider reducing the context size, or have the hook supply valid llm_request_boundary metadata. ' +
          `Projected ${initialProjected} exceeds safety-adjusted limit ${marginAdjustedLimit}.`,
      );
    }

    await this.deps.ensureDensityOptimized();
    await this.deps.historyService.waitForTokenUpdates();

    const optimizedContents = this.recomposeProviderContents(
      envelope.pendingContents,
    );
    const postOptProjected = await this.estimateProviderProjection(
      optimizedContents,
      completionBudget,
      model,
    );
    if (postOptProjected <= compressionThreshold) {
      return optimizedContents;
    }

    const compressedContents = await this.runCompressionAndRecompose(
      promptId,
      envelope.pendingContents,
    );
    const recomputed = await this.estimateProviderProjection(
      compressedContents,
      completionBudget,
      model,
    );
    if (recomputed <= marginAdjustedLimit) {
      return compressedContents;
    }

    return this.recoverAfterCompression({
      pendingContents: envelope.pendingContents,
      promptId,
      postOptProjected,
      postCompressionProjected: recomputed,
      limit,
      initialProjected,
      marginAdjustedLimit,
      completionBudget,
      model,
    });
  }

  private async recoverAfterCompression(input: {
    pendingContents: IContent[];
    promptId: string;
    postOptProjected: number;
    postCompressionProjected: number;
    limit: number;
    initialProjected: number;
    marginAdjustedLimit: number;
    completionBudget: number;
    model: string;
  }): Promise<IContent[]> {
    const fallbackContents = await this.forceTruncationIfIneffective(
      input.promptId,
      input.postOptProjected,
      input.postCompressionProjected,
      input.pendingContents,
    );
    const recomputed = await this.estimateProviderProjection(
      fallbackContents,
      input.completionBudget,
      input.model,
    );
    if (recomputed <= input.marginAdjustedLimit) {
      return fallbackContents;
    }

    let toolTruncationResult: UnifiedTruncationResult;
    try {
      toolTruncationResult = await this.truncateToolResponsesUnified(
        input.pendingContents,
        input.marginAdjustedLimit,
        input.completionBudget,
        input.model,
      );
    } catch (error) {
      const truncationFailure =
        error instanceof Error ? error : new Error(String(error));
      this.deps.logger.warn(
        () =>
          '[CompressionHandler] Unified tool-response truncation failed during last-resort enforcement',
        truncationFailure,
      );
      throw buildContextOverflowError({
        limit: input.limit,
        initialProjected: input.initialProjected,
        finalProjected: recomputed,
        marginAdjustedLimit: input.marginAdjustedLimit,
        completionBudget: input.completionBudget,
        truncationFailure,
        toolResponseTruncationAttempted: true,
        toolResponsesTruncated: 0,
      });
    }

    if (toolTruncationResult.success) {
      return this.recomposeProviderContents(
        toolTruncationResult.transformedPending ?? input.pendingContents,
      );
    }

    throw buildContextOverflowError({
      limit: input.limit,
      initialProjected: input.initialProjected,
      finalProjected: toolTruncationResult.projected,
      marginAdjustedLimit: input.marginAdjustedLimit,
      completionBudget: input.completionBudget,
      toolResponseTruncationAttempted: true,
      toolResponsesTruncated: toolTruncationResult.replacedCount,
    });
  }

  async compressAndRecompose(
    pendingContents: IContent[],
    promptId: string,
  ): Promise<IContent[]> {
    if (pendingContents.length === 0) {
      return [];
    }
    return this.runCompressionAndRecompose(promptId, pendingContents);
  }

  private async truncateToolResponsesUnified(
    pendingContents: IContent[],
    marginAdjustedLimit: number,
    completionBudget: number,
    model: string,
  ): Promise<{
    success: boolean;
    replacedCount: number;
    projected: number;
    transformedPending: IContent[] | undefined;
  }> {
    this.deps.logger.warn(
      () =>
        '[CompressionHandler] Provider payload still over limit after fallback, attempting last-resort unified tool-response truncation',
      { marginAdjustedLimit, completionBudget, model },
    );

    return truncateOversizedToolResponsesUnified(
      {
        historyService: this.deps.historyService,
        logger: this.deps.logger,
        pendingContents,
        estimateBlockTokensAsync: async (block) =>
          this.deps.historyService.estimateTokensForContents(
            [{ speaker: 'tool', blocks: [block] }],
            model,
          ),
        computeProjected: async (workingPending) => {
          const recomposed = this.recomposeProviderContents([
            ...workingPending,
          ]);
          return this.estimateProviderProjection(
            recomposed,
            completionBudget,
            model,
          );
        },
        resetBaseline: () => {
          // Provider path has no lastPromptTokenCount baseline; projection
          // is always recomputed from the provider payload via
          // estimateProviderProjection above.
        },
        getRuntimeModel: () => model,
      },
      marginAdjustedLimit,
    );
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

  private async runCompressionAndRecompose(
    promptId: string,
    pendingContents: IContent[],
  ): Promise<IContent[]> {
    const result = await this.deps.performCompression(promptId, {
      bypassCooldown: true,
      trigger: 'auto',
    });
    await this.deps.historyService.waitForTokenUpdates();
    if (result !== PerformCompressionResult.COMPRESSED) {
      this.deps.logger.debug(
        () =>
          `[CompressionHandler] Provider-content compression finished without COMPRESSED result: ${result}`,
      );
    }
    return this.recomposeProviderContents(pendingContents);
  }

  private recomposeProviderContents(pendingContents: IContent[]): IContent[] {
    return buildProviderContent(
      this.deps.historyService.getCurated(),
      pendingContents,
      this.deps.logger,
    );
  }

  private async estimateProviderProjection(
    contents: IContent[],
    completionBudget: number,
    model: string,
  ): Promise<number> {
    const requestTokens =
      await this.deps.historyService.estimateTokensForContents(contents, model);
    return requestTokens + completionBudget;
  }

  private async forceTruncationIfIneffective(
    promptId: string,
    preCompressionProjected: number,
    postCompressionProjected: number,
    pendingContents: IContent[],
  ): Promise<IContent[]> {
    const reduction = preCompressionProjected - postCompressionProjected;
    const reductionRatio =
      preCompressionProjected > 0 ? reduction / preCompressionProjected : 0;
    // Issue #2207 requires a last-resort truncation pass after compression when
    // the fully assembled provider payload still cannot fit. Unlike the older
    // pending-token projection path, this path already has the exact provider
    // payload and must keep trying older-history truncation before overflowing.
    const fallbackReason =
      reductionRatio >= INEFFECTIVE_COMPRESSION_REDUCTION_THRESHOLD
        ? 'Primary compression reduced tokens but the provider payload still exceeds the hard limit'
        : 'Primary compression was ineffective';
    this.deps.logger.warn(
      () =>
        `[CompressionHandler] ${fallbackReason}, forcing provider truncation fallback`,
      {
        preCompressionProjected,
        postCompressionProjected,
        reductionRatio,
      },
    );
    const originalHistory = this.deps.historyService.getCurated();
    const fallbackState = { historyRestored: false };
    let fallbackSucceeded = false;
    try {
      fallbackSucceeded = await this.deps.performFallbackCompression(
        promptId,
        (newHistory) => {
          try {
            this.restoreHistory(newHistory);
            fallbackState.historyRestored = true;
          } catch (restoreError) {
            fallbackState.historyRestored = this.tryRestoreHistory(
              originalHistory,
              '[CompressionHandler] Failed to restore history after fallback failure',
            );
            throw restoreError;
          }
        },
      );
    } catch (fallbackError) {
      // Defensive guard for future fallback implementations that may reject;
      // the current CompressionHandler-backed dependency returns false instead.
      this.deps.logger.warn(
        () =>
          '[CompressionHandler] Provider truncation fallback rejected during hard-limit enforcement',
        fallbackError,
      );
      if (!fallbackState.historyRestored) {
        fallbackState.historyRestored = this.tryRestoreHistory(
          originalHistory,
          '[CompressionHandler] History restored after fallback rejection',
        );
      }
    }
    if (!fallbackSucceeded && !fallbackState.historyRestored) {
      this.deps.logger.debug(
        () =>
          '[CompressionHandler] Fallback compression returned false; restoring original history',
      );
      this.tryRestoreHistory(
        originalHistory,
        '[CompressionHandler] Failed to restore history after fallback returned false',
      );
    } else if (fallbackSucceeded && !fallbackState.historyRestored) {
      this.deps.logger.warn(
        () =>
          '[CompressionHandler] Fallback compression succeeded without applying history; restoring original history',
      );
      this.tryRestoreHistory(
        originalHistory,
        '[CompressionHandler] Failed to restore history after fallback succeeded without applying history',
      );
    }
    await this.deps.historyService.waitForTokenUpdates();
    return this.recomposeProviderContents(pendingContents);
  }

  private restoreHistory(history: IContent[]): void {
    const backup = this.deps.historyService.getCurated();
    this.deps.historyService.clear();
    try {
      this.addHistoryEntries(history);
    } catch (restoreError) {
      this.deps.historyService.clear();
      try {
        this.addHistoryEntries(backup);
      } catch (backupError) {
        this.deps.logger.error(
          () =>
            '[CompressionHandler] Failed to restore both new and backup history; retrying requested history',
          backupError,
        );
        try {
          this.deps.historyService.clear();
          this.addHistoryEntries(history);
          // Final retry restored the requested history, so the original restore error no longer applies.
          return;
        } catch (finalError) {
          this.deps.historyService.clear();
          this.deps.logger.error(
            () =>
              '[CompressionHandler] All history restoration attempts failed; history is empty',
            finalError,
          );
        }
      }
      throw restoreError;
    }
  }

  private addHistoryEntries(history: IContent[]): void {
    this.deps.historyService.addAll(
      history,
      this.deps.runtimeContext.state.model,
    );
  }

  private tryRestoreHistory(history: IContent[], message: string): boolean {
    try {
      this.restoreHistory(history);
      return true;
    } catch (restoreError) {
      this.deps.logger.error(() => message, restoreError);
      return false;
    }
  }

  private computeMarginAdjustedLimit(limit: number): number {
    const safetyAdjustedLimit = Math.max(0, limit - TOKEN_SAFETY_MARGIN);
    return Math.max(1, safetyAdjustedLimit);
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
    const completionBudget = Math.max(
      0,
      getCompletionBudget(
        this.deps.generationConfig,
        model,
        provider,
        this.deps.providerRuntimeNullable?.settingsService,
      ),
    );
    const userContextLimit = this.deps.runtimeContext.ephemerals.contextLimit();
    const limit = tokenLimit(model, userContextLimit);
    const marginAdjustedLimit = this.computeMarginAdjustedLimit(limit);
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
