/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import os from 'node:os';
import path from 'node:path';
import type { GenerateContentConfig } from '@google/genai';
import type { HistoryService } from '../../services/history/HistoryService.js';
import type { IContent } from '../../services/history/IContent.js';
import type { AgentRuntimeContext } from '../../runtime/AgentRuntimeContext.js';
import type { IProvider } from '../../providers/IProvider.js';
import type { CompressionContext, DensityConfig } from './types.js';
import {
  shouldRetryCompressionError,
  isTransientCompressionError,
} from './types.js';
import {
  getCompressionStrategy,
  parseCompressionStrategyName,
} from './compressionStrategyFactory.js';
import {
  extractThinkingBlocks,
  estimateThinkingTokens,
} from '../../providers/reasoning/reasoningUtils.js';
import { PromptResolver } from '../../prompt-config/prompt-resolver.js';
import { DebugLogger } from '../../debug/index.js';
import { retryWithBackoff } from '../../utils/retry.js';
import { tokenLimit } from '../tokenLimits.js';
import {
  estimatePendingTokens,
  getCompletionBudget,
} from './compressionBudgeting.js';

/**
 * CompressionHandler orchestrates all compression logic for GeminiChat.
 * Manages compression state, retry/fallback logic, and density optimization.
 *
 * @plan PLAN-20260220-DECOMPOSE.P03
 * @requirement Module 3 specification
 */
export class CompressionHandler {
  static readonly TOKEN_SAFETY_MARGIN = 1000;
  static readonly DEFAULT_COMPLETION_BUDGET = 65_536;
  static readonly COMPRESSION_COOLDOWN_MS = 60_000;
  static readonly COMPRESSION_FAILURE_THRESHOLD = 3;
  static readonly INEFFECTIVE_COMPRESSION_REDUCTION_THRESHOLD = 0.05;

  private compressionPromise: Promise<void> | null = null;
  private compressionFailureCount: number = 0;
  private lastCompressionFailureTime: number | null = null;
  densityDirty: boolean = true;
  _suppressDensityDirty: boolean = false;
  private activeTodosProvider?: () => Promise<string | undefined>;
  lastPromptTokenCount: number | null = null;

  private logger = new DebugLogger('llxprt:gemini:compression');

  constructor(
    private readonly runtimeContext: AgentRuntimeContext,
    private readonly historyService: HistoryService,
    private readonly generationConfig: GenerateContentConfig,
    private readonly providerResolver: (contextLabel: string) => IProvider,
    private readonly hookTrigger: (
      context: CompressionContext,
    ) => Promise<void>,
  ) {}

  /**
   * Calculate effective token count based on reasoning settings.
   * Accounts for whether reasoning will be included in API calls.
   *
   * @plan PLAN-20251202-THINKING.P15
   * @requirement REQ-THINK-005.1, REQ-THINK-005.2
   */
  getEffectiveTokenCount(): number {
    const includeInContext =
      this.runtimeContext.ephemerals.reasoning.includeInContext();
    const stripPolicy =
      this.runtimeContext.ephemerals.reasoning.stripFromContext();

    // If reasoning IS included in context, all tokens count
    if (includeInContext) {
      return this.historyService.getTotalTokens();
    }

    // If reasoning is NOT included, calculate actual reduction
    const allContents = this.historyService.getCurated();
    const rawTokens = this.historyService.getTotalTokens();

    let thinkingTokensToStrip = 0;

    if (stripPolicy === 'all') {
      // Sum up all thinking tokens
      for (const content of allContents) {
        const thinkingBlocks = extractThinkingBlocks(content);
        thinkingTokensToStrip += estimateThinkingTokens(thinkingBlocks);
      }
    } else if (stripPolicy === 'allButLast') {
      // Find last content with thinking blocks
      let lastIndexWithThinking = -1;
      for (let i = allContents.length - 1; i >= 0; i--) {
        if (extractThinkingBlocks(allContents[i]).length > 0) {
          lastIndexWithThinking = i;
          break;
        }
      }

      // Strip thinking from all except that last one
      for (let i = 0; i < allContents.length; i++) {
        if (i !== lastIndexWithThinking) {
          const thinkingBlocks = extractThinkingBlocks(allContents[i]);
          thinkingTokensToStrip += estimateThinkingTokens(thinkingBlocks);
        }
      }
    } else {
      // stripPolicy === 'none': but includeInContext=false means they won't be sent
      // Strip ALL thinking for effective count
      for (const content of allContents) {
        const thinkingBlocks = extractThinkingBlocks(content);
        thinkingTokensToStrip += estimateThinkingTokens(thinkingBlocks);
      }
    }

    return Math.max(0, rawTokens - thinkingTokensToStrip);
  }

