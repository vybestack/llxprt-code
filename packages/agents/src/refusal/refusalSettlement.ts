/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentChatRecordingExecution } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { toRefusalAttempt } from './refusalDetection.js';
import { recordRefusalInJournal } from './refusalJournal.js';
import type { ModelRefusalSignal, RefusalRecovery } from './refusalTypes.js';

interface RefusalSettlementDeps {
  readonly recovery: RefusalRecovery;
  readonly usageLogger: { finalizePrompt(promptId: string): void } | null;
  readonly provider: () => string;
  readonly model: () => string;
  readonly execution: AgentChatRecordingExecution | undefined;
}

/**
 * Applies the recovery policy to a refused attempt and journals the decision.
 * In Phase 1 every decision is a stop: the pending token-usage state is
 * finalized and the request ends without an error. The attempt's output was
 * already withheld from history by the stream finalizer.
 */
export async function settleRefusal(
  deps: RefusalSettlementDeps,
  signal: ModelRefusalSignal,
  promptId: string,
  attemptIndex: number,
): Promise<{ error: unknown; action: 'retry' | 'stop' }> {
  const refused = toRefusalAttempt(signal.evidence, {
    promptId,
    attemptIndex,
    provider: deps.provider(),
    model: deps.model(),
  });
  const decision = await deps.recovery.decide(refused);
  await recordRefusalInJournal(deps.execution, refused, decision);
  deps.usageLogger?.finalizePrompt(promptId);
  return { error: null, action: 'stop' };
}
