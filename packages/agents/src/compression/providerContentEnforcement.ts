/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelGenerationSettings } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { ProviderContentEnvelope } from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  RuntimeProvider as IProvider,
  RuntimeCompressionGuardInfo,
} from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { buildProviderContent } from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';
import {
  DEFAULT_REQUEST_MEDIA_BUDGET_BYTES,
  isRequestByteOverflowError,
  type RequestByteOverflowError,
} from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { isAbortLikeError } from './is-abort-like-error.js';
import { buildUnrecoverableBoundaryError } from './contextOverflowError.js';
import {
  INEFFECTIVE_COMPRESSION_REDUCTION_THRESHOLD,
  computeHistoryTruncationTarget,
} from './contextLimitPolicy.js';
import {
  computeContextLimits,
  type ContextLimits,
} from './enforcementLimits.js';
import {
  buildOverflowError,
  withToolTruncationFailure,
  type OverflowReductionResult,
} from './overflowReduction.js';
import { executeFallbackTruncation } from './fallbackTruncationCommit.js';
import {
  compressionCanRelieve,
  explainPendingOverflow,
  retireEnvelopeImages,
  retireEveryHistoricalImage,
  retireHistoricalImages,
} from './historicalImageRetirement.js';
import { protectedRegionStart } from './pendingBoundary.js';
import {
  isRelievableMediaPressure,
  relieveMediaPressure,
} from './mediaPressureFallback.js';
import {
  truncateOversizedToolResponsesUnified,
  type UnifiedTruncationResult,
} from './toolResultTruncator.js';

/**
 * The runtime reads the enforcement path makes: the current model name for
 * history stamps, and the two compression thresholds.
 */
export interface CompressionLimitsRuntime {
  readonly state: { readonly model: string };
  readonly ephemerals: {
    compressionThreshold(): number;
    contextLimit(): number;
  };
}

export interface ProviderContentEnforcementDeps {
  historyService: HistoryService;
  historyOrigin?: object;
  runtimeContext: CompressionLimitsRuntime;
  generationConfig: ModelGenerationSettings;
  readCompletionBudgetSetting: () => unknown;
  logger: DebugLogger;
  ensureDensityOptimized: () => Promise<void>;
  performCompression: (
    promptId: string,
    options: { bypassCooldown: true; trigger: 'auto' },
  ) => Promise<PerformCompressionResult>;
  performFallbackCompression: (
    promptId: string,
    applyResult: (newHistory: IContent[]) => Promise<void>,
    targetTokenCount?: number,
  ) => Promise<boolean>;
  getPromptTokenBaseline: () => number | null;
  resetPromptTokenBaseline: () => void;
  restorePromptTokenBaseline: (baseline: number | null) => void;
  estimateFinalizedPromptTokens?: (contents: IContent[]) => Promise<number>;
  /**
   * Explicit request media budget override; the shared default applies when
   * absent. The oldest historical images are retired from every request view
   * that would exceed it (issue #3984).
   */
  requestMediaBudgetBytes?: number;
}

/**
 * Guard facts supplied by the load-balancer context guard when it invokes the
 * compression callback: its own finalized-envelope estimate and the configured
 * per-sub-profile context limit (issue #3499).
 */
export type CompressionGuardInfo = RuntimeCompressionGuardInfo;

interface ProjectionResult {
  contents: IContent[];
  projected: number;
  compressionFailure?: Error;
}

export class ProviderContentEnforcer {
  /**
   * `retiresAllHistoricalImages` is internal: it marks the enforcer that
   * continues a request after media relief, so every recomposition keeps all
   * historical images retired and retired pixels never come back.
   */
  constructor(
    private readonly deps: ProviderContentEnforcementDeps,
    private readonly retiresAllHistoricalImages = false,
  ) {}