  /**
   * Run density optimization if the active strategy supports it and new content exists.
   * Called before threshold check in ensureCompressionBeforeSend and enforceContextWindow.
   *
   * @plan PLAN-20260211-HIGHDENSITY.P20
   * @requirement REQ-HD-002.1-002.9
   */
  async ensureDensityOptimized(): Promise<void> {
    // REQ-HD-002.3: Skip if no new content since last optimization
    if (!this.densityDirty) {
      return;
    }

    try {
      // Step 1: Resolve the active compression strategy
      const strategyName = parseCompressionStrategyName(
        this.runtimeContext.ephemerals.compressionStrategy(),
      );
      const strategy = getCompressionStrategy(strategyName);

      // REQ-HD-002.2: If strategy has no optimize method or trigger isn't continuous
      if (!strategy.optimize || strategy.trigger?.mode !== 'continuous') {
        return;
      }

      // Check threshold: use ephemeral override or strategy's defaultThreshold
      const contextLimit = this.runtimeContext.ephemerals.contextLimit();
      const optimizeThreshold =
        this.runtimeContext.ephemerals.densityOptimizeThreshold() ??
        strategy.trigger.defaultThreshold;
      const currentTokens = this.historyService.getTotalTokens();
      const currentUsage = currentTokens / contextLimit;

      if (currentUsage < optimizeThreshold) {
        this.logger.debug(
          () =>
            `[CompressionHandler] Skipping density optimization: ${(currentUsage * 100).toFixed(1)}% < ${(optimizeThreshold * 100).toFixed(1)}% threshold`,
        );
        return;
      }

      // Step 2: Build DensityConfig from ephemerals
      const config: DensityConfig = {
        readWritePruning:
          this.runtimeContext.ephemerals.densityReadWritePruning(),
        fileDedupe: this.runtimeContext.ephemerals.densityFileDedupe(),
        recencyPruning: this.runtimeContext.ephemerals.densityRecencyPruning(),
        recencyRetention:
          this.runtimeContext.ephemerals.densityRecencyRetention(),
        workspaceRoot: process.cwd(),
      };

      // Step 3: Get raw history (REQ-HD-002.9)
      const history = this.historyService.getRawHistory();

      // Step 4: Run optimization
      const result = strategy.optimize(history, config);

      // REQ-HD-002.5: Short-circuit if no changes
      if (result.removals.length === 0 && result.replacements.size === 0) {
        this.logger.debug(
          () => '[CompressionHandler] Density optimization produced no changes',
        );
        return;
      }

      // Step 5: Apply result (REQ-HD-002.4)
      this.logger.debug(
        () => '[CompressionHandler] Applying density optimization',
        {
          removals: result.removals.length,
          replacements: result.replacements.size,
          metadata: result.metadata,
        },
      );

      await this.historyService.applyDensityResult(result);
      await this.historyService.waitForTokenUpdates();
    } finally {
      // REQ-HD-002.7: Always clear dirty flag, even on error or no-op
      this.densityDirty = false;
    }
  }

