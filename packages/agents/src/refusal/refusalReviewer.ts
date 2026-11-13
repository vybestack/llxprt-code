/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { CompressionProviderResult } from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { AdmittedModelParameters } from '@vybestack/llxprt-code-core/runtime/admittedModelParameters.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { buildCompressionChatOptions } from '../compression/compressionSystemPrompt.js';
import type { TokenUsageLogger } from '../core/TokenUsageLogger.js';
import type { TokenUsageRefusalReviewEvent } from '../core/tokenUsageRecords.js';
import { isRefusalFinishReason } from './refusalDetection.js';
import {
  callReviewProvider,
  REVIEW_TIMEOUT_MS,
  type ReviewCallResult,
} from './reviewCall.js';
import { buildReviewData, REFUSAL_REVIEW_PROMPT } from './reviewPrompt.js';
import type { ReviewProfileSetting } from './reviewProfile.js';
import type {
  RefusalReviewer,
  ReviewOutcome,
  ReviewRequest,
  ReviewerIdentity,
  StartedReview,
} from './reviewTypes.js';
import { parseReviewReply } from './reviewVerdict.js';
import {
  buildReviewWindow,
  pendingEditsOf,
  type ReviewWindow,
} from './reviewWindow.js';
import { applyReviewedRewrite } from './rewriteApplier.js';

/** What the session lends the reviewer; everything is read when a review runs. */
export interface RefusalReviewerDeps {
  readonly history: () => HistoryService;
  readonly runtimeState: AgentRuntimeState;
  readonly config: () => Config | undefined;
  /** `compression.profile`, the fallback when no review profile is set. */
  readonly compressionProfile: () => string | undefined;
  /** Resolves a saved profile (or the session route) in isolation. */
  readonly resolveProvider: (
    profileName: string | undefined,
    setting: ReviewProfileSetting,
  ) => Promise<CompressionProviderResult>;
  readonly usageLogger: () => Pick<
    TokenUsageLogger,
    'recordLifecycleEvent'
  > | null;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
  readonly newOperationId?: () => string;
}

type Verdict = TokenUsageRefusalReviewEvent['verdict'];

/** How one review went, before it is logged. */
interface ReviewRun {
  readonly outcome: ReviewOutcome;
  readonly verdict: Verdict;
  readonly reviewer?: ReviewerIdentity;
  readonly call?: ReviewCallResult;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reviewContents(data: string): IContent[] {
  return [
    {
      speaker: 'human',
      blocks: [
        { type: 'text', text: REFUSAL_REVIEW_PROMPT },
        { type: 'text', text: data },
      ],
    },
  ];
}

/**
 * Reviews the context a refused request carries (issue #4036). It talks to the
 * reviewer's provider directly and never through the chat turn loop, so a
 * review can neither commit to history nor trigger refusal recovery itself.
 */
export class HistoryRefusalReviewer implements RefusalReviewer {
  constructor(private readonly deps: RefusalReviewerDeps) {}

  async begin(request: ReviewRequest): Promise<StartedReview> {
    const setting: ReviewProfileSetting =
      request.reviewProfile === undefined
        ? 'compression.profile'
        : 'refusal.review-profile';
    const profile = request.reviewProfile ?? this.deps.compressionProfile();
    let resolved: CompressionProviderResult;
    try {
      resolved = await this.deps.resolveProvider(profile, setting);
    } catch (error: unknown) {
      this.rethrowIfAborted(request, error);
      const run = this.stopped(
        'unusable-profile',
        'error',
        undefined,
        messageOf(error),
      );
      return { reviewer: undefined, run: () => Promise.resolve(run.outcome) };
    }
    const reviewer: ReviewerIdentity = {
      ...(profile !== undefined && { profile }),
      provider: resolved.provider.name,
      model:
        resolved.resolved?.model ??
        String(resolved.runtime.metadata?.model ?? request.attempt.model),
    };
    // A named profile is an isolated route with parameters of its own; only
    // the session-model fallback may reuse the refused request's admission.
    const modelParameters =
      profile === undefined ? request.modelParameters : undefined;
    return {
      reviewer,
      run: async () => {
        const run = await this.callAndApply(
          request,
          resolved,
          reviewer,
          modelParameters,
        );
        await this.log(request, run);
        return run.outcome;
      },
    };
  }

  /** Asks the reviewer and applies its answer, in one step. */
  async review(request: ReviewRequest): Promise<ReviewOutcome> {
    return (await this.begin(request)).run();
  }