  /** `byteRecoveryAttempted` is internal: it bounds byte recovery to one pass. */
  async enforce(
    envelope: ProviderContentEnvelope,
    promptId: string,
    provider?: IProvider,
    byteRecoveryAttempted = false,
  ): Promise<IContent[]> {
    await this.deps.historyService.waitForTokenUpdates();
    const model = this.resolveModel(provider);
    const limits = this.computeContextLimits(provider, model);
    const contents = retireEnvelopeImages(envelope, this.mediaBudgetBytes());
    let initialProjected: number;
    try {
      initialProjected = await this.estimateProviderProjection(
        contents,
        limits.completionBudget,
        model,
        'initial',
      );
    } catch (error) {
      if (!isRelievableMediaPressure(error)) {
        throw error;
      }
      if (byteRecoveryAttempted) {
        return this.relieveMediaPressure(
          error,
          envelope,
          { promptId, provider },
          false,
        );
      }
      return this.recoverFromByteOverflow(
        error,
        envelope,
        contents,
        { promptId, provider, model },
        limits.completionBudget,
      );
    }

    try {
      return await this.enforceBeyondInitialProjection(
        envelope,
        contents,
        { promptId, model },
        limits,
        initialProjected,
      );
    } catch (error) {
      if (!isRelievableMediaPressure(error)) {
        throw error;
      }
      return this.relieveMediaPressure(
        error,
        envelope,
        { promptId, provider },
        true,
      );
    }
  }

  private async enforceBeyondInitialProjection(
    envelope: ProviderContentEnvelope,
    contents: IContent[],
    request: { promptId: string; model: string },
    limits: ContextLimits,
    initialProjected: number,
  ): Promise<IContent[]> {
    const earlyReturn = this.checkEarlyReturn(
      envelope,
      contents,
      limits,
      initialProjected,
    );
    if (earlyReturn !== undefined) {
      return earlyReturn;
    }
    if (envelope.pendingContents === undefined) {
      throw buildUnrecoverableBoundaryError(
        initialProjected,
        limits.marginAdjustedLimit,
      );
    }

    const postOpt = await this.optimizeAndProject(
      envelope.pendingContents,
      limits.completionBudget,
      request.model,
    );
    if (postOpt.projected <= limits.compressionThreshold) {
      return postOpt.contents;
    }

    return this.enforceWithEscalation(
      request.promptId,
      envelope.pendingContents,
      limits,
      request.model,
      initialProjected,
      postOpt.projected,
    );
  }

  /**
   * One bounded recovery from request-byte pressure that remains after image
   * retirement: a single compression pass when something other than the
   * pending request can shrink, otherwise the typed overflow with the pending
   * content untouched. Never retries an unchanged request.
   */
  private async recoverFromByteOverflow(
    error: RequestByteOverflowError,
    envelope: ProviderContentEnvelope,
    contents: IContent[],
    request: { promptId: string; provider?: IProvider; model: string },
    completionBudget: number,
  ): Promise<IContent[]> {
    const pending = envelope.pendingContents;
    const relieve = (
      cause: RequestByteOverflowError,
      historyChanged: boolean,
    ) => this.relieveMediaPressure(cause, envelope, request, historyChanged);
    if (pending === undefined) {
      return relieve(error, false);
    }
    // Classify with the boundary retirement protects, not the raw declared
    // count a hook or normalization may have invalidated.
    const pendingCount =
      envelope.contents.length -
      protectedRegionStart(envelope.contents, pending);
    if (!compressionCanRelieve(error, contents, pendingCount)) {
      return relieve(error, false);
    }
    // The outcome is classified before anything is projected: only a confirmed
    // compression may be recomposed from history. A failed one may have left
    // history half rewritten, so the saved pre-compression request is relieved.
    const compressionFailure = await this.runCompression(
      request.promptId,
      true,
    );
    if (compressionFailure !== undefined) {
      return relieve(error, false);
    }
    let recovered: ProjectionResult;
    try {
      recovered = await this.projectContents(
        pending,
        completionBudget,
        request.model,
        'post-byte-pressure-compression',
      );
    } catch (recoveryError) {
      if (!isRelievableMediaPressure(recoveryError)) {
        throw recoveryError;
      }
      return relieve(recoveryError, true);
    }
    return this.enforce(
      { ...envelope, contents: recovered.contents },
      request.promptId,
      request.provider,
      true,
    );
  }