  /**
   * Check if compression is needed based on token count.
   * Includes system prompt in both actual API count and estimated count paths.
   *
   * @plan PLAN-20251028-STATELESS6.P10
   * @requirement REQ-STAT6-002.2
   */
  shouldCompress(pendingTokens: number = 0): boolean {
    // Calculate fresh each time to respect runtime setting changes
    const threshold = this.runtimeContext.ephemerals.compressionThreshold();
    const contextLimit = this.runtimeContext.ephemerals.contextLimit();
    const completionBudget = Math.max(
      0,
      getCompletionBudget(
        this.generationConfig,
        this.runtimeContext.state.model,
        undefined,
        this.runtimeContext.providerRuntime?.settingsService,
      ),
    );
    const effectiveLimit = Math.max(0, contextLimit - completionBudget);
    const compressionThreshold = threshold * effectiveLimit;

    this.logger.debug('Compression threshold:', {
      threshold,
      contextLimit,
      completionBudget,
      effectiveLimit,
      compressionThreshold,
    });

    // Use lastPromptTokenCount (actual API data) when available, else fall back
    const baseTokenCount =
      this.lastPromptTokenCount !== null && this.lastPromptTokenCount > 0
        ? this.lastPromptTokenCount
        : this.getEffectiveTokenCount();

    const currentTokens = baseTokenCount + Math.max(0, pendingTokens);
    const shouldCompress = currentTokens >= compressionThreshold;

    if (shouldCompress) {
      this.logger.debug('Compression needed:', {
        currentTokens,
        threshold: compressionThreshold,
        usingActualApiCount:
          this.lastPromptTokenCount !== null && this.lastPromptTokenCount > 0,
      });
    }

    return shouldCompress;
  }

  /**
   * Ensure compression runs before sending a message if needed.
   * Waits for ongoing compression and triggers new compression if threshold reached.
   *
   * @plan PLAN-20260220-DECOMPOSE.P03
   */
  async ensureCompressionBeforeSend(
    prompt_id: string,
    pendingTokens: number,
    source: 'send' | 'stream',
  ): Promise<void> {
    if (this.compressionPromise) {
      this.logger.debug('Waiting for ongoing compression to complete');
      try {
        await this.compressionPromise;
      } finally {
        this.compressionPromise = null;
      }
    }

    await this.historyService.waitForTokenUpdates();

    // @plan PLAN-20260211-HIGHDENSITY.P18
    // @requirement REQ-HD-002.1
    await this.ensureDensityOptimized();

    if (this.shouldCompress(pendingTokens)) {
      const triggerMessage =
        source === 'stream'
          ? 'Triggering compression before message send in stream'
          : 'Triggering compression before message send';
      this.logger.debug(triggerMessage, {
        pendingTokens,
        historyTokens: this.historyService.getTotalTokens(),
      });
      this.compressionPromise = this.performCompression(prompt_id);
      try {
        await this.compressionPromise;
      } finally {
        this.compressionPromise = null;
      }
    }
  }

  /**
   * Enforce hard context window limits with compression and density optimization.
   * Throws if limits cannot be satisfied even after compression.
   *
   * @plan PLAN-20260220-DECOMPOSE.P03
   */
  /**
   * Compute the baseline prompt token count for hard-limit projection.
   * Prefer API-observed prompt tokens when available (includes cache read/write).
   */
  private getProjectedPromptBaseline(): number {
    return this.lastPromptTokenCount !== null && this.lastPromptTokenCount > 0
      ? this.lastPromptTokenCount
      : this.getEffectiveTokenCount();
  }

  /**
   * Compute the projected token count for a pending request.
   */
  private computeProjectedTokens(
    pendingTokens: number,
    completionBudget: number,
  ): number {
    return (
      this.getProjectedPromptBaseline() +
      Math.max(0, pendingTokens) +
      completionBudget
    );
  }

