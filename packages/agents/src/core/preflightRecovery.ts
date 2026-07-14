/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChatSession } from './chatSession.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { PerformCompressionResult } from './turn.js';
import { getTokenLimitForConfiguredContext } from './contextLimitResolver.js';

/**
 * Shared overflow threshold: the guard trips when the estimated request
 * exceeds this fraction of remaining capacity. Defined once so the initial
 * check and the post-compression recheck always agree.
 */
const CONTEXT_OVERFLOW_THRESHOLD = 0.95;

export interface PreflightOverflowDeps {
  getChat: () => ChatSession;
  getEffectiveModelIdentity: () => {
    readonly providerName: string;
    readonly model: string;
  };
  config: Config;
  logger: DebugLogger;
}

export interface PreflightOverflowContext {
  promptId: string;
  estimatedRequestTokenCount: number;
  remainingTokenCount: number;
}

/**
 * Decides whether the preflight context-overflow guard should proceed or bail.
 * Returns true to proceed (the request fits, or automatic compression
 * recovered it). Returns false to bail with ContextWindowWillOverflow
 * (compression failed or the request still exceeds the limit).
 *
 * When overflow is detected, attempts automatic compression before bailing
 * (issue #2402) — the same recovery manual /compress, the load-balancer guard
 * (#2207), and the provider content enforcer (#2299) already perform.
 */
export async function resolvePreflightOverflow(
  deps: PreflightOverflowDeps,
  ctx: PreflightOverflowContext,
): Promise<boolean> {
  // No overflow: the request fits within the safety threshold. Keep the same
  // comparison sense as the original guard (overflow is `estimated >
  // remaining * threshold`) so a non-numeric remaining capacity (NaN, from
  // un-mocked limits in callers) falls through to "proceed" exactly as before.
  const overflows =
    ctx.estimatedRequestTokenCount >
    ctx.remainingTokenCount * CONTEXT_OVERFLOW_THRESHOLD;
  if (!overflows) {
    return true;
  }

  const { getChat, getEffectiveModelIdentity, config, logger } = deps;
  const chat = getChat();
  try {
    const result = await chat.performCompression(ctx.promptId, {
      bypassCooldown: true,
      trigger: 'auto',
    });
    if (result === PerformCompressionResult.FAILED) {
      logger.warn(
        () =>
          '[preflight] automatic compression failed during context-overflow recovery',
      );
      return false;
    }
    // Recompute remaining capacity from the (possibly reduced) baseline. Use
    // the projected baseline (API-observed count, or the history-derived
    // estimate when compression just nulled lastPromptTokenCount) — NOT
    // getLastPromptTokenCount(), which returns 0 right after compression.
    const newRemaining =
      getTokenLimitForConfiguredContext(
        getEffectiveModelIdentity().model,
        config,
      ) - chat.getProjectedPromptBaseline();
    if (newRemaining <= 0) {
      return true;
    }
    return (
      ctx.estimatedRequestTokenCount <=
      newRemaining * CONTEXT_OVERFLOW_THRESHOLD
    );
  } catch (error) {
    logger.warn(
      () =>
        '[preflight] compression attempt threw during context-overflow recovery',
      error,
    );
    return false;
  }
}