  /**
   * Last-resort answer to byte pressure that compression and normal retirement
   * did not relieve (issue #4000): retire every image outside the protected
   * region and project once more. After a completed compression or
   * truncation (`historyChanged`) the history is recomposed from the curated
   * history, provided the envelope's pending tail is proven; otherwise the
   * envelope's own contents, including any hook edits, are relieved.
   *
   * The relieved request is then held to the context window like any other:
   * the bounded token escalation continues on an enforcer that keeps every
   * historical image retired, so no recomposition brings pixels back and no
   * second byte pass can start.
   */
  private async relieveMediaPressure(
    error: RequestByteOverflowError,
    envelope: ProviderContentEnvelope,
    request: { promptId: string; provider?: IProvider },
    historyChanged: boolean,
  ): Promise<IContent[]> {
    const model = this.resolveModel(request.provider);
    const limits = this.computeContextLimits(request.provider, model);
    const relieved = await relieveMediaPressure({
      error,
      envelope,
      historyChanged,
      budgetBytes: this.mediaBudgetBytes(),
      curated: () => this.deps.historyService.getCurated(),
      logger: this.deps.logger,
      project: (candidate) =>
        this.estimateProviderProjection(
          candidate,
          limits.completionBudget,
          model,
          'post-media-fallback',
        ),
    });
    return this.withHistoryImagesRetired().enforceBeyondInitialProjection(
      envelope,
      relieved.contents,
      { promptId: request.promptId, model },
      limits,
      relieved.projected,
    );
  }

  private withHistoryImagesRetired(): ProviderContentEnforcer {
    return this.retiresAllHistoricalImages
      ? this
      : new ProviderContentEnforcer(this.deps, true);
  }

