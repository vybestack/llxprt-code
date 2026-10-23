import type { ProviderSwitcher } from '@vybestack/llxprt-code-core';
import type { AgentProviderState } from './control/authState.js';
import type { AgentProviderSwitchResult } from './agent.js';
import { UNCONFIGURED_PROVIDER } from './constants.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Adapts the public AgentProviderSwitchOptions into the runtime
 * ProviderSwitchOptions shape, including the OAuthUICallback bridge. Extracted
 * from agentImpl.ts to keep that module under the project's max-lines limit.
 *
 * @plan:PLAN-20270104-ISSUE2374.P04
 */

import type { OAuthUIEvent } from '@vybestack/llxprt-code-auth';
import type { AgentProviderSwitchOptions } from './agent.js';

/**
 * The runtime ProviderSwitchOptions subset we forward. The runtime
 * `addItem` callback consumes the auth package's discriminated
 * {@link OAuthUIEvent} union; the public agent callback consumes the broader
 * {@link AgentOAuthUIEvent} shape (a single object with optional url/icon/
 * color). This module bridges the two so neither the agent facade nor its
 * callers couple to the auth package's callback type.
 */
export interface RuntimeSwitchOptions {
  readonly preserveEphemerals?: string[];
  readonly skipModelDefaults?: boolean;
  readonly autoOAuth?: boolean;
  readonly addItem?: (
    event: OAuthUIEvent,
    timestamp?: number,
  ) => number | undefined;
}

/**
 * Maps the public AgentProviderSwitchOptions to the runtime options consumed by
 * switchActiveProvider. The runtime callback returns `number | undefined`; the
 * public callback returns `number | void`, so the bridge coerces void →
 * undefined.
 *
 * The runtime emits the auth package's discriminated {@link OAuthUIEvent}
 * union; the public callback accepts the wider {@link AgentOAuthUIEvent} shape
 * (every OAuthUIEvent variant is structurally assignable to AgentOAuthUIEvent),
 * so the event is forwarded without coercion.
 */
export function toRuntimeSwitchOptions(
  options: AgentProviderSwitchOptions | undefined,
): RuntimeSwitchOptions {
  if (options === undefined) {
    return {};
  }
  const adapted: {
    preserveEphemerals?: string[];
    skipModelDefaults?: boolean;
    autoOAuth?: boolean;
    addItem?: (event: OAuthUIEvent, timestamp?: number) => number | undefined;
  } = {
    preserveEphemerals: options.preserveEphemerals,
    skipModelDefaults: options.skipModelDefaults,
  };
  if (options.autoOAuth !== undefined) {
    adapted.autoOAuth = options.autoOAuth;
  }
  if (options.addItem !== undefined) {
    const userCb = options.addItem;
    adapted.addItem = (
      event: OAuthUIEvent,
      timestamp?: number,
    ): number | undefined => {
      const result = userCb(event, timestamp);
      return typeof result === 'number' ? result : undefined;
    };
  }
  return adapted;
}

export async function applyFacadeProviderSwitch(
  provider: string,
  model: string | undefined,
  options: AgentProviderSwitchOptions | undefined,
  state: AgentProviderState,
  switchProvider: ProviderSwitcher,
  selectModel: (model: string) => Promise<void>,
  refreshAuth: () => Promise<void>,
  restoreVisibility: () => Promise<void>,
  rebuild: () => void,
): Promise<AgentProviderSwitchResult> {
  const previousProvider = state.provider;
  // switchActiveProvider rebuilds the content generator internally; under the
  // fake seam the named provider is not registered and this throws (no-op).
  let providerChanged = false;
  let infoMessages: readonly string[] = [];
  let defaultModel: string | undefined;
  try {
    const switchResult = await switchProvider(
      provider,
      toRuntimeSwitchOptions(options),
    );
    providerChanged = switchResult.changed;
    infoMessages = switchResult.infoMessages;
    defaultModel = switchResult.defaultModel;
  } catch (error) {
    // Only the EXPECTED fake-seam case is suppressed: the fake seam sets
    // LLXPRT_FAKE_RESPONSES to a fixture-file path (never the string '1'), so
    // the seam predicate is simply "the env var is set at all". A REAL
    // provider-switch failure (env var not set) must propagate so a genuine
    // failure is never reported as success — facade state below is then left
    // untouched.
    const isFakeSeam = process.env.LLXPRT_FAKE_RESPONSES !== undefined;
    if (!isFakeSeam) {
      throw error;
    }
    // Provider not registered (fake seam) — the active provider handles all
    // requests. Per-agent state still reflects the switch (getProvider etc.).
  }
  if (providerChanged) {
    // Real provider switch succeeded; apply the requested model (if any) via
    // setActiveModel + the explicit model-only rebuild.
    if (model !== undefined && model !== state.model) {
      await selectModel(model);
      await refreshAuth();
    }
    await restoreVisibility();
  } else if (model !== undefined && model !== state.model) {
    // Same provider, different model — apply the model to the runtime
    // without reinitializing the content generator (the provider did not
    // change, so the client/HistoryService identity is preserved).
    // setActiveModel updates the model on the existing provider; the
    // rebuild() below propagates it to the loop (#2374 deepthinker finding).
    await selectModel(model);
  }
  // Under the fake seam (providerChanged === false), the client is unchanged;
  // history/HistoryService identity is trivially preserved (same client).
  state.provider = provider;
  if (model !== undefined) {
    state.model = model;
  }
  rebuild();
  return {
    changed: providerChanged,
    previousProvider:
      previousProvider === UNCONFIGURED_PROVIDER ? null : previousProvider,
    nextProvider: provider,
    ...(defaultModel !== undefined ? { defaultModel } : {}),
    infoMessages,
  };
}
