/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelGenerationSettings } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { ProviderContentEnvelope } from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  invalidateResponsesStatefulChain,
  type IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
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
import {
  truncateOversizedToolResponsesUnified,
  type UnifiedTruncationResult,
} from './toolResultTruncator.js';

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
    applyResult: (newHistory: IContent[]) => Promise<void>,
  ) => Promise<boolean>;
  getPromptTokenBaseline: () => number | null;
  resetPromptTokenBaseline: () => void;
  restorePromptTokenBaseline: (baseline: number | null) => void;
  estimateFinalizedPromptTokens?: (contents: IContent[]) => Promise<number>;
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

interface FallbackStateSnapshot {
  readonly history: IContent[];
  readonly cacheAnchorSeq: number;
  readonly promptTokenBaseline: number | null;
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

    let toolTruncationResult: UnifiedTruncationResult;
    try {
      toolTruncationResult = await this.truncateToolResponsesUnified(
        pendingContents,
        limits.marginAdjustedLimit,
        limits.completionBudget,
        model,
      );
    } catch (error) {
      const toolTruncationFailure = this.normalizeError(error);
      this.deps.logger.warn(
        () =>
          '[CompressionHandler] Unified tool-response truncation failed during last-resort enforcement',
        toolTruncationFailure,
      );
      throw this.buildOverflowError(
        limits.limit,
        limits.completionBudget,
        limits.marginAdjustedLimit,
        initialProjected,
        this.withToolTruncationFailure(truncationResult, toolTruncationFailure),
        0,
      );
    }

    if (toolTruncationResult.success) {
      return this.recomposeProviderContents(
        toolTruncationResult.transformedPending ?? pendingContents,
      );
    }

    throw this.buildOverflowError(
      limits.limit,
      limits.completionBudget,
      limits.marginAdjustedLimit,
      initialProjected,
      {
        ...truncationResult,
        projected: toolTruncationResult.projected,
      },
      toolTruncationResult.replacedCount,
    );
  }

  private buildOverflowError(
    limit: number,
    completionBudget: number,
    marginAdjustedLimit: number,
    initialProjected: number,
    truncationResult: OverflowReductionResult,
    toolResponsesTruncated?: number,
  ): Error {
    return buildContextOverflowError({
      limit,
      initialProjected,
      finalProjected: truncationResult.projected,
      marginAdjustedLimit,
      completionBudget,
      truncationFailure: truncationResult.truncationFailure,
      compressionFailure: truncationResult.compressionFailure,
      ...(toolResponsesTruncated !== undefined
        ? {
            toolResponseTruncationAttempted: true,
            toolResponsesTruncated,
          }
        : {}),
    });
  }

  private withToolTruncationFailure(
    truncationResult: OverflowReductionResult,
    toolTruncationFailure: Error,
  ): OverflowReductionResult {
    if (truncationResult.truncationFailure === undefined) {
      return {
        ...truncationResult,
        truncationFailure: toolTruncationFailure,
      };
    }
    return {
      ...truncationResult,
      truncationFailure: new Error(
        `${truncationResult.truncationFailure.message}; unified tool-response truncation failed: ${toolTruncationFailure.message}`,
        { cause: toolTruncationFailure },
      ),
    };
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

  private async truncateToolResponsesUnified(
    pendingContents: IContent[],
    marginAdjustedLimit: number,
    completionBudget: number,
    model: string,
  ): Promise<UnifiedTruncationResult> {
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
            'post-tool-response-truncation',
          );
        },
        resetBaseline: () => {
          // Provider projection is recomputed from the assembled payload.
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

  private captureFallbackState(): FallbackStateSnapshot {
    return {
      history: [...this.deps.historyService.getRawHistory()],
      cacheAnchorSeq: this.deps.historyService.getCacheAnchorSeq(),
      promptTokenBaseline: this.deps.getPromptTokenBaseline(),
    };
  }

  private async restoreFallbackState(
    snapshot: FallbackStateSnapshot,
  ): Promise<void> {
    await this.deps.historyService.replaceAll(
      [...snapshot.history],
      this.deps.runtimeContext.state.model,
    );
    if (snapshot.cacheAnchorSeq === 0) {
      this.deps.historyService.resetCacheAnchorSeq();
    } else {
      this.deps.historyService.setCacheAnchorSeq(snapshot.cacheAnchorSeq);
    }
    this.deps.restorePromptTokenBaseline(snapshot.promptTokenBaseline);
  }

  private async restoreRejectedFallback(
    snapshot: FallbackStateSnapshot,
    fallbackError: unknown,
  ): Promise<Error> {
    const failure = this.normalizeError(fallbackError);
    try {
      await this.restoreFallbackState(snapshot);
      return failure;
    } catch (rollbackError) {
      return new AggregateError(
        [failure, this.normalizeError(rollbackError)],
        'Provider truncation fallback failed and its state rollback also failed',
      );
    }
  }

  /**
   * Executes fallback truncation and commits its candidate history atomically.
   * The existing history remains untouched unless the complete candidate is
   * accepted and its token accounting succeeds.
   */
  private async executeFallbackTruncation(promptId: string): Promise<{
    truncationApplied: boolean;
    truncationFailure?: Error;
  }> {
    const snapshot = this.captureFallbackState();
    let truncationFailure: Error | undefined;
    let fallbackSucceeded = false;
    const candidate = { installed: false, committed: false };
    try {
      fallbackSucceeded = await this.deps.performFallbackCompression(
        promptId,
        async (newHistory) => {
          await this.deps.historyService.replaceAll(
            [...invalidateResponsesStatefulChain(newHistory)],
            this.deps.runtimeContext.state.model,
          );
          candidate.installed = true;
          this.deps.historyService.resetCacheAnchorSeq();
          this.deps.resetPromptTokenBaseline();
          candidate.committed = true;
        },
      );
      if (!fallbackSucceeded && candidate.installed) {
        throw new Error(
          'Fallback compression rejected after installing candidate history',
        );
      }
    } catch (fallbackError) {
      truncationFailure = candidate.installed
        ? await this.restoreRejectedFallback(snapshot, fallbackError)
        : this.normalizeError(fallbackError);
      candidate.committed = false;
      this.deps.logger.warn(
        () =>
          '[CompressionHandler] Provider truncation fallback rejected during hard-limit enforcement',
        truncationFailure,
      );
    }
    if (fallbackSucceeded && !candidate.committed) {
      this.deps.logger.warn(
        () =>
          '[CompressionHandler] Fallback compression succeeded without providing candidate history',
      );
    }
    return {
      truncationApplied: fallbackSucceeded && candidate.committed,
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
      const requestTokens = this.deps.estimateFinalizedPromptTokens
        ? await this.deps.estimateFinalizedPromptTokens(contents)
        : await this.deps.historyService.estimateTokensForContents(
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

  private normalizeError(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }
    return new Error(String(error));
  }
}