  async enforceContextWindow(
    pendingTokens: number,
    promptId: string,
    provider?: IProvider,
  ): Promise<void> {
    await this.historyService.waitForTokenUpdates();

    const completionBudget = Math.max(
      0,
      getCompletionBudget(
        this.generationConfig,
        this.runtimeContext.state.model,
        provider,
        this.runtimeContext.providerRuntime?.settingsService,
      ),
    );
    const userContextLimit = this.runtimeContext.ephemerals.contextLimit();
    const limit = tokenLimit(this.runtimeContext.state.model, userContextLimit);
    const marginAdjustedLimit = Math.max(
      0,
      limit - CompressionHandler.TOKEN_SAFETY_MARGIN,
    );

    const initialProjected = this.computeProjectedTokens(
      pendingTokens,
      completionBudget,
    );
    if (initialProjected <= marginAdjustedLimit) {
      return;
    }

    this.logger.warn(
      () =>
        `[CompressionHandler] Projected token usage exceeds context limit, attempting compression`,
      {
        projected: initialProjected,
        marginAdjustedLimit,
        completionBudget,
        pendingTokens,
      },
    );

    // @plan PLAN-20260211-HIGHDENSITY.P18
    // @requirement REQ-HD-002.8
    await this.ensureDensityOptimized();
    await this.historyService.waitForTokenUpdates();

    const postOptProjected = this.computeProjectedTokens(
      pendingTokens,
      completionBudget,
    );
    if (postOptProjected <= marginAdjustedLimit) {
      this.logger.debug(
        () =>
          '[CompressionHandler] Density optimization reduced tokens below limit',
        { postOptProjected, marginAdjustedLimit },
      );
      return;
    }

    const preCompressionProjected = postOptProjected;

    await this.performCompression(promptId, { bypassCooldown: true });
    await this.historyService.waitForTokenUpdates();

    let recomputed = this.computeProjectedTokens(
      pendingTokens,
      completionBudget,
    );
    if (recomputed <= marginAdjustedLimit) {
      this.logger.debug(
        () => '[CompressionHandler] Compression reduced tokens below limit',
        { recomputed, marginAdjustedLimit },
      );
      return;
    }

    // If compression barely reduced tokens, force truncation fallback
    recomputed = await this.forceTruncationIfIneffective(
      promptId,
      preCompressionProjected,
      recomputed,
      marginAdjustedLimit,
      pendingTokens,
      completionBudget,
    );
    if (recomputed <= marginAdjustedLimit) {
      return;
    }

    throw this.buildContextOverflowError(
      limit,
      initialProjected,
      recomputed,
      marginAdjustedLimit,
      completionBudget,
    );
  }

  /**
   * Force truncation fallback when primary compression was ineffective.
   * Returns the recomputed projected token count after fallback attempt.
   */
  private async forceTruncationIfIneffective(
    promptId: string,
    preCompressionProjected: number,
    postCompressionProjected: number,
    marginAdjustedLimit: number,
    pendingTokens: number,
    completionBudget: number,
  ): Promise<number> {
    const reduction = preCompressionProjected - postCompressionProjected;
    const reductionRatio =
      preCompressionProjected > 0 ? reduction / preCompressionProjected : 0;
    if (
      reductionRatio >=
        CompressionHandler.INEFFECTIVE_COMPRESSION_REDUCTION_THRESHOLD ||
      postCompressionProjected <= marginAdjustedLimit
    ) {
      return postCompressionProjected;
    }

    this.logger.warn(
      () =>
        '[CompressionHandler] Primary compression was ineffective, forcing truncation fallback',
      {
        preCompressionProjected,
        postCompressionProjected,
        reductionRatio,
      },
    );
    this._suppressDensityDirty = true;
    try {
      const context = await this.buildCompressionContext(promptId);
      await this.performFallbackCompression(
        context,
        new Error('Primary compression was ineffective'),
        (newHistory) => {
          this.historyService.clear();
          for (const content of newHistory) {
            this.historyService.add(content, this.runtimeContext.state.model);
          }
        },
      );
      await this.historyService.waitForTokenUpdates();
    } catch (error) {
      this.logger.warn(
        () =>
          '[CompressionHandler] Truncation fallback failed during hard-limit enforcement',
        error,
      );
    } finally {
      this._suppressDensityDirty = false;
    }

    return this.computeProjectedTokens(pendingTokens, completionBudget);
  }

