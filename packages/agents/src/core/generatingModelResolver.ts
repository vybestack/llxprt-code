/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';

const logger = new DebugLogger('llxprt:agents:generating-model');

function isNonBlank(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function readProviderCurrentModel(
  provider: RuntimeProvider,
): string | undefined {
  if (typeof provider.getCurrentModel !== 'function') {
    return undefined;
  }
  try {
    const model = provider.getCurrentModel();
    return isNonBlank(model) ? model : undefined;
  } catch (error) {
    // Falling back is intended, but a silent swallow would make a model
    // misattribution regression (issue #2511) undiagnosable.
    logger.debug(
      () =>
        `[resolveGeneratingModel] ${provider.name}.getCurrentModel() threw: ${error}`,
    );
    return undefined;
  }
}

/**
 * Resolve the model that actually generated a turn, for stamping at the
 * recording boundary.
 *
 * Fallback chain (issues #2511, #2335):
 *
 * 1. AC1: Read the live provider's `getCurrentModel()` — the same authority
 *    the display path (`buildEffectiveModelIdentity`) already uses. This
 *    ensures a mid-session profile load stamps the model that actually served
 *    the request, not the stale `AgentRuntimeState.model` snapshot captured at
 *    ChatSession construction. The blank check here is real:
 *    `LoadBalancingProvider.getCurrentModel()` returns `''` when the selected
 *    sub-profile has no model, so it must fall through to step 2.
 * 2. AC3: If the live accessor is absent, throws, or returns a blank string,
 *    fall back to `AgentRuntimeState.model`, which is guaranteed non-blank by
 *    `createAgentRuntimeState` (it throws MODEL_MISSING on a blank model).
 *    `stampAiTurnModel` already skips empty/blank model strings, so the
 *    observable AC3 behaviour ("stamp nothing when there is no model") is
 *    preserved without a dead branch.
 *
 * When `provider` is supplied (the TurnProcessor call site, which holds the
 * exact provider that produced the response), read `getCurrentModel()` from it
 * directly and do NOT call `getActiveProvider()` — that lookup can diverge if
 * the active provider changes between generation and recording. When omitted
 * (the ConversationManager call site, which has no provider handle), fall back
 * to the `runtimeContext.provider.getActiveProvider()` lookup.
 *
 * AC4 is satisfied implicitly: load-balancer providers return the selected
 * sub-profile model from `getCurrentModel()`, so step 1 yields the correct
 * answer.
 */
export function resolveGeneratingModel(
  runtimeContext: AgentRuntimeContext,
  provider?: RuntimeProvider,
): string {
  const liveProvider = provider ?? resolveActiveProvider(runtimeContext);
  if (liveProvider !== undefined) {
    const liveModel = readProviderCurrentModel(liveProvider);
    if (liveModel !== undefined) {
      return liveModel;
    }
  }
  return runtimeContext.state.model;
}

function resolveActiveProvider(
  runtimeContext: AgentRuntimeContext,
): RuntimeProvider | undefined {
  try {
    return runtimeContext.provider.getActiveProvider();
  } catch (error) {
    // Provider unavailable — fall through to runtime-state fallback, but keep
    // the reason observable so attribution regressions stay diagnosable.
    logger.debug(
      () => `[resolveGeneratingModel] getActiveProvider() threw: ${error}`,
    );
    return undefined;
  }
}
