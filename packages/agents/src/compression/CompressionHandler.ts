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
import { annotateCompressionSpan } from '@vybestack/llxprt-code-core/services/history/historyChronology.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type {
  CompressionContext,
  CompressionProviderResult,
  CompressionStrategyName,
  DensityConfig,
  StrategyCompressionResult,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import {
  shouldRetryCompressionError,
  isFallbackEligibleCompressionError,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import {
  getCompressionStrategy,
  parseCompressionStrategyName,
} from './compressionStrategyFactory.js';
import { PendingContextWindowEnforcer } from './pendingContextWindowEnforcement.js';
import { applyCompressionWithAnchor } from './cacheAnchor.js';
import { buildCompressionContext as buildContext } from './compressionContextBuilder.js';
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
import { retryWithBackoff } from '@vybestack/llxprt-code-core/utils/retry.js';
import { tokenLimit } from '@vybestack/llxprt-code-core/core/tokenLimits.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  estimatePendingTokens,
  getCompletionBudget,
} from './compressionBudgeting.js';
import { ProviderContentEnforcer } from './providerContentEnforcement.js';
import {
  TOKEN_SAFETY_MARGIN,
  CONTEXT_LIMIT_FUDGE_FACTOR,
  INEFFECTIVE_COMPRESSION_REDUCTION_THRESHOLD,
  computeMarginAdjustedLimit,
} from './contextLimitPolicy.js';

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
      context: CompressionContext,
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
  getEffectiveTokenCount(): number {
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
      if (!strategy.optimize || strategy.trigger.mode !== 'continuous') {
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

    if (this.shouldCompress(pendingTokens)) {
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
  getProjectedPromptBaseline(): number {
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

    const callback = async (_contents: IContent[]): Promise<IContent[]> => {
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
        return await enforcer.compressAndRecompose(pendingContents, promptId);
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
          const context = await this.buildCompressionContext(promptId, {
            targetTokenCount,
          });
          const outcome = await this.performFallbackCompression(
            context,
            new Error('Provider content fallback truncation triggered'),
            (newHistory, _summary, _topPreserved) => applyResult(newHistory),
            { swallowErrors: false },
          );
          return outcome === 'applied';
        } finally {
          this.popSuppressDensityDirty();
        }
      },
    });
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
      buildCompressionContext: (activePromptId, targetTokenCount) =>
        this.buildCompressionContext(activePromptId, { targetTokenCount }),
      compressWithFallbackStrategy: (context) =>
        this.compressWithFallbackStrategy(context),
      applyFallbackCompressionResult: (result, applyResult) =>
        this.applyFallbackCompressionResult(result, applyResult),
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
    const context = await this.buildCompressionContext(prompt_id);
    try {
      await this.hookTrigger({
        ...context,
        trigger: options?.trigger ?? 'manual',
      });
    } catch {
      // Hooks are fail-open - continue even if hook fails
    }

    // Skip compression if history is empty
    const currentHistory = this.historyService.getCurated();
    if (currentHistory.length === 0) {
      this.logger.debug('Skipping compression — empty history');
      return PerformCompressionResult.SKIPPED_EMPTY;
    }

    this.logger.debug('Starting compression');

    // Capture the pre-compression token count for the lifecycle telemetry
    // event (#3130 AC-7). Must be read BEFORE startCompression mutates state.
    const tokensBefore = this.historyService.getTotalTokens();

    const preCompressionCount =
      this.historyService.getStatistics().totalMessages;
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
      compressionOutcome = await this.runCompressionWithRetryAndFallback(
        prompt_id,
        this.createApplyCallback(),
      );
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
   * Create the apply callback for runCompressionWithRetryAndFallback.
   *
   * Resolves and validates the new cache anchor BEFORE mutating history so an
   * invalid strategy result cannot leave a partially applied compression
   * (#3070 Defect 3). After mutation: if the prefix was destroyed
   * (topPreserved <= 0), explicitly reset the anchor (#3070 Defect 5);
   * otherwise set it to the last preserved-head entry's exact identity.
   */
  private createApplyCallback(): (
    newHistory: IContent[],
    summary: IContent | undefined,
    topPreserved: number,
  ) => Promise<void> {
    return async (newHistory, summary, topPreserved) => {
      applyCompressionWithAnchor(
        this.historyService,
        newHistory,
        topPreserved,
        this.runtimeContext.state.model,
        annotateCompressionSpan,
      );
      this.lastPromptTokenCount = null;
      this.compressionSummary = summary;
    };
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
    for (const entry of newHistory) {
      if (entry.metadata?.reason === 'compression-state-snapshot') {
        return entry;
      }
    }
    for (const entry of newHistory) {
      if (
        entry.metadata?.isSummary === true ||
        (entry.metadata?.synthetic === true &&
          entry.blocks.some(
            (b) => b.type === 'text' && b.text.includes('<state_snapshot>'),
          ))
      ) {
        return entry;
      }
    }
    return undefined;
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
    applyResult: (
      newHistory: IContent[],
      summary: IContent | undefined,
      topPreserved: number,
    ) => Promise<void>,
  ): Promise<'applied' | 'noop' | 'failed'> {
    const context = await this.buildCompressionContext(promptId);
    const configuredStrategyName = parseCompressionStrategyName(
      this.runtimeContext.ephemerals.compressionStrategy(),
    );

    const attemptPrimary = async (): Promise<StrategyCompressionResult> => {
      const strategy = getCompressionStrategy(configuredStrategyName);
      return strategy.compress(context);
    };

    let primaryError: unknown;
    try {
      const result = await retryWithBackoff(attemptPrimary, {
        maxAttempts: 3,
        initialDelayMs: 2000,
        maxDelayMs: 10000,
        shouldRetryOnError: (err) => shouldRetryCompressionError(err),
      });

      // Structural no-op from the primary strategy. For middle-out, route to
      // one-shot summarization of the same unchanged history; for other
      // strategies the no-op is truthful and not re-routed. (Issue #2602)
      if (result.kind === 'noop') {
        return await this.handleStructuralNoop(
          result,
          configuredStrategyName,
          context,
          applyResult,
        );
      }

      await this.applyFallbackCompressionResult(result, applyResult);
      this.logger.debug('Compression completed with primary strategy');
      return 'applied';
    } catch (err) {
      primaryError = err;
    }

    // Permanent errors that are not fallback-eligible are rethrown immediately.
    // Transient errors (already retried) and EmptySummaryError fall back to
    // truncation instead of aborting the turn. (Issue #2333)
    if (!isFallbackEligibleCompressionError(primaryError)) {
      throw primaryError;
    }

    this.logger.warn(
      'Primary compression strategy failed after retries, attempting fallback truncation',
      primaryError,
    );
    const fallbackOutcome = await this.performFallbackCompression(
      context,
      primaryError,
      (newHistory, summary, topPreserved) =>
        applyResult(newHistory, summary, topPreserved),
    );
    return fallbackOutcome;
  }

  /**
   * Resolve a structural no-op from the primary strategy. For middle-out,
   * route to one-shot summarization of the same unchanged history; for other
   * strategies the no-op is truthful and not re-routed. (Issue #2602)
   *
   * Provider/transient/LLM/verification failures from the one-shot fallback
   * propagate as exceptions (they are never structural no-ops).
   */
  private async handleStructuralNoop(
    result: Extract<StrategyCompressionResult, { kind: 'noop' }>,
    configuredStrategyName: CompressionStrategyName,
    context: CompressionContext,
    applyResult: (
      newHistory: IContent[],
      summary: IContent | undefined,
      topPreserved: number,
    ) => Promise<void>,
  ): Promise<'applied' | 'noop'> {
    if (configuredStrategyName !== 'middle-out') {
      this.logger.debug(
        `Compression was a structural no-op (${configuredStrategyName}: ${result.reason})`,
      );
      return 'noop';
    }
    const routed = await this.runOneShotFallback(context);
    if (routed.kind === 'applied') {
      await this.applyFallbackCompressionResult(routed, applyResult);
      this.logger.debug(
        'Compression completed — middle-out structural no-op routed to one-shot',
      );
      return 'applied';
    }
    this.logger.debug(
      'Compression was a structural no-op (middle-out and one-shot)',
    );
    return 'noop';
  }

  /**
   * Run the one-shot strategy against an immutable context for the middle-out
   * structural no-op fallback route. Only the strategy execution is performed;
   * provider/transient/LLM failures propagate as errors (not structural no-op).
   */
  private async runOneShotFallback(
    context: CompressionContext,
  ): Promise<StrategyCompressionResult> {
    const oneShot = getCompressionStrategy('one-shot');
    return oneShot.compress(context);
  }

  /**
   * Apply an 'applied' strategy outcome: commit history, reset failure
   * counters, and surface the marked compression snapshot for recording.
   */
  private async applyFallbackCompressionResult(
    result: StrategyCompressionResult,
    applyResult: (
      newHistory: IContent[],
      summary: IContent | undefined,
      topPreserved: number,
    ) => Promise<void>,
  ): Promise<void> {
    if (result.kind === 'noop') {
      this.logger.debug(
        `applyFallbackCompressionResult received structural no-op (${result.reason}); not applying`,
      );
      return;
    }
    // Delegate the history mutation to the caller-supplied applyResult so each
    // caller's rewrite runs with its own contract: createApplyCallback applies
    // the cache anchor via applyCompressionWithAnchor on the primary path,
    // while the enforcer wrappers (executeFallbackTruncation,
    // PendingContextWindowEnforcer) own their clear/rebuild and rely on this
    // callback to mark history as applied (historyRestored). Every caller also
    // clears the stale prompt-token baseline, so applying it here directly
    // would bypass those contracts (#3070 fallback truncation propagation).
    const summary = CompressionHandler.selectCompressionSummary(
      result.newHistory,
    );
    await applyResult(
      result.newHistory,
      summary,
      result.metadata.topPreserved ?? 0,
    );
    this.compressionSummary = summary;
    this.compressionFailureCount = 0;
    this.lastCompressionFailureTime = null;
    this.lastSuccessfulCompressionTime = Date.now();
  }

  private async compressWithFallbackStrategy(
    context: CompressionContext,
  ): Promise<StrategyCompressionResult> {
    const fallback = getCompressionStrategy('top-down-truncation');
    return fallback.compress(context);
  }

  /**
   * Attempt fallback compression using TopDownTruncationStrategy.
   *
   * @plan PLAN-20260218-COMPRESSION-RETRY.P01
   * @plan PLAN-20260727-ISSUE2602
   * @requirement REQ-CR-004-005
   *
   * When `swallowErrors` is true (default), errors are caught and false is
   * returned to avoid blocking the conversation turn. When false (provider
   * hard-limit enforcement), errors propagate so the enforcer can capture
   * them as truncationFailure for actionable overflow diagnostics.
   *
   * Returns true if history was applied (fallback compressed), false if the
   * fallback was itself a structural no-op or errored (when swallowErrors).
   */
  private async performFallbackCompression(
    context: CompressionContext,
    primaryError: unknown,
    applyResult: (
      newHistory: IContent[],
      summary: IContent | undefined,
      topPreserved: number,
    ) => Promise<void>,
    options?: { swallowErrors?: boolean },
  ): Promise<'applied' | 'noop' | 'failed'> {
    const swallowErrors = options?.swallowErrors ?? true;
    try {
      // Use the strategy factory so tests can intercept
      const result = await this.compressWithFallbackStrategy(context);
      if (result.kind === 'noop') {
        // Truthful fallback no-op: do not apply, do not reset counters.
        this.logger.debug(
          `Fallback (TopDownTruncation) was a structural no-op: ${result.reason}`,
        );
        return 'noop';
      }
      await this.applyFallbackCompressionResult(result, applyResult);
      this.logger.debug(
        'Compression completed with fallback (TopDownTruncation)',
      );
      return 'applied';
    } catch (fallbackError) {
      // Both strategies failed — track the failure
      this.compressionFailureCount++;
      this.lastCompressionFailureTime = Date.now();
      if (!swallowErrors) {
        this.logger.error(
          'Provider truncation fallback failed during hard-limit enforcement',
          { primaryError, fallbackError },
        );
        const primaryMessage =
          primaryError instanceof Error
            ? primaryError.message
            : String(primaryError);
        const fallbackMessage =
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError);
        throw new AggregateError(
          [primaryError, fallbackError],
          `Provider truncation fallback failed during hard-limit enforcement. Primary failure: ${primaryMessage}. Fallback failure: ${fallbackMessage}`,
        );
      }
      this.logger.error(
        'Fallback compression also failed — continuing without compression',
        { primaryError, fallbackError },
      );
      return 'failed';
    }
  }

  /**
   * Build CompressionContext for compression strategies.
   *
   * @plan PLAN-20260211-COMPRESSION.P14
   * @requirement REQ-CS-001.6
   */
  async buildCompressionContext(
    promptId: string,
    options?: { targetTokenCount?: number },
  ): Promise<CompressionContext> {
    return buildContext(
      promptId,
      this.runtimeContext,
      this.historyService,
      (profileName?) => Promise.resolve(this.providerResolver(profileName)),
      this.activeTodosProvider,
      this.transcriptPathProvider,
      this.logger,
      options,
    );
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
