/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelGenerationSettings } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type {
  IContent,
  ContentBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderContentEnvelope } from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type {
  CompressionProviderResult,
  DensityConfig,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import {
  getCompressionStrategy,
  parseCompressionStrategyName,
} from './compressionStrategyFactory.js';
import { PendingContextWindowEnforcer } from './pendingContextWindowEnforcement.js';
import { runDiskTruncation } from './diskTruncation.js';
import { runDiskMiddleOut, runDiskOneShot } from './diskMiddleOut.js';
import { runDiskHighDensity } from './diskHighDensity.js';
import { selectCompressionSummary } from './compressionSummary.js';
import { type CompressionAttemptContext } from './compressionContextBuilder.js';
import {
  prepareCompressionAttempt,
  countCompressionRows,
} from './compressionAttempt.js';
import type { TokenUsageLogger } from '../core/TokenUsageLogger.js';
import { emitCompressionLifecycleEvent } from './compressionLifecycleTelemetry.js';
/**
 * @plan:PLAN-20260603-ISSUE1584.P05
 * @requirement:REQ-DEP-001
 * @pseudocode component-boundaries.md C-CB-08, lines 80-85
 *
 * Reasoning-aware token accounting lives in effectiveTokenCount.ts, which
 * still uses the providers-path extractThinkingBlocks/estimateThinkingTokens
 * helpers. The ReasoningOutput contract is available for the injection path
 * where providers pass pre-extracted reasoning data through the
 * RuntimeProvider contract.
 */
import { computeEffectiveTokenCount } from './effectiveTokenCount.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { tokenLimit } from '@vybestack/llxprt-code-core/core/tokenLimits.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  estimatePendingTokens,
  getCompletionBudget,
} from './compressionBudgeting.js';
import {
  ProviderContentEnforcer,
  type CompressionGuardInfo,
  type ProviderContentEnforcementDeps,
} from './providerContentEnforcement.js';
import {
  TOKEN_SAFETY_MARGIN,
  CONTEXT_LIMIT_FUDGE_FACTOR,
  INEFFECTIVE_COMPRESSION_REDUCTION_THRESHOLD,
  computeMarginAdjustedLimit,
} from './contextLimitPolicy.js';

import { runDiskProviderFallback } from './diskProviderFallback.js';
import { ProviderFallbackInvariantError } from './providerFallbackCandidate.js';
import {
  ProviderSourceEnforcer,
  type ProviderSourceLimits,
} from './provider-source-enforcement.js';

const diskRunners = {
  'middle-out': runDiskMiddleOut,
  'one-shot': runDiskOneShot,
  'top-down-truncation': runDiskTruncation,
  'high-density': runDiskHighDensity,
};

/**
 * CompressionHandler orchestrates all compression logic for ChatSession.
 * Manages compression state, retry/fallback logic, and density optimization.
 *
 * @plan PLAN-20260220-DECOMPOSE.P03
 * @requirement Module 3 specification
 */
export class CompressionHandler {
  // Preserve the existing public static constants while centralizing the policy.
  static readonly TOKEN_SAFETY_MARGIN = TOKEN_SAFETY_MARGIN;
  static readonly CONTEXT_LIMIT_FUDGE_FACTOR = CONTEXT_LIMIT_FUDGE_FACTOR;
  static readonly DEFAULT_COMPLETION_BUDGET = 65_536;
  static readonly COMPRESSION_COOLDOWN_MS = 60_000;
  static readonly COMPRESSION_FAILURE_THRESHOLD = 3;
  static readonly INEFFECTIVE_COMPRESSION_REDUCTION_THRESHOLD =
    INEFFECTIVE_COMPRESSION_REDUCTION_THRESHOLD;
  static readonly RECENT_COMPRESSION_WINDOW_MS =
    CompressionHandler.COMPRESSION_COOLDOWN_MS;

