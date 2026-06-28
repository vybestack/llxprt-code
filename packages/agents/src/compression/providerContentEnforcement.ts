/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GenerateContentConfig } from '@google/genai';
import { buildProviderContent } from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { getCompletionBudget } from './compressionBudgeting.js';
import { tokenLimit } from '@vybestack/llxprt-code-core/core/tokenLimits.js';
import { isDeepStrictEqual } from 'node:util';

const TOKEN_SAFETY_MARGIN = 1000;
const INEFFECTIVE_COMPRESSION_REDUCTION_THRESHOLD = 0.05;
const COMPLETION_BUDGET_WARNING_RATIO = 0.8;
const MAX_RECOMPOSITION_SCAN = 64;
const RECOMPOSITION_SCAN_SIZE_LIMIT = MAX_RECOMPOSITION_SCAN * 4;
type CompletionSettingsService = { get: (key: string) => unknown };

export interface ProviderContentEnforcementDeps {
  historyService: HistoryService;
  runtimeContext: AgentRuntimeContext;
  generationConfig: GenerateContentConfig;
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
}

interface PendingExtractionResult {
  pendingContents: IContent[];
  safeToRecompose: boolean;
}

export class ProviderContentEnforcer {
  private readonly baselineProviderHistory: IContent[];

  constructor(private readonly deps: ProviderContentEnforcementDeps) {
    this.baselineProviderHistory = deps.historyService.getCuratedForProvider();
  }

  async enforce(
    contents: IContent[],
    promptId: string,
    provider?: IProvider,
  ): Promise<IContent[]> {
    await this.deps.historyService.waitForTokenUpdates();
    const { completionBudget, limit, marginAdjustedLimit } =
      this.computeContextLimits(provider);
    const initialProjected = await this.estimateProviderProjection(
      contents,
      completionBudget,
    );
    const extraction = this.extractPendingContents(contents);
    if (initialProjected <= marginAdjustedLimit) {
      if (!extraction.safeToRecompose) {
        return contents;
      }
      const recomposedContents = this.recomposeProviderContents(
        extraction.pendingContents,
      );
      const recomposedProjected = await this.estimateProviderProjection(
        recomposedContents,
        completionBudget,
      );
      if (recomposedProjected <= marginAdjustedLimit) {
        return recomposedContents;
      }
    }
    if (!extraction.safeToRecompose) {
      this.throwUnsafeExtractionOverflow(
        limit,
        initialProjected,
        marginAdjustedLimit,
        completionBudget,
      );
    }
    await this.deps.ensureDensityOptimized();
    await this.deps.historyService.waitForTokenUpdates();

    const optimizedContents = this.recomposeProviderContents(
      extraction.pendingContents,
    );
    const postOptProjected = await this.estimateProviderProjection(
      optimizedContents,
      completionBudget,
    );
    if (postOptProjected <= marginAdjustedLimit) {
      return optimizedContents;
    }

    const compressedContents = await this.runCompressionAndRecompose(
      promptId,
      extraction.pendingContents,
    );
    let recomputed = await this.estimateProviderProjection(
      compressedContents,
      completionBudget,
    );
    if (recomputed <= marginAdjustedLimit) {
      return compressedContents;
    }

    const fallbackContents = await this.forceTruncationIfIneffective(
      promptId,
      postOptProjected,
      recomputed,
      extraction.pendingContents,
    );
    recomputed = await this.estimateProviderProjection(
      fallbackContents,
      completionBudget,
    );
    if (recomputed <= marginAdjustedLimit) {
      return fallbackContents;
    }

    throw this.buildContextOverflowError(
      limit,
      initialProjected,
      recomputed,
      marginAdjustedLimit,
      completionBudget,
    );
  }