  private checkEarlyReturn(
    envelope: ProviderContentEnvelope,
    contents: IContent[],
    limits: ContextLimits,
    initialProjected: number,
  ): IContent[] | undefined {
    if (initialProjected <= limits.compressionThreshold) {
      return contents;
    }
    if (
      envelope.pendingContents === undefined &&
      initialProjected <= limits.marginAdjustedLimit
    ) {
      return contents;
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
    projectedBeforeTruncation: number,
  ): Promise<IContent[]> {
    const truncationResult = await this.forceTruncation(
      promptId,
      pendingContents,
      limits.completionBudget,
      model,
      compressionFailure,
      computeHistoryTruncationTarget(
        projectedBeforeTruncation,
        limits.marginAdjustedLimit,
        this.deps.historyService.getTotalTokens(),
      ),
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
      throw buildOverflowError(
        limits.limit,
        limits.completionBudget,
        limits.marginAdjustedLimit,
        initialProjected,
        withToolTruncationFailure(truncationResult, toolTruncationFailure),
        0,
      );
    }

    if (toolTruncationResult.success) {
      return this.recomposeProviderContents(
        toolTruncationResult.transformedPending ?? pendingContents,
      );
    }

    throw buildOverflowError(
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

  /**
   * Compresses history and recomposes it with pending content, escalating
   * through the same reduction ladder as enforce() (density optimization,
   * compression, ineffective-compression retry, deficit-exact history
   * truncation, unified tool-response truncation) so a structurally
   * ineffective compression round no longer dead-ends the callback.
   *
   * When guard facts are supplied, the ladder targets the guard's limit minus
   * the per-request overhead the contents-only estimator cannot see, with no
   * completion budget of its own — the guard defines the contract being
   * satisfied (issue #3499). Without guard facts it converges against the
   * enforcer's own computed limits.
   *
   * @throws When even unified tool-response truncation cannot fit the target
   * (structured context-overflow error).
   */
  async compressAndRecompose(
    pendingContents: IContent[],
    promptId: string,
    guard?: CompressionGuardInfo,
    provider?: IProvider,
  ): Promise<IContent[]> {
    if (pendingContents.length === 0) {
      return [];
    }
    try {
      return await this.recomposeWithinLimits(
        pendingContents,
        promptId,
        guard,
        provider,
      );
    } catch (error) {
      if (
        !isRelievableMediaPressure(error) ||
        !this.canRelieveHistoryImages()
      ) {
        throw error;
      }
    }
    // Media pressure from history: repeat once with every historical image
    // retired, under the same guard-derived limits (issue #4000).
    try {
      return await this.withHistoryImagesRetired().recomposeWithinLimits(
        pendingContents,
        promptId,
        guard,
        provider,
      );
    } catch (error) {
      throw explainPendingOverflow(error, pendingContents);
    }
  }

  private canRelieveHistoryImages(): boolean {
    const curated = this.deps.historyService.getCurated();
    return (
      !this.retiresAllHistoricalImages &&
      this.mediaBudgetBytes() > 0 &&
      retireEveryHistoricalImage(curated, curated.length) !== curated
    );
  }

  private async recomposeWithinLimits(
    pendingContents: IContent[],
    promptId: string,
    guard: CompressionGuardInfo | undefined,
    provider: IProvider | undefined,
  ): Promise<IContent[]> {
    const model = this.resolveModel(provider);
    const { limits, initialProjected } = await this.computeCallbackLimits(
      pendingContents,
      guard,
      provider,
      model,
    );
    const postOpt = await this.optimizeAndProject(
      pendingContents,
      limits.completionBudget,
      model,
    );
    if (postOpt.projected <= limits.marginAdjustedLimit) {
      return postOpt.contents;
    }
    return this.enforceWithEscalation(
      promptId,
      pendingContents,
      limits,
      model,
      initialProjected,
      postOpt.projected,
    );
  }

  /**
   * Compression → ineffective-compression retry → truncation escalation
   * shared by the pre-send enforce() path and the provider compression
   * callback. Projections and limits must follow one budget convention per
   * call, supplied via `limits`.
   */
  private async enforceWithEscalation(
    promptId: string,
    pendingContents: IContent[],
    limits: ContextLimits,
    model: string,
    initialProjected: number,
    preCompressionProjected: number,
  ): Promise<IContent[]> {
    const firstResult = await this.runCompressionAndRecompose(
      promptId,
      pendingContents,
      limits.completionBudget,
      model,
    );
    if (firstResult.projected <= limits.marginAdjustedLimit) {
      return firstResult.contents;
    }

    const retryResult = await this.retryCompressionIfIneffective(
      promptId,
      pendingContents,
      limits.completionBudget,
      model,
      limits.marginAdjustedLimit,
      preCompressionProjected,
      firstResult,
    );
    if (retryResult.projected <= limits.marginAdjustedLimit) {
      return retryResult.contents;
    }

    return this.enforceTruncation(
      promptId,
      pendingContents,
      limits,
      model,
      initialProjected,
      retryResult.compressionFailure,
      retryResult.projected,
    );
  }

  /**
   * Limits for the compression-callback entry point. Guard facts override the
   * enforcer's own budget-derived limits: the guard's estimate covers the full
   * finalized envelope (tool schemas, system prompt) the contents-only
   * estimator cannot see, so that difference is treated as fixed overhead and
   * the fit predicate mirrors the guard's own check,
   * ownEstimate(contents') + overhead <= guard.contextLimit, with no
   * completion budget re-reserved (issue #3499).
   */
  private async computeCallbackLimits(
    pendingContents: IContent[],
    guard: CompressionGuardInfo | undefined,
    provider: IProvider | undefined,
    model: string,
  ): Promise<{ limits: ContextLimits; initialProjected: number }> {
    if (guard === undefined) {
      const limits = this.computeContextLimits(provider, model);
      const initialProjected = await this.estimateProviderProjection(
        this.recomposeProviderContents(pendingContents),
        limits.completionBudget,
        model,
        'initial',
      );
      return { limits, initialProjected };
    }
    const initialProjected = await this.estimateProviderProjection(
      this.recomposeProviderContents(pendingContents),
      0,
      model,
      'initial',
    );
    const overhead = Math.max(0, guard.estimatedTokens - initialProjected);
    const effectiveLimit = Math.max(1, guard.contextLimit - overhead);
    const limits: ContextLimits = {
      completionBudget: 0,
      limit: guard.contextLimit,
      marginAdjustedLimit: effectiveLimit,
      compressionThreshold: effectiveLimit,
    };
    return { limits, initialProjected };
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
    // Projection runs OUTSIDE runCompression's catch so a projection rejection
    // surfaces as a stage-aware error rather than being swallowed and
    // re-projected as a compression failure.
    const compressionFailure = await this.runCompression(promptId, false);
    return this.projectContents(
      pendingContents,
      completionBudget,
      model,
      stage,
      compressionFailure,
    );
  }

  /**
   * Runs one compression and classifies its outcome: the failure for an
   * exception, FAILED, NOOP or SKIPPED, undefined only for a confirmed
   * COMPRESSED. `propagateAbort` rethrows cancellation instead of treating it
   * as a failed compression.
   */
  private async runCompression(
    promptId: string,
    propagateAbort: boolean,
  ): Promise<Error | undefined> {
    try {
      const result = await this.deps.performCompression(promptId, {
        bypassCooldown: true,
        trigger: 'auto',
      });
      await this.deps.historyService.waitForTokenUpdates();
      if (result === PerformCompressionResult.COMPRESSED) {
        return undefined;
      }
      this.deps.logger.debug(
        () =>
          `[CompressionHandler] Provider-content compression finished without COMPRESSED result: ${result}`,
      );
      return new Error(
        `Auto compression did not complete during hard-limit enforcement (result: ${result})`,
      );
    } catch (error) {
      if (propagateAbort && isAbortLikeError(error)) {
        throw error;
      }
      const compressionError = this.normalizeError(error);
      this.deps.logger.warn(
        () =>
          '[CompressionHandler] Auto compression failed during hard-limit enforcement',
        compressionError,
      );
      return compressionError;
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
    targetTokenCount: number | undefined,
  ): Promise<OverflowReductionResult> {
    const fallbackOutcome = await executeFallbackTruncation(
      this.deps,
      promptId,
      targetTokenCount,
    );
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

  /**
   * Every recomposition (after density optimization, compression or
   * truncation) re-applies image retirement to the curated history before the
   * pending region is appended, so no step can resurrect retired pixels.
   */
  private recomposeProviderContents(pendingContents: IContent[]): IContent[] {
    const curated = this.deps.historyService.getCurated();
    const history = this.retiresAllHistoricalImages
      ? retireEveryHistoricalImage(curated, curated.length)
      : retireHistoricalImages(
          curated,
          pendingContents,
          this.mediaBudgetBytes(),
        );
    return buildProviderContent(history, pendingContents, this.deps.logger);
  }

  private mediaBudgetBytes(): number {
    return (
      this.deps.requestMediaBudgetBytes ?? DEFAULT_REQUEST_MEDIA_BUDGET_BYTES
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
      if (isRequestByteOverflowError(error)) {
        throw error;
      }
      const projectionError = this.normalizeError(error);
      throw new Error(
        `Token projection failed at ${stage} stage during provider-content hard-limit enforcement: ${projectionError.message}`,
        { cause: projectionError },
      );
    }
  }

  private computeContextLimits(
    provider: IProvider | undefined,
    model: string,
  ): ContextLimits {
    const { ephemerals } = this.deps.runtimeContext;
    return computeContextLimits(
      {
        userContextLimit: ephemerals.contextLimit(),
        compressionThreshold: ephemerals.compressionThreshold(),
        generationConfig: this.deps.generationConfig,
        completionBudgetSetting: this.deps.readCompletionBudgetSetting(),
      },
      provider,
      model,
    );
  }

  private normalizeError(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }
    return new Error(String(error));
  }
}
