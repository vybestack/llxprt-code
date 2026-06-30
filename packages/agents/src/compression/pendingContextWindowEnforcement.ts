/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type {
  CompressionContext,
  CompressionResult,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { buildContextOverflowError } from './contextOverflowError.js';

export interface ContextLimits {
  completionBudget: number;
  limit: number;
  marginAdjustedLimit: number;
}

interface ReductionResult {
  projected: number;
  truncationFailure?: Error;
  compressionFailure?: Error;
}

export interface PendingContextWindowEnforcerDeps {
  historyService: HistoryService;
  logger: DebugLogger;
  ineffectiveCompressionReductionThreshold: number;
  getContextLimits(provider?: IProvider): ContextLimits;
  computeProjectedTokens(
    pendingTokens: number,
    completionBudget: number,
  ): number;
  ensureDensityOptimized(): Promise<void>;
  performCompression(
    promptId: string,
    options: { bypassCooldown: true; trigger: 'auto' },
  ): Promise<PerformCompressionResult>;
  buildCompressionContext(promptId: string): Promise<CompressionContext>;
  compressWithFallbackStrategy(
    context: CompressionContext,
  ): Promise<CompressionResult>;
  applyFallbackCompressionResult(
    result: CompressionResult,
    applyResult: (newHistory: IContent[]) => void,
  ): void;
  setSuppressDensityDirty(value: boolean): void;
  recordCompressionFailure(): void;
  resetLastPromptTokenCount(): void;
  getRuntimeModel(): string;
}

export class PendingContextWindowEnforcer {
  constructor(private readonly deps: PendingContextWindowEnforcerDeps) {}

  async enforce(
    pendingTokens: number,
    promptId: string,
    provider?: IProvider,
  ): Promise<void> {
    await this.deps.historyService.waitForTokenUpdates();

    const { completionBudget, limit, marginAdjustedLimit } =
      this.deps.getContextLimits(provider);

    const initialProjected = this.deps.computeProjectedTokens(
      pendingTokens,
      completionBudget,
    );
    if (initialProjected <= marginAdjustedLimit) {
      return;
    }

    this.logInitialOverflow(initialProjected, marginAdjustedLimit, {
      completionBudget,
      pendingTokens,
    });

    await this.deps.ensureDensityOptimized();
    await this.deps.historyService.waitForTokenUpdates();

    const postOptProjected = this.deps.computeProjectedTokens(
      pendingTokens,
      completionBudget,
    );
    if (this.isWithinLimitAfterDensity(postOptProjected, marginAdjustedLimit)) {
      return;
    }

    const compressionFailure = await this.tryAutoCompression(promptId);
    let recomputed = this.deps.computeProjectedTokens(
      pendingTokens,
      completionBudget,
    );
    if (this.isWithinLimitAfterCompression(recomputed, marginAdjustedLimit)) {
      return;
    }

    const reductionResult = await this.reduceOverflow({
      promptId,
      preCompressionProjected: postOptProjected,
      postCompressionProjected: recomputed,
      marginAdjustedLimit,
      pendingTokens,
      completionBudget,
      compressionFailure,
    });
    recomputed = reductionResult.projected;
    if (recomputed <= marginAdjustedLimit) {
      return;
    }

    throw buildContextOverflowError({
      limit,
      initialProjected,
      finalProjected: recomputed,
      marginAdjustedLimit,
      completionBudget,
      truncationFailure: reductionResult.truncationFailure,
      compressionFailure: reductionResult.compressionFailure,
    });
  }

  private logInitialOverflow(
    projected: number,
    marginAdjustedLimit: number,
    details: { completionBudget: number; pendingTokens: number },
  ): void {
    this.deps.logger.warn(
      () =>
        '[CompressionHandler] Projected token usage exceeds context limit, attempting compression',
      {
        projected,
        marginAdjustedLimit,
        ...details,
      },
    );
  }

  private isWithinLimitAfterDensity(
    postOptProjected: number,
    marginAdjustedLimit: number,
  ): boolean {
    if (postOptProjected > marginAdjustedLimit) {
      return false;
    }
    this.deps.logger.debug(
      () =>
        '[CompressionHandler] Density optimization reduced tokens below limit',
      { postOptProjected, marginAdjustedLimit },
    );
    return true;
  }

  private isWithinLimitAfterCompression(
    recomputed: number,
    marginAdjustedLimit: number,
  ): boolean {
    if (recomputed > marginAdjustedLimit) {
      return false;
    }
    this.deps.logger.debug(
      () => '[CompressionHandler] Compression reduced tokens below limit',
      { recomputed, marginAdjustedLimit },
    );
    return true;
  }

  private async tryAutoCompression(
    promptId: string,
  ): Promise<Error | undefined> {
    try {
      const result = await this.deps.performCompression(promptId, {
        bypassCooldown: true,
        trigger: 'auto',
      });
      await this.deps.historyService.waitForTokenUpdates();
      if (result === PerformCompressionResult.FAILED) {
        return this.recordAutoCompressionFailure(
          new Error('Auto compression failed during hard-limit enforcement'),
        );
      }
      return undefined;
    } catch (error) {
      const compressionError = this.normalizeError(error);
      this.deps.recordCompressionFailure();
      this.recordAutoCompressionFailure(compressionError);
      await this.deps.historyService.waitForTokenUpdates();
      return compressionError;
    }
  }

  private recordAutoCompressionFailure(error: Error): Error {
    this.deps.logger.warn(
      () =>
        '[CompressionHandler] Auto compression failed during hard-limit enforcement, trying fallback reduction',
      error,
    );
    return error;
  }

  private async reduceOverflow(input: {
    promptId: string;
    preCompressionProjected: number;
    postCompressionProjected: number;
    marginAdjustedLimit: number;
    pendingTokens: number;
    completionBudget: number;
    compressionFailure: Error | undefined;
  }): Promise<ReductionResult> {
    const compressionRetryResult =
      await this.retryFullCompressionIfIneffective(input);
    if (compressionRetryResult.projected <= input.marginAdjustedLimit) {
      return compressionRetryResult;
    }

    return this.forceTruncationIfStillOverLimit({
      promptId: input.promptId,
      postCompressionProjected: compressionRetryResult.projected,
      marginAdjustedLimit: input.marginAdjustedLimit,
      pendingTokens: input.pendingTokens,
      completionBudget: input.completionBudget,
      compressionFailure: compressionRetryResult.compressionFailure,
    });
  }

  private async retryFullCompressionIfIneffective(input: {
    promptId: string;
    preCompressionProjected: number;
    postCompressionProjected: number;
    marginAdjustedLimit: number;
    pendingTokens: number;
    completionBudget: number;
    compressionFailure: Error | undefined;
  }): Promise<{ projected: number; compressionFailure?: Error }> {
    const reduction =
      input.preCompressionProjected - input.postCompressionProjected;
    const reductionRatio =
      input.preCompressionProjected > 0
        ? reduction / input.preCompressionProjected
        : 0;
    if (this.shouldSkipCompressionRetry(input, reductionRatio)) {
      return {
        projected: input.postCompressionProjected,
        compressionFailure: input.compressionFailure,
      };
    }

    this.logCompressionRetry(input, reductionRatio);
    return this.runAdditionalCompressionAttempt(input);
  }

  private shouldSkipCompressionRetry(
    input: {
      postCompressionProjected: number;
      marginAdjustedLimit: number;
      compressionFailure: Error | undefined;
    },
    reductionRatio: number,
  ): boolean {
    return (
      input.compressionFailure !== undefined ||
      reductionRatio >= this.deps.ineffectiveCompressionReductionThreshold ||
      input.postCompressionProjected <= input.marginAdjustedLimit
    );
  }

  private logCompressionRetry(
    input: {
      preCompressionProjected: number;
      postCompressionProjected: number;
      marginAdjustedLimit: number;
    },
    reductionRatio: number,
  ): void {
    this.deps.logger.warn(
      () =>
        '[CompressionHandler] Auto compression remained ineffective, retrying full compression before truncation',
      {
        preCompressionProjected: input.preCompressionProjected,
        postCompressionProjected: input.postCompressionProjected,
        reductionRatio,
        tokensStillNeeded:
          input.postCompressionProjected - input.marginAdjustedLimit,
      },
    );
  }

  private async runAdditionalCompressionAttempt(input: {
    promptId: string;
    pendingTokens: number;
    completionBudget: number;
  }): Promise<{ projected: number; compressionFailure?: Error }> {
    try {
      const result = await this.deps.performCompression(input.promptId, {
        bypassCooldown: true,
        trigger: 'auto',
      });
      await this.deps.historyService.waitForTokenUpdates();
      if (result === PerformCompressionResult.FAILED) {
        const retryError = new Error(
          'Additional hard-limit compression attempt failed',
        );
        this.logAdditionalCompressionFailure(retryError);
        return this.projectWithCompressionFailure(input, retryError);
      }
      return {
        projected: this.deps.computeProjectedTokens(
          input.pendingTokens,
          input.completionBudget,
        ),
      };
    } catch (error) {
      const retryError = this.normalizeError(error);
      this.deps.recordCompressionFailure();
      this.logAdditionalCompressionFailure(retryError);
      return this.projectWithCompressionFailure(input, retryError);
    }
  }

  private logAdditionalCompressionFailure(error: Error): void {
    this.deps.logger.warn(
      () =>
        '[CompressionHandler] Additional hard-limit compression attempt failed',
      error,
    );
  }

  private projectWithCompressionFailure(
    input: { pendingTokens: number; completionBudget: number },
    compressionFailure: Error,
  ): { projected: number; compressionFailure: Error } {
    return {
      projected: this.deps.computeProjectedTokens(
        input.pendingTokens,
        input.completionBudget,
      ),
      compressionFailure,
    };
  }

  private async forceTruncationIfStillOverLimit(input: {
    promptId: string;
    postCompressionProjected: number;
    marginAdjustedLimit: number;
    pendingTokens: number;
    completionBudget: number;
    compressionFailure: Error | undefined;
  }): Promise<ReductionResult> {
    if (input.postCompressionProjected <= input.marginAdjustedLimit) {
      return {
        projected: input.postCompressionProjected,
        compressionFailure: input.compressionFailure,
      };
    }

    this.logTruncationFallback(input);
    this.deps.setSuppressDensityDirty(true);
    let truncationFailure: Error | undefined;
    try {
      const context = await this.deps.buildCompressionContext(input.promptId);
      const result = await this.deps.compressWithFallbackStrategy(context);
      this.applyFallbackCompressionResult(result);
      this.deps.logger.debug(
        'Compression completed with hard-limit fallback (TopDownTruncation)',
      );
      await this.deps.historyService.waitForTokenUpdates();
    } catch (error) {
      truncationFailure = this.normalizeError(error);
      this.deps.recordCompressionFailure();
      this.logTruncationFallbackFailure(truncationFailure);
    } finally {
      this.deps.setSuppressDensityDirty(false);
    }

    return {
      projected: this.deps.computeProjectedTokens(
        input.pendingTokens,
        input.completionBudget,
      ),
      truncationFailure,
      compressionFailure: input.compressionFailure,
    };
  }

  private logTruncationFallback(input: {
    postCompressionProjected: number;
    marginAdjustedLimit: number;
  }): void {
    this.deps.logger.warn(
      () =>
        '[CompressionHandler] Context remains over limit, forcing truncation fallback',
      {
        postCompressionProjected: input.postCompressionProjected,
        marginAdjustedLimit: input.marginAdjustedLimit,
        tokensStillNeeded:
          input.postCompressionProjected - input.marginAdjustedLimit,
      },
    );
  }

  private applyFallbackCompressionResult(result: CompressionResult): void {
    this.deps.applyFallbackCompressionResult(result, (newHistory) => {
      this.deps.historyService.clear();
      for (const content of newHistory) {
        this.deps.historyService.add(content, this.deps.getRuntimeModel());
      }
      this.deps.resetLastPromptTokenCount();
    });
  }

  private logTruncationFallbackFailure(error: Error): void {
    this.deps.logger.warn(
      () =>
        '[CompressionHandler] Truncation fallback failed during hard-limit enforcement',
      error,
    );
  }

  private normalizeError(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }
    return new Error(String(error));
  }
}