  private compressionPromise: Promise<PerformCompressionResult> | null = null;
  private compressionFailureCount: number = 0;
  private lastCompressionFailureTime: number | null = null;
  private lastSuccessfulCompressionTime: number | null = null;
  private compressionSummary: IContent | undefined;
  densityDirty: boolean = true;
  private _suppressDensityDirty: boolean = false;
  private _suppressDensityDirtyDepth: number = 0;
  private activeTodosProvider?: () => Promise<string | undefined>;
  private transcriptPathProvider?: () => string | undefined;
  lastPromptTokenCount: number | null = null;
  tokenUsageLogger: TokenUsageLogger | null = null;

  private logger = new DebugLogger('llxprt:gemini:compression');

  constructor(
    private readonly runtimeContext: AgentRuntimeContext,
    private readonly historyService: HistoryService,
    private readonly generationConfig: ModelGenerationSettings,
    private readonly providerResolver: (
      compressionProfileName: string | undefined,
    ) => CompressionProviderResult | Promise<CompressionProviderResult>,
    private readonly hookTrigger: (
      context: CompressionAttemptContext,
    ) => Promise<void>,
  ) {}
  /**
   * Runtime provider context, widened to include null/undefined for defensive
   * runtime boundary guards. Provider runtime state may be absent during
   * bootstrap and test doubles despite declared types.
   */
  private get providerRuntimeNullable():
    | ProviderRuntimeContext
    | null
    | undefined {
    return this.runtimeContext.providerRuntime as
      | ProviderRuntimeContext
      | null
      | undefined;
  }