  private async callAndApply(
    request: ReviewRequest,
    resolved: CompressionProviderResult,
    reviewer: ReviewerIdentity,
    modelParameters: AdmittedModelParameters | undefined,
  ): Promise<ReviewRun> {
    const history = this.deps.history();
    const window = buildReviewWindow(
      history.getAll(),
      request.pending?.userContents,
    );
    let call: ReviewCallResult;
    try {
      call = await this.call(request, resolved, window, modelParameters);
    } catch (error: unknown) {
      this.rethrowIfAborted(request, error);
      return this.stopped(
        'reviewer-failed',
        'error',
        reviewer,
        messageOf(error),
      );
    }
    if (isRefusalFinishReason(call.finishReason)) {
      return this.stopped('reviewer-refused', 'refused', reviewer, '', call);
    }
    const parsed = parseReviewReply(call.text, window);
    if (!parsed.ok) {
      return this.stopped(
        'invalid-reply',
        'invalid',
        reviewer,
        parsed.reason,
        call,
      );
    }
    const { decision } = parsed;
    if (decision.kind === 'disallowed') {
      const { explanation } = decision;
      return {
        outcome: { kind: 'disallowed', reviewer, explanation },
        verdict: 'disallowed',
        reviewer,
        call,
      };
    }
    if (decision.kind === 'no_change') {
      return this.stopped(
        'no-change',
        'no_change',
        reviewer,
        decision.explanation,
        call,
      );
    }
    return this.rewrite(request, { history, window, reviewer, call, decision });
  }

  private async rewrite(
    request: ReviewRequest,
    input: {
      readonly history: HistoryService;
      readonly window: ReviewWindow;
      readonly reviewer: ReviewerIdentity;
      readonly call: ReviewCallResult;
      readonly decision: {
        explanation: string;
        rewrites: ReadonlyArray<{ id: string; newText: string }>;
      };
    },
  ): Promise<ReviewRun> {
    const { reviewer, call, decision } = input;
    const operationId = (this.deps.newOperationId ?? randomUUID)();
    const pendingEdits = pendingEditsOf(input.window, decision.rewrites);
    const result = await applyReviewedRewrite({
      history: input.history,
      window: input.window,
      rewrites: decision.rewrites,
      execution: request.execution,
      attempt: request.attempt,
      reviewer,
      explanation: decision.explanation,
      operationId,
      now: (this.deps.now ?? (() => new Date()))(),
      signal: request.signal,
      historyUnchanged: pendingEdits.length === decision.rewrites.length,
    });
    if (result.kind === 'history-changed') {
      return this.stopped('history-changed', 'error', reviewer, '', call);
    }
    if (result.kind === 'commit-failed') {
      return this.stopped(
        'commit-failed',
        'error',
        reviewer,
        result.detail,
        call,
      );
    }
    return {
      outcome: {
        kind: 'rewritten',
        reviewer,
        operationId,
        explanation: decision.explanation,
        changes: result.changes,
        pendingEdits,
      },
      verdict: 'rewrite',
      reviewer,
      call,
    };
  }

  private async call(
    request: ReviewRequest,
    resolved: CompressionProviderResult,
    window: ReviewWindow,
    modelParameters: AdmittedModelParameters | undefined,
  ): Promise<ReviewCallResult> {
    const data = buildReviewData(window, request.attempt, request.retriesTried);
    const options = await buildCompressionChatOptions({
      contents: reviewContents(data),
      providerRuntime: resolved.runtime,
      resolvedConfig: resolved.config,
      fallbackConfig: this.deps.config(),
      resolvedOptions: resolved.resolved,
      invocation: resolved.invocation,
      fallbackModel: this.deps.runtimeState.model,
      runtimeState: this.deps.runtimeState,
      provider: resolved.provider,
      modelParameters,
      source: 'RefusalReviewer.callProvider',
    });
    return callReviewProvider(resolved.provider, options, {
      timeoutMs: this.deps.timeoutMs ?? REVIEW_TIMEOUT_MS,
      signal: request.signal,
    });
  }

  private stopped(
    reason: Extract<ReviewOutcome, { kind: 'stopped' }>['reason'],
    verdict: Verdict,
    reviewer: ReviewerIdentity | undefined,
    detail: string,
    call?: ReviewCallResult,
  ): ReviewRun {
    return {
      outcome: { kind: 'stopped', reason, reviewer, detail },
      verdict,
      ...(reviewer !== undefined && { reviewer }),
      ...(call !== undefined && { call }),
    };
  }

  /** A user abort ends the whole request; it is not a review result. */
  private rethrowIfAborted(request: ReviewRequest, error: unknown): void {
    if (request.signal?.aborted === true) throw error;
  }

  private async log(request: ReviewRequest, run: ReviewRun): Promise<void> {
    const logger = this.deps.usageLogger();
    if (logger === null || run.reviewer === undefined) return;
    const usage = run.call?.usage;
    await logger.recordLifecycleEvent({
      type: 'refusal_review',
      sessionId: this.deps.runtimeState.sessionId,
      turnId: request.attempt.turnId,
      promptId: request.attempt.promptId,
      provider: run.reviewer.provider,
      model: run.reviewer.model,
      verdict: run.verdict,
      ...(usage !== undefined && {
        promptTokens: usage.promptTokens,
        outputTokens: usage.completionTokens,
      }),
      ...(run.call?.finishReason !== undefined && {
        finishReason: run.call.finishReason,
      }),
    });
  }
}
