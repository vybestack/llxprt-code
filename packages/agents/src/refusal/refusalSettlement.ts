/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentChatRecordingExecution } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { AdmittedModelParameters } from '@vybestack/llxprt-code-core/runtime/admittedModelParameters.js';
import { toRefusalAttempt } from './refusalDetection.js';
import { recordRefusalInJournal } from './refusalJournal.js';
import type {
  ModelRefusalSignal,
  RefusalAttempt,
  RefusalRecovery,
  ResolvedRefusalDecision,
} from './refusalTypes.js';
import type { PendingTurnContents } from './reviewTypes.js';
import type { PendingEdit } from './reviewWindow.js';

interface RefusalSettlementDeps {
  readonly recovery: RefusalRecovery;
  readonly usageLogger: { finalizePrompt(promptId: string): void } | null;
  readonly provider: () => string;
  readonly model: () => string;
  readonly execution: AgentChatRecordingExecution | undefined;
  /** The user turn of the refused request, for a review that reads it. */
  readonly pending: PendingTurnContents;
  readonly modelParameters: AdmittedModelParameters | undefined;
  readonly signal: AbortSignal | undefined;
}

/** How the turn loop proceeds after a refused attempt. */
export type RefusalSettlement =
  | {
      readonly action: 'retry-same-request';
      readonly delayMs: number;
      readonly notice: string;
      /** Set when a reviewer rewrote context: rebuild the resend. */
      readonly rewrite?: {
        readonly pendingEdits: readonly PendingEdit[];
        /** The committed history was rewritten, not just the pending turn. */
        readonly historyRewritten: boolean;
      };
    }
  | { readonly action: 'stop'; readonly notice?: string }
  | {
      /** A reviewer is about to be asked: show `notice`, then `complete`. */
      readonly action: 'review';
      readonly notice: string;
      complete(): Promise<RefusalSettlement>;
    };

/**
 * Applies the recovery policy to a refused attempt and journals the decision.
 * A retry keeps the prompt's pending token-usage state so the resend is logged
 * as the next attempt; a stop finalizes it. Either way the attempt's output
 * was already withheld from history by the stream finalizer.
 */
export async function settleRefusal(
  deps: RefusalSettlementDeps,
  signal: ModelRefusalSignal,
  promptId: string,
  attemptIndex: number,
): Promise<RefusalSettlement> {
  const refused = toRefusalAttempt(signal.evidence, {
    promptId,
    attemptIndex,
    provider: deps.provider(),
    model: deps.model(),
  });
  let decision;
  try {
    decision = await deps.recovery.decide(refused, {
      execution: deps.execution,
      pending: deps.pending,
      modelParameters: deps.modelParameters,
      signal: deps.signal,
    });
  } catch (error: unknown) {
    deps.usageLogger?.finalizePrompt(promptId);
    throw error;
  }
  if (decision.action === 'review') {
    const { notice, complete } = decision;
    return {
      action: 'review',
      notice,
      complete: async () => {
        try {
          return await settleResolved(
            deps,
            refused,
            promptId,
            await complete(),
          );
        } catch (error: unknown) {
          // An abort during a review ends the request; no attempt will
          // consume the prompt's pending token-usage state.
          deps.usageLogger?.finalizePrompt(promptId);
          throw error;
        }
      },
    };
  }
  return settleResolved(deps, refused, promptId, decision);
}

async function settleResolved(
  deps: RefusalSettlementDeps,
  refused: RefusalAttempt,
  promptId: string,
  decision: ResolvedRefusalDecision,
): Promise<RefusalSettlement> {
  await recordRefusalInJournal(
    deps.execution,
    refused,
    decision.action,
    decision.action === 'retry' ? decision.delayMs : undefined,
  );
  if (decision.action === 'retry') {
    return {
      action: 'retry-same-request',
      delayMs: decision.delayMs,
      notice: decision.notice,
      ...(decision.rewrite !== undefined && { rewrite: decision.rewrite }),
    };
  }
  deps.usageLogger?.finalizePrompt(promptId);
  return decision.notice === undefined
    ? { action: 'stop' }
    : { action: 'stop', notice: decision.notice };
}
