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
  INEFFECTIVE_COMPRESSION_REDUCTION_THRESHOLD,
  computeMarginAdjustedLimit,
} from './contextLimitPolicy.js';

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

interface ProjectionResult {
  contents: IContent[];
  projected: number;
  compressionFailure?: Error;
}

interface OverflowReductionResult {
  contents: IContent[];
  projected: number;
  compressionFailure?: Error;
  truncationFailure?: Error;
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
      'initial',
    );

    if (initialProjected <= compressionThreshold) {
      return envelope.contents;
    }

    if (envelope.pendingContents === undefined) {
      if (initialProjected <= marginAdjustedLimit) {
        return envelope.contents;
      }
      throw this.buildUnrecoverableBoundaryError(
        initialProjected,
        marginAdjustedLimit,
      );
    }

    const postOpt = await this.optimizeAndProject(
      envelope.pendingContents,
      completionBudget,
      model,
    );
    if (postOpt.projected <= compressionThreshold) {
      return postOpt.contents;
    }

    const firstResult = await this.runCompressionAndRecompose(
      promptId,
      envelope.pendingContents,
      completionBudget,
      model,
    );
    if (firstResult.projected <= marginAdjustedLimit) {
      return firstResult.contents;
    }

    const retryResult = await this.retryCompressionIfIneffective(
      promptId,
      envelope.pendingContents,
      completionBudget,
      model,
      marginAdjustedLimit,
      postOpt.projected,
      firstResult,
    );
    if (retryResult.projected <= marginAdjustedLimit) {
      return retryResult.contents;
    }

    const truncationResult = await this.forceTruncation(
      promptId,
      envelope.pendingContents,
      completionBudget,
      model,
      retryResult.compressionFailure,
    );
    if (truncationResult.projected <= marginAdjustedLimit) {
      return truncationResult.contents;
    }

    throw buildContextOverflowError({
      limit,
      initialProjected,
      finalProjected: truncationResult.projected,
      marginAdjustedLimit,
      completionBudget,
      truncationFailure: truncationResult.truncationFailure,
      compressionFailure: truncationResult.compressionFailure,
    });
  }

  async compressAndRecompose(
    pendingContents: IContent[],
    promptId: string,
  ): Promise<IContent[]> {
    if (pendingContents.length === 0) {
      return [];
    }
    const result = await this.runCompressionAndRecompose(
      promptId,
      pendingContents,
      0,
      this.deps.runtimeContext.state.model,
    );
    // runCompressionAndRecompose catches errors/non-COMPRESSED results and
    // returns them as a structured compressionFailure. The provider compression
    // callback contract (attachCompressionCallback) expects failure to throw
    // so the provider can reject the request. Rethrow here honors that contract;
    // the enforcement orchestration (enforce) consumes the structured failure
    // directly via runCompressionAndRecompose and is unaffected.
    if (result.compressionFailure !== undefined) {
      throw result.compressionFailure;
    }
    return result.contents;
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

  private buildUnrecoverableBoundaryError(
    projected: number,
    marginAdjustedLimit: number,
  ): Error {
    return new Error(
      'Context overflow requires compression, but the pending-content boundary is unrecoverable: ' +
        'a BeforeModel hook replaced or restructured the conversation contents, and no usable ' +
        'llm_request_boundary metadata was available, so compression cannot safely recompose the pending region. ' +
        'Consider reducing the context size, or have the hook supply valid llm_request_boundary metadata. ' +
        `Projected ${projected} exceeds safety-adjusted limit ${marginAdjustedLimit}.`,
    );
  }

  private async optimizeAndProject(
    pendingContents: IContent[],
    completionBudget: number,
    model: string,
  ): Promise<ProjectionResult> {
    await this.deps.ensureDensityOptimized();
    await this.deps.historyService.waitForTokenUpdates();
    const optimizedContents = this.recomposeProviderContents(pendingContents);
    const postOptProjected = await this.estimateProviderProjection(
      optimizedContents,
      completionBudget,
      model,
      'post-density-optimization',
    );
    return { contents: optimizedContents, projected: postOptProjected };
  }

  private async runCompressionAndRecompose(
    promptId: string,
    pendingContents: IContent[],
    completionBudget: number,
    model: string,
    stage: string = 'post-compression',
  ): Promise<ProjectionResult> {
    try {
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
        return await this.projectWithFailure(
          pendingContents,
          completionBudget,
          model,
          new Error(
            `Auto compression did not complete during hard-limit enforcement (result: ${result})`,
          ),
          stage,
        );
      }
      return await this.projectSuccess(
        pendingContents,
        completionBudget,
        model,
        stage,
      );
    } catch (error) {
      const compressionError = this.normalizeError(error);
      this.deps.logger.warn(
        () =>
          '[CompressionHandler] Auto compression failed during hard-limit enforcement',
        compressionError,
      );
      return this.projectWithFailure(
        pendingContents,
        completionBudget,
        model,
        compressionError,
        stage,
      );
    }
  }

  private async retryCompressionIfIneffective(
    promptId: string,
    pendingContents: IContent[],
    completionBudget: number,
    model: string,
    marginAdjustedLimit: number,
    preCompressionProjected: number,
    firstResult: ProjectionResult,
  ): Promise<ProjectionResult> {
    const reduction = preCompressionProjected - firstResult.projected;
    const reductionRatio =
      preCompressionProjected > 0 ? reduction / preCompressionProjected : 0;
    if (
      firstResult.compressionFailure !== undefined ||
      reductionRatio >= INEFFECTIVE_COMPRESSION_REDUCTION_THRESHOLD
    ) {
      return firstResult;
    }

    this.deps.logger.warn(
      () =>
        '[CompressionHandler] Auto compression remained ineffective, retrying full compression before truncation',
      {
        preCompressionProjected,
        postCompressionProjected: firstResult.projected,
        reductionRatio,
        tokensStillNeeded: firstResult.projected - marginAdjustedLimit,
      },
    );

    const retryResult = await this.runCompressionAndRecompose(
      promptId,
      pendingContents,
      completionBudget,
      model,
      'post-retry-compression',
    );
    if (retryResult.compressionFailure !== undefined) {
      const retryError = new Error(
        `Additional hard-limit compression attempt failed: ${retryResult.compressionFailure.message}`,
      );
      this.deps.logger.warn(
        () =>
          '[CompressionHandler] Additional hard-limit compression attempt failed',
        retryResult.compressionFailure,
      );
      return {
        contents: retryResult.contents,
        projected: retryResult.projected,
        compressionFailure: retryError,
      };
    }
    return retryResult;
  }

  private async forceTruncation(
    promptId: string,
    pendingContents: IContent[],
    completionBudget: number,
    model: string,
    compressionFailure: Error | undefined,
  ): Promise<OverflowReductionResult> {
    const originalHistory = this.deps.historyService.getCurated();
    const fallbackState = { historyRestored: false };
    let truncationFailure: Error | undefined;
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
      truncationFailure = this.normalizeError(fallbackError);
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
    const contents = this.recomposeProviderContents(pendingContents);
    const projected = await this.estimateProviderProjection(
      contents,
      completionBudget,
      model,
      'post-truncation',
    );
    const result: OverflowReductionResult = { contents, projected };
    if (compressionFailure !== undefined) {
      result.compressionFailure = compressionFailure;
    }
    if (truncationFailure !== undefined) {
      result.truncationFailure = truncationFailure;
    }
    return result;
  }

  private async projectSuccess(
    pendingContents: IContent[],
    completionBudget: number,
    model: string,
    stage: string,
  ): Promise<ProjectionResult> {
    const contents = this.recomposeProviderContents(pendingContents);
    const projected = await this.estimateProviderProjection(
      contents,
      completionBudget,
      model,
      stage,
    );
    return { contents, projected };
  }

  private async projectWithFailure(
    pendingContents: IContent[],
    completionBudget: number,
    model: string,
    compressionFailure: Error,
    stage: string,
  ): Promise<ProjectionResult> {
    const contents = this.recomposeProviderContents(pendingContents);
    const projected = await this.estimateProviderProjection(
      contents,
      completionBudget,
      model,
      stage,
    );
    return { contents, projected, compressionFailure };
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
    stage: string = 'initial',
  ): Promise<number> {
    try {
      const requestTokens =
        await this.deps.historyService.estimateTokensForContents(
          contents,
          model,
        );
      return requestTokens + completionBudget;
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Token projection failed at ${stage} stage during provider-content hard-limit enforcement: ${cause}`,
      );
    }
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

  private normalizeError(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }
    return new Error(String(error));
  }
}
