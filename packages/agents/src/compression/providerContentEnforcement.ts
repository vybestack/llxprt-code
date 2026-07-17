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
  truncationApplied: boolean;
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
    const limits = this.computeContextLimits(provider, model);
    const initialProjected = await this.estimateProviderProjection(
      envelope.contents,
      limits.completionBudget,
      model,
      'initial',
    );

    const earlyReturn = this.checkEarlyReturn(
      envelope,
      limits,
      initialProjected,
    );
    if (earlyReturn !== undefined) {
      return earlyReturn;
    }
    if (envelope.pendingContents === undefined) {
      throw this.buildUnrecoverableBoundaryError(
        initialProjected,
        limits.marginAdjustedLimit,
      );
    }

    const postOpt = await this.optimizeAndProject(
      envelope.pendingContents,
      limits.completionBudget,
      model,
    );
    if (postOpt.projected <= limits.compressionThreshold) {
      return postOpt.contents;
    }

    const firstResult = await this.runCompressionAndRecompose(
      promptId,
      envelope.pendingContents,
      limits.completionBudget,
      model,
    );
    if (firstResult.projected <= limits.marginAdjustedLimit) {
      return firstResult.contents;
    }

    const retryResult = await this.retryCompressionIfIneffective(
      promptId,
      envelope.pendingContents,
      limits.completionBudget,
      model,
      limits.marginAdjustedLimit,
      postOpt.projected,
      firstResult,
    );
    if (retryResult.projected <= limits.marginAdjustedLimit) {
      return retryResult.contents;
    }

    return this.enforceTruncation(
      promptId,
      envelope.pendingContents,
      limits,
      model,
      initialProjected,
      retryResult.compressionFailure,
    );
  }

  private checkEarlyReturn(
    envelope: ProviderContentEnvelope,
    limits: ContextLimits,
    initialProjected: number,
  ): IContent[] | undefined {
    if (initialProjected <= limits.compressionThreshold) {
      return envelope.contents;
    }
    if (
      envelope.pendingContents === undefined &&
      initialProjected <= limits.marginAdjustedLimit
    ) {
      return envelope.contents;
    }
    return undefined;
  }

  private async enforceTruncation(
    promptId: string,
    pendingContents: IContent[],
    limits: ContextLimits,
    model: string,
    initialProjected: number,
    compressionFailure: Error | undefined,
  ): Promise<IContent[]> {
    const truncationResult = await this.forceTruncation(
      promptId,
      pendingContents,
      limits.completionBudget,
      model,
      compressionFailure,
    );
    if (
      truncationResult.truncationApplied &&
      truncationResult.projected <= limits.marginAdjustedLimit
    ) {
      return truncationResult.contents;
    }
    throw this.buildOverflowError(
      limits.limit,
      limits.completionBudget,
      limits.marginAdjustedLimit,
      initialProjected,
      truncationResult,
    );
  }

  private buildOverflowError(
    limit: number,
    completionBudget: number,
    marginAdjustedLimit: number,
    initialProjected: number,
    truncationResult: OverflowReductionResult,
  ): Error {
    return buildContextOverflowError({
      limit,
      initialProjected,
      finalProjected: truncationResult.projected,
      marginAdjustedLimit,
      completionBudget,
      truncationFailure: truncationResult.truncationFailure,
      compressionFailure: truncationResult.compressionFailure,
    });
  }

  /**
   * Compresses history and recomposes it with pending content.
   *
   * @throws When compression throws or returns a non-COMPRESSED result.
   */
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
    // The try/catch covers ONLY performCompression, the token-update wait,
    // and compression-result handling. Projection calls (projectSuccess /
    // projectWithFailure) are executed OUTSIDE the catch so that a projection
    // rejection surfaces as a stage-aware error rather than being swallowed
    // and re-projected as a compression failure.
    let compressionResult: PerformCompressionResult;
    let compressionError: Error | undefined;
    try {
      compressionResult = await this.deps.performCompression(promptId, {
        bypassCooldown: true,
        trigger: 'auto',
      });
      await this.deps.historyService.waitForTokenUpdates();
    } catch (error) {
      compressionResult = PerformCompressionResult.FAILED;
      compressionError = this.normalizeError(error);
      this.deps.logger.warn(
        () =>
          '[CompressionHandler] Auto compression failed during hard-limit enforcement',
        compressionError,
      );
    }
    if (compressionError !== undefined) {
      return this.projectWithFailure(
        pendingContents,
        completionBudget,
        model,
        compressionError,
        stage,
      );
    }
    if (compressionResult !== PerformCompressionResult.COMPRESSED) {
      this.deps.logger.debug(
        () =>
          `[CompressionHandler] Provider-content compression finished without COMPRESSED result: ${compressionResult}`,
      );
      return this.projectWithFailure(
        pendingContents,
        completionBudget,
        model,
        new Error(
          `Auto compression did not complete during hard-limit enforcement (result: ${compressionResult})`,
        ),
        stage,
      );
    }
    return this.projectSuccess(pendingContents, completionBudget, model, stage);
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
        { cause: retryResult.compressionFailure },
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
    const fallbackOutcome = await this.executeFallbackTruncation(promptId);
    await this.deps.historyService.waitForTokenUpdates();
    const contents = this.recomposeProviderContents(pendingContents);
    const projected = await this.estimateProviderProjection(
      contents,
      completionBudget,
      model,
      'post-truncation',
    );
    const result: OverflowReductionResult = {
      contents,
      projected,
      truncationApplied: fallbackOutcome.truncationApplied,
    };
    if (compressionFailure !== undefined) {
      result.compressionFailure = compressionFailure;
    }
    if (fallbackOutcome.truncationFailure !== undefined) {
      result.truncationFailure = fallbackOutcome.truncationFailure;
    }
    return result;
  }

  /**
   * Executes the fallback truncation strategy and manages history restoration.
   * Truncation is only considered successfully applied when the fallback
   * reported success AND history was restored into historyService.
   */
  private async executeFallbackTruncation(promptId: string): Promise<{
    truncationApplied: boolean;
    truncationFailure?: Error;
  }> {
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
      fallbackState.historyRestored = this.tryRestoreHistory(
        originalHistory,
        '[CompressionHandler] Failed to restore history after fallback returned false',
      );
    } else if (fallbackSucceeded && !fallbackState.historyRestored) {
      this.deps.logger.warn(
        () =>
          '[CompressionHandler] Fallback compression succeeded without applying history; restoring original history',
      );
      fallbackState.historyRestored = this.tryRestoreHistory(
        originalHistory,
        '[CompressionHandler] Failed to restore history after fallback succeeded without applying history',
      );
    }
    return {
      truncationApplied: fallbackSucceeded && fallbackState.historyRestored,
      truncationFailure,
    };
  }

  private projectSuccess(
    pendingContents: IContent[],
    completionBudget: number,
    model: string,
    stage: string,
  ): Promise<ProjectionResult> {
    return this.projectContents(
      pendingContents,
      completionBudget,
      model,
      stage,
    );
  }

  private projectWithFailure(
    pendingContents: IContent[],
    completionBudget: number,
    model: string,
    compressionFailure: Error,
    stage: string,
  ): Promise<ProjectionResult> {
    return this.projectContents(
      pendingContents,
      completionBudget,
      model,
      stage,
      compressionFailure,
    );
  }

  private async projectContents(
    pendingContents: IContent[],
    completionBudget: number,
    model: string,
    stage: string,
    compressionFailure?: Error,
  ): Promise<ProjectionResult> {
    const contents = this.recomposeProviderContents(pendingContents);
    const projected = await this.estimateProviderProjection(
      contents,
      completionBudget,
      model,
      stage,
    );
    return compressionFailure === undefined
      ? { contents, projected }
      : { contents, projected, compressionFailure };
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
      const projectionError = this.normalizeError(error);
      throw new Error(
        `Token projection failed at ${stage} stage during provider-content hard-limit enforcement: ${projectionError.message}`,
        { cause: projectionError },
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