  /**
   * Calculate effective token count based on reasoning settings.
   * Accounts for whether reasoning will be included in API calls.
   *
   * @plan PLAN-20251202-THINKING.P15
   * @requirement REQ-THINK-005.1, REQ-THINK-005.2
   */
  getEffectiveTokenCount(): Promise<number> {
    return computeEffectiveTokenCount(this.historyService, this.runtimeContext);
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
      if (!strategy.optimizeRows || strategy.trigger.mode !== 'continuous') {
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

      const optimize = strategy.optimizeRows;
      await this.historyService.optimizeDensityRows((source) =>
        optimize(source, config),
      );
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
  async shouldCompress(pendingTokens: number = 0): Promise<boolean> {
    // Calculate fresh each time to respect runtime setting changes
    const threshold = this.runtimeContext.ephemerals.compressionThreshold();
    const contextLimit = this.runtimeContext.ephemerals.contextLimit();
    const completionBudget = getCompletionBudget(
      this.generationConfig,
      this.runtimeContext.state.model,
      undefined,
      this.providerRuntimeNullable?.settingsService,
      contextLimit,
    );
    const effectiveLimit = contextLimit - completionBudget;
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
        : await this.getEffectiveTokenCount();

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
    trigger: 'manual' | 'auto' = 'auto',
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

    if (await this.shouldCompress(pendingTokens)) {
      const triggerMessage =
        source === 'stream'
          ? 'Triggering compression before message send in stream'
          : 'Triggering compression before message send';
      this.logger.debug(triggerMessage, {
        pendingTokens,
        historyTokens: this.historyService.getTotalTokens(),
      });
      this.compressionPromise = this.performCompression(prompt_id, {
        trigger,
      });
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
  async getProjectedPromptBaseline(): Promise<number> {
    return this.lastPromptTokenCount !== null && this.lastPromptTokenCount > 0
      ? this.lastPromptTokenCount
      : this.getEffectiveTokenCount();
  }

  /**
   * Compute the projected token count for a pending request.
   */
  private async computeProjectedTokens(
    pendingTokens: number,
    completionBudget: number,
  ): Promise<number> {
    return (
      (await this.getProjectedPromptBaseline()) +
      Math.max(0, pendingTokens) +
      completionBudget
    );
  }

  /**
   * Compute context-window limits and completion budget for enforcement.
   */
  private computeContextLimits(provider?: IProvider): {
    completionBudget: number;
    limit: number;
    marginAdjustedLimit: number;
  } {
    const userContextLimit = this.runtimeContext.ephemerals.contextLimit();
    const limit = tokenLimit(this.runtimeContext.state.model, userContextLimit);
    const completionBudget = getCompletionBudget(
      this.generationConfig,
      this.runtimeContext.state.model,
      provider,
      this.providerRuntimeNullable?.settingsService,
      limit,
    );
    const marginAdjustedLimit = computeMarginAdjustedLimit(limit);
    return { completionBudget, limit, marginAdjustedLimit };
  }

  private attachCompressionCallback(
    provider: IProvider | undefined,
    promptId: string,
    enforcer: ProviderContentEnforcer,
    pendingContents: IContent[] | undefined,
  ): void {
    if (!provider || typeof provider.setCompressionCallback !== 'function') {
      return;
    }

    const callback = async (
      _contents: IContent[],
      guard?: CompressionGuardInfo,
    ): Promise<IContent[]> => {
      if (pendingContents === undefined) {
        throw new Error(
          'Compression callback invoked but the pending-content boundary is ' +
            'unrecoverable: a BeforeModel hook replaced or restructured the ' +
            'conversation contents, and no usable llm_request_boundary ' +
            'metadata was available, so compression cannot safely recompose ' +
            'the pending region.',
        );
      }
      try {
        return await enforcer.compressAndRecompose(
          pendingContents,
          promptId,
          guard,
          provider,
        );
      } catch (error) {
        this.logger.warn(
          () => '[CompressionHandler] Compression callback failed',
          error,
        );
        throw error;
      }
    };

    provider.setCompressionCallback(callback);
  }

  private pushSuppressDensityDirty(): void {
    this._suppressDensityDirtyDepth++;
    this._suppressDensityDirty = true;
  }

  private popSuppressDensityDirty(): void {
    if (this._suppressDensityDirtyDepth <= 0) {
      this.logger.warn(
        () =>
          '[CompressionHandler] popSuppressDensityDirty called with no matching push; depth already at 0',
      );
      this._suppressDensityDirtyDepth = 0;
      this._suppressDensityDirty = false;
      return;
    }
    this._suppressDensityDirtyDepth--;
    this._suppressDensityDirty = this._suppressDensityDirtyDepth > 0;
  }

  setSuppressDensityDirty(value: boolean): void {
    if (value) {
      this.pushSuppressDensityDirty();
    } else {
      this.popSuppressDensityDirty();
    }
  }

  /**
   * Public cleanup hook for callers that use enforceProviderContents and then
   * invoke the provider while the compression callback remains attached.
   */
  clearProviderCompressionCallback(provider?: IProvider): void {
    try {
      if (provider && typeof provider.setCompressionCallback === 'function') {
        provider.setCompressionCallback(null);
      }
    } catch (error) {
      this.logger.warn(
        () =>
          '[CompressionHandler] Failed to detach compression callback during cleanup',
        error,
      );
    }
  }

  private createProviderContentEnforcer(
    estimateFinalizedPromptTokens?: (contents: IContent[]) => Promise<number>,
  ): ProviderContentEnforcer {
    return new ProviderContentEnforcer({
      historyService: this.historyService,
      runtimeContext: this.runtimeContext,
      generationConfig: this.generationConfig,
      providerRuntimeNullable: this.providerRuntimeNullable,
      logger: this.logger,
      ensureDensityOptimized: () => this.ensureDensityOptimized(),
      performCompression: (promptId, options) =>
        this.performCompression(promptId, options),
      estimateFinalizedPromptTokens,
      getPromptTokenBaseline: () => this.lastPromptTokenCount,
      resetPromptTokenBaseline: () => {
        this.lastPromptTokenCount = null;
      },
      restorePromptTokenBaseline: (baseline) => {
        this.lastPromptTokenCount = baseline;
      },
      performFallbackCompression: async (
        promptId,
        applyResult,
        targetTokenCount,
      ) => {
        this.pushSuppressDensityDirty();
        try {
          return await this.performProviderDiskFallback(
            promptId,
            applyResult,
            targetTokenCount,
          );
        } finally {
          this.popSuppressDensityDirty();
        }
      },
    });
  }

  sourceContextLimits(provider: IProvider): ProviderSourceLimits {
    return this.createProviderContentEnforcer().sourceContextLimits(provider);
  }

  /** The first disk route rejects escalation rather than returning an eager replacement. */
  async enforceProviderSource(
    provider: IProvider,
    estimate: () => Promise<number>,
  ): Promise<void> {
    try {
      provider.setCompressionCallback?.(async () => {
        throw new Error(
          'Disk source compression callback requires array replacement contracts',
        );
      });
      await this.historyService.waitForTokenUpdates();
      await new ProviderSourceEnforcer({
        limits: this.sourceContextLimits(provider),
        estimate,
        getHistoryTokens: () => this.historyService.getTotalTokens(),
      }).enforce();
    } catch (error) {
      this.clearProviderCompressionCallback(provider);
      throw error;
    }
  }

  /**
   * Enforce provider content limits and return the provider-ready contents.
   *
   * On success, any attached compression callback intentionally remains on the
   * provider for the immediately following provider call. Callers must invoke
   * clearProviderCompressionCallback(provider) in a finally block after that
   * provider call completes. On error, this method makes a best-effort attempt
   * to detach the callback before rethrowing the original enforcement error.
   */
  async enforceProviderContents(
    envelope: ProviderContentEnvelope,
    promptId: string,
    provider?: IProvider,
    estimateFinalizedPromptTokens?: (contents: IContent[]) => Promise<number>,
  ): Promise<IContent[]> {
    const enforcer = this.createProviderContentEnforcer(
      estimateFinalizedPromptTokens,
    );
    try {
      this.attachCompressionCallback(
        provider,
        promptId,
        enforcer,
        envelope.pendingContents,
      );
      return await enforcer.enforce(envelope, promptId, provider);
    } catch (error) {
      this.clearProviderCompressionCallback(provider);
      throw error;
    }
  }

  async enforceContextWindow(
    pendingTokens: number,
    promptId: string,
    provider?: IProvider,
  ): Promise<void> {
    const enforcer = new PendingContextWindowEnforcer({
      historyService: this.historyService,
      logger: this.logger,
      ineffectiveCompressionReductionThreshold:
        INEFFECTIVE_COMPRESSION_REDUCTION_THRESHOLD,
      getContextLimits: (activeProvider) =>
        this.computeContextLimits(activeProvider),
      computeProjectedTokens: (tokens, completionBudget) =>
        this.computeProjectedTokens(tokens, completionBudget),
      ensureDensityOptimized: () => this.ensureDensityOptimized(),
      performCompression: (activePromptId, options) =>
        this.performCompression(activePromptId, options),
      performFallbackCompression: (activePromptId, install, targetTokenCount) =>
        this.runDiskFallback(activePromptId, install, targetTokenCount),
      getLastPromptTokenCount: () => this.lastPromptTokenCount,
      restoreLastPromptTokenCount: (value) => {
        this.lastPromptTokenCount = value;
      },
      setSuppressDensityDirty: (value) => this.setSuppressDensityDirty(value),
      recordCompressionFailure: () => this.recordCompressionFailure(),
      resetLastPromptTokenCount: () => {
        this.lastPromptTokenCount = null;
      },
      getRuntimeModel: () => this.runtimeContext.state.model,
      estimateBlockTokensAsync: async (block: ContentBlock) => {
        const model = this.runtimeContext.state.model;
        const wrapped: IContent = { speaker: 'tool', blocks: [block] };
        return this.historyService.estimateTokensForContents([wrapped], model);
      },
    });
    await enforcer.enforce(pendingTokens, promptId, provider);
  }

  private recordCompressionFailure(): void {
    this.compressionFailureCount++;
    this.lastCompressionFailureTime = Date.now();
  }

  /**
   * Perform compression with retry, fallback, and cooldown logic.
   *
   * @plan PLAN-20260218-COMPRESSION-RETRY.P01
   * @requirement REQ-CS-006.1, REQ-CS-002.9, REQ-CR-003-005
   */
  async performCompression(
    prompt_id: string,
    options?: { bypassCooldown?: boolean; trigger?: 'manual' | 'auto' },
  ): Promise<PerformCompressionResult> {
    // Cooldown: skip compression if we have too many recent failures
    // When bypassCooldown is true (called from enforceContextWindow), skip this check
    if (options?.bypassCooldown !== true && this.isCompressionInCooldown()) {
      this.logger.debug(
        'Skipping compression — in cooldown after repeated failures',
        {
          failureCount: this.compressionFailureCount,
          lastFailureTime: this.lastCompressionFailureTime,
        },
      );
      return PerformCompressionResult.SKIPPED_COOLDOWN;
    }

    // Trigger PreCompress hook (fail-open) before checking history.
    // This ensures automatic/manual compression attempts emit PreCompress hooks
    // even when the attempt is later skipped due to empty history.
    const hasHistory = await prepareCompressionAttempt(
      this.hookTrigger,
      options?.trigger ?? 'manual',
      prompt_id,
      this.runtimeContext,
      this.historyService,
      async (profileName) => this.providerResolver(profileName),
      this.activeTodosProvider,
      this.transcriptPathProvider,
      this.logger,
    );

    // Skip compression if history is empty
    if (!hasHistory) {
      this.logger.debug('Skipping compression — empty history');
      return PerformCompressionResult.SKIPPED_EMPTY;
    }

    this.logger.debug('Starting compression');

    // Capture the pre-compression token count for the lifecycle telemetry
    // event (#3130 AC-7). Must be read BEFORE startCompression mutates state.
    const tokensBefore = this.historyService.getTotalTokens();

    let preCompressionCount = 0;
    this.historyService.startCompression();
    // Compression outcome determined by runCompressionWithRetryAndFallback.
    // On 'noop', we must avoid history mutation, recording events, and
    // counter/timestamp changes entirely. (Issue #2602)
    let compressionOutcome: 'applied' | 'noop' | 'failed' = 'failed';
    this.compressionSummary = undefined;
    // @plan PLAN-20260211-HIGHDENSITY.P20
    // @requirement REQ-HD-002.6
    // Suppress densityDirty during compression rebuild (clear+add loop)
    this.setSuppressDensityDirty(true);
    try {
      preCompressionCount = await countCompressionRows(this.historyService);
      compressionOutcome =
        await this.runCompressionWithRetryAndFallback(prompt_id);
    } finally {
      this.setSuppressDensityDirty(false);
      // Balance the compression lock in all cases. On 'noop' no history was
      // mutated, so flush/unlock WITHOUT summary/itemsCompressed to avoid
      // emitting a compressionEnded recording event. (Issue #2602)
      if (compressionOutcome === 'noop') {
        this.historyService.endCompression();
      } else {
        this.historyService.endCompression(
          this.compressionSummary,
          preCompressionCount,
        );
      }
    }

    if (compressionOutcome === 'noop') {
      this.logger.debug(
        'Compression was a structural no-op — no history mutation or recording',
      );
      return PerformCompressionResult.NOOP;
    }

    await this.historyService.waitForTokenUpdates();
    if (compressionOutcome === 'applied') {
      // Emit the compression lifecycle event into the token-usage log (#3130
      // AC-7). Exactly-once: this branch runs only on a genuine 'applied'
      // outcome; retry logic is internal to runCompressionWithRetryAndFallback.
      const tokensAfter = this.historyService.getTotalTokens();
      // The compression itself has already succeeded and history is updated.
      // Observing it must not undo that, so this is the one fail-open boundary
      // for the emission; the emitter stays guard-free inside.
      await emitCompressionLifecycleEvent(
        this.tokenUsageLogger,
        this.runtimeContext,
        this.historyService,
        (profileName) => this.providerResolver(profileName),
        tokensBefore,
        tokensAfter,
        this.compressionSummary,
      ).catch((error: unknown) => {
        this.logger.error('Failed to record compression telemetry', error);
      });
      return PerformCompressionResult.COMPRESSED;
    }

    this.logger.warn(
      'Compression strategy reported failure without applying history updates',
    );

    return PerformCompressionResult.FAILED;
  }

  /**
   * Select the genuine compression snapshot entry from candidate history for
   * recording. Prefers the entry explicitly marked with the
   * 'compression-state-snapshot' reason; falls back to text-based detection
   * of the canonical <state_snapshot> container for legacy/imported histories.
   * Returns undefined when no summary entry is identifiable (e.g. truncation
   * strategies that emit no synthetic snapshot).
   *
   * @plan PLAN-20260727-ISSUE2602
   */
  static selectCompressionSummary(
    newHistory: readonly IContent[],
  ): IContent | undefined {
    return selectCompressionSummary(newHistory);
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
   * Returns true if compression completed successfully within the recent window.
   * Used to distinguish ALREADY_COMPRESSED from NOOP in the /compress command.
   */
  wasRecentlyCompressed(): boolean {
    if (this.lastSuccessfulCompressionTime === null) {
      return false;
    }
    return (
      Date.now() - this.lastSuccessfulCompressionTime <
      CompressionHandler.RECENT_COMPRESSION_WINDOW_MS
    );
  }

  /**
   * Execute compression with retry for transient errors and fallback to truncation.
   *
   * Returns one of:
   * - 'applied' — history was mutated via applyResult
   * - 'noop'    — strategy returned a structural no-op; nothing was mutated
   * - 'failed'  — all strategies errored (when swallowErrors) or threw
   *
   * @plan PLAN-20260218-COMPRESSION-RETRY.P01
   * @plan PLAN-20260727-ISSUE2602
   * @requirement REQ-CR-003-005
   */
  private async runCompressionWithRetryAndFallback(
    promptId: string,
  ): Promise<'applied' | 'noop' | 'failed'> {
    const strategyName = parseCompressionStrategyName(
      this.runtimeContext.ephemerals.compressionStrategy(),
    );
    const { outcome, summary } = await diskRunners[strategyName](
      promptId,
      this.runtimeContext,
      this.historyService,
      (profileName) => Promise.resolve(this.providerResolver(profileName)),
      this.activeTodosProvider,
      this.transcriptPathProvider,
      this.logger,
    );
    if (outcome === 'applied') {
      this.lastPromptTokenCount = null;
      this.compressionSummary = summary;
      this.compressionFailureCount = 0;
      this.lastCompressionFailureTime = null;
      this.lastSuccessfulCompressionTime = Date.now();
    }
    if (outcome === 'failed') this.recordCompressionFailure();
    return outcome;
  }

  private async runDiskFallback(
    promptId: string,
    applyResult: Parameters<
      ProviderContentEnforcementDeps['performFallbackCompression']
    >[1],
    targetTokenCount: number | undefined,
  ): Promise<boolean> {
    const { outcome, summary } = await runDiskProviderFallback(
      applyResult,
      promptId,
      this.runtimeContext,
      this.historyService,
      (profileName) => Promise.resolve(this.providerResolver(profileName)),
      this.activeTodosProvider,
      this.transcriptPathProvider,
      this.logger,
      { targetTokenCount },
    );
    if (outcome === 'noop') return false;
    this.compressionSummary = summary;
    this.compressionFailureCount = 0;
    this.lastCompressionFailureTime = null;
    this.lastSuccessfulCompressionTime = Date.now();
    return true;
  }

  private async performProviderDiskFallback(
    promptId: string,
    applyResult: Parameters<
      ProviderContentEnforcementDeps['performFallbackCompression']
    >[1],
    targetTokenCount: number | undefined,
  ): Promise<boolean> {
    const primaryError = new Error(
      'Provider content fallback truncation triggered',
    );
    try {
      return await this.runDiskFallback(
        promptId,
        applyResult,
        targetTokenCount,
      );
    } catch (fallbackError) {
      this.recordCompressionFailure();
      this.logger.error(
        'Provider truncation fallback failed during hard-limit enforcement',
        { primaryError, fallbackError },
      );
      if (fallbackError instanceof ProviderFallbackInvariantError)
        throw fallbackError;
      const fallbackMessage =
        fallbackError instanceof Error
          ? fallbackError.message
          : String(fallbackError);
      throw new AggregateError(
        [primaryError, fallbackError],
        `Provider truncation fallback failed during hard-limit enforcement. Primary failure: ${primaryError.message}. Fallback failure: ${fallbackMessage}`,
      );
    }
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
   * Set the session-journal path provider callback.
   *
   * The provider is invoked on every compression so it observes the live
   * recording service; it returns undefined whenever no file is materialized
   * (issue #2933).
   */
  setTranscriptPathProvider(provider: () => string | undefined): void {
    this.transcriptPathProvider = provider;
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