  /**
   * Build a diagnostic error for context window overflow after all reduction attempts.
   */
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
      `density optimization and compression reduced ${totalReduction} tokens (from ${initialProjected} to ${finalProjected} projected).`,
      `completionBudget=${completionBudget}, tokensStillNeeded=${tokensStillNeeded}.`,
    ];
    if (completionBudget > 0.8 * limit) {
      parts.push(
        `The completion budget (${completionBudget}) consumes more than 80% of the context window (${limit}). Consider lowering maxOutputTokens.`,
      );
    }
    return new Error(parts.join(' '));
  }

  /**
   * Perform compression with retry, fallback, and cooldown logic.
   *
   * @plan PLAN-20260218-COMPRESSION-RETRY.P01
   * @requirement REQ-CS-006.1, REQ-CS-002.9, REQ-CR-003-005
   */
  async performCompression(
    prompt_id: string,
    options?: { bypassCooldown?: boolean },
  ): Promise<void> {
    // Cooldown: skip compression if we have too many recent failures
    // When bypassCooldown is true (called from enforceContextWindow), skip this check
    if (!options?.bypassCooldown && this.isCompressionInCooldown()) {
      this.logger.debug(
        'Skipping compression — in cooldown after repeated failures',
        {
          failureCount: this.compressionFailureCount,
          lastFailureTime: this.lastCompressionFailureTime,
        },
      );
      return;
    }

    // Skip compression if history is empty
    const currentHistory = this.historyService.getCurated();
    if (currentHistory.length === 0) {
      this.logger.debug('Skipping compression — empty history');
      return;
    }

    this.logger.debug('Starting compression');

    // Trigger PreCompress hook (fail-open)
    const context = await this.buildCompressionContext(prompt_id);
    try {
      await this.hookTrigger(context);
    } catch {
      // Hooks are fail-open - continue even if hook fails
    }

    const preCompressionCount =
      this.historyService.getStatistics().totalMessages;
    this.historyService.startCompression();
    let compressionSummary: IContent | undefined;
    // @plan PLAN-20260211-HIGHDENSITY.P20
    // @requirement REQ-HD-002.6
    // Suppress densityDirty during compression rebuild (clear+add loop)
    this._suppressDensityDirty = true;
    try {
      await this.runCompressionWithRetryAndFallback(prompt_id, (newHistory) => {
        // Apply result: clear history, add each entry from newHistory
        this.historyService.clear();
        for (const content of newHistory) {
          this.historyService.add(content, this.runtimeContext.state.model);
        }
        compressionSummary = newHistory[0];
      });
    } finally {
      this._suppressDensityDirty = false;
      this.historyService.endCompression(
        compressionSummary,
        preCompressionCount,
      );
    }

    await this.historyService.waitForTokenUpdates();
  }

  /**
   * Check if compression is in cooldown after repeated failures.
   *
   * @plan PLAN-20260218-COMPRESSION-RETRY.P01
   * @requirement REQ-CR-005
   */
  isCompressionInCooldown(): boolean {
    if (
      this.compressionFailureCount <
      CompressionHandler.COMPRESSION_FAILURE_THRESHOLD
    ) {
      return false;
    }
    if (this.lastCompressionFailureTime === null) {
      return false;
    }
    const elapsed = Date.now() - this.lastCompressionFailureTime;
    return elapsed < CompressionHandler.COMPRESSION_COOLDOWN_MS;
  }

  /**
   * Execute compression with retry for transient errors and fallback to truncation.
   *
   * @plan PLAN-20260218-COMPRESSION-RETRY.P01
   * @requirement REQ-CR-003-005
   */
  private async runCompressionWithRetryAndFallback(
    promptId: string,
    applyResult: (newHistory: IContent[]) => void,
  ): Promise<void> {
    const context = await this.buildCompressionContext(promptId);

    const attemptPrimary = async (): Promise<IContent[]> => {
      const strategyName = parseCompressionStrategyName(
        this.runtimeContext.ephemerals.compressionStrategy(),
      );
      const strategy = getCompressionStrategy(strategyName);
      const result = await strategy.compress(context);
      return result.newHistory;
    };

    let primaryError: unknown;
    try {
      const newHistory = await retryWithBackoff(attemptPrimary, {
        maxAttempts: 3,
        initialDelayMs: 2000,
        maxDelayMs: 10000,
        shouldRetryOnError: (err) => shouldRetryCompressionError(err),
      });
      // Primary strategy succeeded — reset failure counters
      this.compressionFailureCount = 0;
      this.lastCompressionFailureTime = null;
      this.logger.debug('Compression completed with primary strategy');
      applyResult(newHistory);
      return;
    } catch (err) {
      primaryError = err;
    }

    // Permanent errors are rethrown immediately — no fallback
    if (!isTransientCompressionError(primaryError)) {
      throw primaryError;
    }

    this.logger.warn(
      'Primary compression strategy failed after retries (transient), attempting fallback',
      primaryError,
    );
    await this.performFallbackCompression(context, primaryError, applyResult);
  }

  /**
   * Attempt fallback compression using TopDownTruncationStrategy.
   *
   * @plan PLAN-20260218-COMPRESSION-RETRY.P01
   * @requirement REQ-CR-004-005
   */
  private async performFallbackCompression(
    context: CompressionContext,
    primaryError: unknown,
    applyResult: (newHistory: IContent[]) => void,
  ): Promise<void> {
    try {
      // Use the strategy factory so tests can intercept
      const fallback = getCompressionStrategy('top-down-truncation');
      const result = await fallback.compress(context);
      // Fallback succeeded — reset failure counters
      this.compressionFailureCount = 0;
      this.lastCompressionFailureTime = null;
      this.logger.debug(
        'Compression completed with fallback (TopDownTruncation)',
      );
      applyResult(result.newHistory);
    } catch (fallbackError) {
      // Both strategies failed — track the failure and continue without compression
      this.compressionFailureCount++;
      this.lastCompressionFailureTime = Date.now();
      this.logger.error(
        'Fallback compression also failed — continuing without compression',
        { primaryError, fallbackError },
      );
      // Swallow error to avoid blocking the conversation turn
    }
  }

  /**
   * Build CompressionContext for compression strategies.
   *
   * @plan PLAN-20260211-COMPRESSION.P14
   * @requirement REQ-CS-001.6
   */
  async buildCompressionContext(promptId: string): Promise<CompressionContext> {
    const promptResolver = new PromptResolver();
    const promptBaseDir = path.join(os.homedir(), '.llxprt', 'prompts');

    let activeTodos: string | undefined;
    if (this.activeTodosProvider) {
      try {
        activeTodos = await this.activeTodosProvider();
      } catch (error) {
        this.logger.debug(
          'Failed to fetch active todos for compression',
          error,
        );
      }
    }

    return {
      history: this.historyService.getCurated(),
      runtimeContext: this.runtimeContext,
      runtimeState: this.runtimeContext.state,
      estimateTokens: (contents) =>
        this.historyService.estimateTokensForContents(contents as IContent[]),
      currentTokenCount: this.historyService.getTotalTokens(),
      logger: this.logger,
      resolveProvider: (profileName?) =>
        this.providerResolver(profileName ?? 'compression'),
      promptResolver,
      promptBaseDir,
      promptContext: {
        provider: this.runtimeContext.state.provider,
        model: this.runtimeContext.state.model,
      },
      promptId,
      ...(activeTodos ? { activeTodos } : {}),
    };
  }

  /**
   * Mark density optimization as dirty (new content added).
   * Respects _suppressDensityDirty flag during compression rebuilds.
   *
   * @plan PLAN-20260211-HIGHDENSITY.P20
   * @requirement REQ-HD-002.6
   */
  markDensityDirty(): void {
    if (!this._suppressDensityDirty) {
      this.densityDirty = true;
    }
  }

  /**
   * Set the active todos provider callback.
   *
   * @plan PLAN-20260220-DECOMPOSE.P03
   */
  setActiveTodosProvider(provider: () => Promise<string | undefined>): void {
    this.activeTodosProvider = provider;
  }

  /**
   * Get the last prompt token count from API.
   *
   * @plan PLAN-20260220-DECOMPOSE.P03
   */
  getLastPromptTokenCount(): number {
    return this.lastPromptTokenCount ?? 0;
  }

  /**
   * Set the last prompt token count from API response.
   *
   * @plan PLAN-20260220-DECOMPOSE.P03
   */
  setLastPromptTokenCount(count: number): void {
    this.lastPromptTokenCount = count;
  }

  /**
   * Estimate token count for pending content.
   * Delegates to compressionBudgeting helper.
   *
   * @plan PLAN-20260220-DECOMPOSE.P03
   */
  async estimatePendingTokens(contents: IContent[]): Promise<number> {
    return estimatePendingTokens(
      contents,
      this.historyService,
      this.runtimeContext.state.model,
    );
  }
}
