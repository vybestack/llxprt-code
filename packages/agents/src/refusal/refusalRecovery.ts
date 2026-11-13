/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describeRefusalRecovered,
  describeRefusalRetry,
  describeRefusalStop,
  describeReviewDisallowed,
  describeReviewRewrite,
  describeReviewStart,
  describeReviewStopped,
  type RewriteSummary,
} from './refusalNotices.js';
import {
  captureRefusalPolicy,
  decideRefusal,
  type RefusalPolicy,
  type RefusalPolicySource,
} from './refusalPolicy.js';
import { recordRefusalInJournal } from './refusalJournal.js';
import type { RefusalWait } from './refusalWait.js';
import type {
  RefusalAttempt,
  RefusalContext,
  RefusalDecision,
  RefusalRecovery,
  ResolvedRefusalDecision,
} from './refusalTypes.js';
import type { RefusalReviewer, ReviewOutcome } from './reviewTypes.js';

/** Logical requests whose budgets are remembered before the oldest is dropped. */
const MAX_TRACKED_REQUESTS = 64;

/** The budget of one logical request: its policy and what it has spent. */
interface RequestBudget {
  readonly policy: RefusalPolicy;
  /** Identical retries used in the current round; a rewrite starts a new one. */
  retriesUsed: number;
  rewritesUsed: number;
  /** Refused attempts so far, whatever followed each. */
  refusals: number;
  /** Waits granted so far, for the summary shown when recovery gives up. */
  readonly delaysMs: number[];
  /** Reviews that rewrote context, for the summary and the recovery notice. */
  readonly rewrites: RewriteSummary[];
  recoveryAnnounced: boolean;
  /** Attempt indexes handed out so far, over every send under the prompt id. */
  attemptsAllocated: number;
}

export interface RefusalRecoveryDeps {
  /** Live settings; read once per logical request, at admission. */
  readonly settings: RefusalPolicySource;
  /** Abortable wait used between a refusal and its retry. */
  readonly wait: RefusalWait;
  /** Reviews and rewrites context once identical retries are exhausted. */
  readonly reviewer?: RefusalReviewer;
}

/**
 * Decides what follows each refused attempt of a logical request.
 *
 * The logical request is identified by its prompt id. Everything the
 * orchestrator does under one prompt id (task-list continuation, thinking-only
 * retries, AfterAgent follow-ups, payload recovery) spends one budget, and the
 * policy is fixed when the request is first seen. Tool round trips and
 * subagent turns carry their own prompt ids, so each is a request of its own.
 */
export class RefusalRecoveryCoordinator implements RefusalRecovery {
  private readonly budgets = new Map<string, RequestBudget>();

  constructor(private readonly deps: RefusalRecoveryDeps) {}

  /** Abortable wait before a retry; rejects as soon as `signal` aborts. */
  wait(ms: number, signal?: AbortSignal): Promise<void> {
    return this.deps.wait(ms, signal);
  }

  /** Fixes the policy for `promptId` the first time the request is seen. */
  admit(promptId: string): void {
    this.budgetFor(promptId);
  }

  allocateAttempt(promptId: string): number {
    const budget = this.budgetFor(promptId);
    const index = budget.attemptsAllocated;
    budget.attemptsAllocated += 1;
    return index;
  }

  async decide(
    attempt: RefusalAttempt,
    context: RefusalContext = {},
  ): Promise<RefusalDecision> {
    const budget = this.budgetFor(attempt.promptId);
    budget.refusals += 1;
    const verdict = decideRefusal(budget.policy, budget);
    if (verdict.action === 'retry') {
      budget.retriesUsed = verdict.retryNumber;
      budget.delaysMs.push(verdict.delayMs);
      return {
        action: 'retry',
        delayMs: verdict.delayMs,
        notice: describeRefusalRetry({
          model: attempt.model,
          delayMs: verdict.delayMs,
          retryNumber: verdict.retryNumber,
          retries: budget.policy.retries,
        }),
      };
    }
    if (verdict.action === 'review' && this.deps.reviewer !== undefined) {
      return this.review(this.deps.reviewer, attempt, budget, context);
    }
    return this.stop(attempt, budget);
  }

