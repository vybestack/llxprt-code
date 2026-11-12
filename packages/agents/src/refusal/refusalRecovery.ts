/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describeRefusalRetry, describeRefusalStop } from './refusalNotices.js';
import {
  captureRefusalPolicy,
  decideRefusal,
  type RefusalPolicy,
  type RefusalPolicySource,
} from './refusalPolicy.js';
import type { RefusalWait } from './refusalWait.js';
import type {
  RefusalAttempt,
  RefusalDecision,
  RefusalRecovery,
} from './refusalTypes.js';

/** Logical requests whose budgets are remembered before the oldest is dropped. */
const MAX_TRACKED_REQUESTS = 64;

/** The budget of one logical request: its policy and what it has spent. */
interface RequestBudget {
  readonly policy: RefusalPolicy;
  retriesUsed: number;
  rewritesUsed: number;
  /** Waits granted so far, for the summary shown when recovery gives up. */
  readonly delaysMs: number[];
}

export interface RefusalRecoveryDeps {
  /** Live settings; read once per logical request, at admission. */
  readonly settings: RefusalPolicySource;
  /** Abortable wait used between a refusal and its retry. */
  readonly wait: RefusalWait;
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

  decide(attempt: RefusalAttempt): RefusalDecision {
    const budget = this.budgetFor(attempt.promptId);
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
    // Phase 3 hands the refusal to the reviewer when the verdict is 'review'.
    // Until review exists it resolves to a stop, so it is journaled as one.
    return this.stop(attempt, budget);
  }

  private stop(
    attempt: RefusalAttempt,
    budget: RequestBudget,
  ): RefusalDecision {
    if (budget.delaysMs.length === 0) return { action: 'stop' };
    return {
      action: 'stop',
      notice: describeRefusalStop({
        model: attempt.model,
        delaysMs: budget.delaysMs,
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
      delaysMs: [],
    };
    this.budgets.set(promptId, created);
    if (this.budgets.size > MAX_TRACKED_REQUESTS) {
      const oldest = this.budgets.keys().next();
      if (oldest.done !== true) this.budgets.delete(oldest.value);
    }
    return created;
  }
}