  async compressAndRecompose(
    contents: IContent[],
    promptId: string,
  ): Promise<IContent[]> {
    const extraction = this.extractPendingContents(contents);
    if (!extraction.safeToRecompose) {
      return contents;
    }
    return this.runCompressionAndRecompose(
      promptId,
      extraction.pendingContents,
    );
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

  private extractPendingContents(
    contents: IContent[],
  ): PendingExtractionResult {
    const prefixLength = this.findHistoryPrefixLength(
      contents,
      this.baselineProviderHistory,
    );
    if (
      this.baselineProviderHistory.length === 0 ||
      prefixLength === this.baselineProviderHistory.length
    ) {
      return {
        pendingContents: contents.slice(prefixLength),
        safeToRecompose: true,
      };
    }

    const recomposedPending =
      this.extractPendingContentsByRecomposition(contents);
    if (recomposedPending !== undefined) {
      return {
        pendingContents: recomposedPending,
        safeToRecompose: true,
      };
    }

    this.deps.logger.warn(
      () =>
        '[CompressionHandler] Could not extract pending contents via prefix match or recomposition; preserving provider contents unchanged',
    );
    return { pendingContents: [], safeToRecompose: false };
  }

  private extractPendingContentsByRecomposition(
    contents: IContent[],
  ): IContent[] | undefined {
    if (contents.length > RECOMPOSITION_SCAN_SIZE_LIMIT) {
      return undefined;
    }
    const targetStart = this.deps.historyService.getCurated().length;
    const minStart = Math.max(0, contents.length - MAX_RECOMPOSITION_SCAN);
    if (targetStart < minStart || targetStart > contents.length) {
      return undefined;
    }
    const candidatePending = contents.slice(targetStart);
    const recomposed = this.recomposeProviderContents(candidatePending);
    return this.contentsEqual(recomposed, contents)
      ? candidatePending
      : undefined;
  }

  private findHistoryPrefixLength(
    contents: IContent[],
    providerHistory: IContent[],
  ): number {
    const maxPrefix = Math.min(contents.length, providerHistory.length);
    let prefix = 0;
    for (let index = 0; index < maxPrefix; index++) {
      if (!isDeepStrictEqual(contents[index], providerHistory[index])) {
        break;
      }
      prefix = index + 1;
    }
    return prefix;
  }

  private throwUnsafeExtractionOverflow(
    limit: number,
    projected: number,
    marginAdjustedLimit: number,
    completionBudget: number,
  ): never {
    throw this.buildContextOverflowError(
      limit,
      projected,
      projected,
      marginAdjustedLimit,
      completionBudget,
    );
  }

  private contentsEqual(left: IContent[], right: IContent[]): boolean {
    return isDeepStrictEqual(left, right);
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
  ): Promise<number> {
    const requestTokens =
      await this.deps.historyService.estimateTokensForContents(
        contents,
        this.deps.runtimeContext.state.model,
      );
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

  private computeContextLimits(provider?: IProvider): ContextLimits {
    const completionBudget = Math.max(
      0,
      getCompletionBudget(
        this.deps.generationConfig,
        this.deps.runtimeContext.state.model,
        provider,
        this.deps.providerRuntimeNullable?.settingsService,
      ),
    );
    const userContextLimit = this.deps.runtimeContext.ephemerals.contextLimit();
    const limit = tokenLimit(
      this.deps.runtimeContext.state.model,
      userContextLimit,
    );
    return {
      completionBudget,
      limit,
      marginAdjustedLimit: this.computeMarginAdjustedLimit(limit),
    };
  }

  private buildContextOverflowError(
    limit: number,
    initialProjected: number,
    finalProjected: number,
    marginAdjustedLimit: number,
    completionBudget: number,
  ): Error {
    const totalReduction = Math.max(0, initialProjected - finalProjected);
    const tokensStillNeeded = finalProjected - marginAdjustedLimit;
    const parts: string[] = [
      `Request still exceeds the safety-adjusted context limit (${marginAdjustedLimit} tokens).`,
      `Density optimization and compression reduced ${totalReduction} tokens (from ${initialProjected} to ${finalProjected} projected).`,
      `completionBudget=${completionBudget}, tokensStillNeeded=${tokensStillNeeded}.`,
    ];
    if (completionBudget > COMPLETION_BUDGET_WARNING_RATIO * limit) {
      parts.push(
        `The completion budget (${completionBudget}) consumes more than ${COMPLETION_BUDGET_WARNING_RATIO * 100}% of the context window (${limit}). Consider lowering maxOutputTokens.`,
      );
    }
    return new Error(parts.join(' '));
  }
}