  recovered(promptId: string): string | undefined {
    const budget = this.budgets.get(promptId);
    const last = budget?.rewrites[budget.rewrites.length - 1];
    if (
      budget === undefined ||
      last === undefined ||
      budget.recoveryAnnounced
    ) {
      return undefined;
    }
    budget.recoveryAnnounced = true;
    return describeRefusalRecovered(last.reviewer);
  }

  /**
   * Hands the refused request to the reviewer. The caller is told who is being
   * asked before the answer is awaited. A rewrite starts a fresh retry round
   * for the rewritten request; every other outcome ends the request with the
   * reviewer's own explanation.
   */
  private async review(
    reviewer: RefusalReviewer,
    attempt: RefusalAttempt,
    budget: RequestBudget,
    context: RefusalContext,
  ): Promise<RefusalDecision> {
    await recordRefusalInJournal(context.execution, attempt, 'review');
    const started = await reviewer.begin({
      attempt,
      reviewProfile: budget.policy.reviewProfile,
      retriesTried: budget.delaysMs.length,
      execution: context.execution,
      pending: context.pending,
      modelParameters: context.modelParameters,
      signal: context.signal,
    });
    const resolve = async (): Promise<ResolvedRefusalDecision> =>
      this.afterReview(await started.run(), budget);
    if (started.reviewer === undefined) return resolve();
    return {
      action: 'review',
      notice: describeReviewStart({
        model: attempt.model,
        refusals: budget.refusals,
        reviewer: started.reviewer.model,
      }),
      complete: resolve,
    };
  }

  private afterReview(
    outcome: ReviewOutcome,
    budget: RequestBudget,
  ): ResolvedRefusalDecision {
    if (outcome.kind === 'rewritten') {
      budget.rewritesUsed += 1;
      budget.retriesUsed = 0;
      budget.rewrites.push({
        reviewer: outcome.reviewer.model,
        messages: outcome.changes.length,
      });
      return {
        action: 'retry',
        delayMs: 0,
        notice: describeReviewRewrite({
          reviewer: outcome.reviewer.model,
          changes: outcome.changes,
          operationId: outcome.operationId,
        }),
        rewrite: { pendingEdits: outcome.pendingEdits },
      };
    }
    if (outcome.kind === 'disallowed') {
      return {
        action: 'stop',
        notice: describeReviewDisallowed({
          reviewer: outcome.reviewer.model,
          explanation: outcome.explanation,
        }),
      };
    }
    return {
      action: 'stop',
      notice: describeReviewStopped({
        reason: outcome.reason,
        reviewer: outcome.reviewer?.model,
        detail: outcome.detail,
      }),
    };
  }

  private stop(
    attempt: RefusalAttempt,
    budget: RequestBudget,
  ): ResolvedRefusalDecision {
    if (budget.delaysMs.length === 0 && budget.rewrites.length === 0) {
      return { action: 'stop' };
    }
    return {
      action: 'stop',
      notice: describeRefusalStop({
        model: attempt.model,
        refusals: budget.refusals,
        delaysMs: budget.delaysMs,
        rewrites: budget.rewrites,
      }),
    };
  }

  private budgetFor(promptId: string): RequestBudget {
    const known = this.budgets.get(promptId);
    if (known !== undefined) return known;
    const created: RequestBudget = {
      policy: captureRefusalPolicy(this.deps.settings),
      retriesUsed: 0,
      rewritesUsed: 0,
      refusals: 0,
      delaysMs: [],
      rewrites: [],
      recoveryAnnounced: false,
      attemptsAllocated: 0,
    };
    this.budgets.set(promptId, created);
    if (this.budgets.size > MAX_TRACKED_REQUESTS) {
      const oldest = this.budgets.keys().next();
      if (oldest.done !== true) this.budgets.delete(oldest.value);
    }
    return created;
  }
}
