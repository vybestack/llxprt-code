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
import type { ProviderSwitcher } from '@vybestack/llxprt-code-core';
import type { AgentProviderSwitchOptions } from './agent.js';
import type { AgentProviderSwitchResult } from './agent.js';
import { UNCONFIGURED_PROVIDER } from './constants.js';
import type { AgentProviderState } from './control/authState.js';

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
  readonly publication?: 'deferred';
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
 *
 * `publication: 'deferred'` makes the switch leave model publication to its
 * caller, which runs the whole switch inside one publication window and
 * announces the model actually in force afterwards.
 */
export function toRuntimeSwitchOptions(
  options: AgentProviderSwitchOptions | undefined,
  publication?: 'deferred',
): RuntimeSwitchOptions {
  if (options === undefined) {
    return publication === undefined ? {} : { publication };
  }
  const adapted: {
    preserveEphemerals?: string[];
    skipModelDefaults?: boolean;
    autoOAuth?: boolean;
    addItem?: (event: OAuthUIEvent, timestamp?: number) => number | undefined;
    publication?: 'deferred';
  } = {
    preserveEphemerals: options.preserveEphemerals,
    skipModelDefaults: options.skipModelDefaults,
  };
  if (publication !== undefined) {
    adapted.publication = publication;
  }
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

/**
 * The facade operations a provider switch drives, in order. `readAppliedModel`
 * reads the model the runtime actually has in force, which after a successful
 * switch without an explicit model is the target provider's default rather
 * than the facade's previous name.
 */
export interface FacadeSwitchOperations {
  readonly selectModel: (model: string) => Promise<void>;
  readonly refreshAuth: () => Promise<void>;
  readonly restoreVisibility: () => Promise<void>;
  readonly rebuild: () => void;
  readonly readAppliedModel: () => string;
}

export async function applyFacadeProviderSwitch(
  provider: string,
  model: string | undefined,
  options: AgentProviderSwitchOptions | undefined,
  state: AgentProviderState,
  switchProvider: ProviderSwitcher,
  operations: FacadeSwitchOperations,
  publication?: 'deferred',
): Promise<AgentProviderSwitchResult> {
  const previousProvider = state.provider;
  // switchActiveProvider rebuilds the content generator internally. A failure
  // propagates and leaves the facade state below untouched.
  const switchResult = await switchProvider(
    provider,
    toRuntimeSwitchOptions(options, publication),
  );
  const providerChanged = switchResult.changed;
  const infoMessages = switchResult.infoMessages;
  const defaultModel = switchResult.defaultModel;
  if (providerChanged) {
    // Real provider switch succeeded; apply the requested model (if any) via
    // setActiveModel + the explicit model-only rebuild. The comparison is
    // against the model in force, so a request equal to the previous provider's
    // model is still applied instead of silently keeping the new default.
    if (model !== undefined && model !== operations.readAppliedModel()) {
      await operations.selectModel(model);
      await operations.refreshAuth();
    }
    await operations.restoreVisibility();
  } else if (model !== undefined && model !== operations.readAppliedModel()) {
    // Same provider, different model — apply the model to the runtime
    // without reinitializing the content generator (the provider did not
    // change, so the client/HistoryService identity is preserved).
    // setActiveModel updates the model on the existing provider; the
    // rebuild() below propagates it to the loop (#2374 deepthinker finding).
    await operations.selectModel(model);
  }
  // When providerChanged is false the client is unchanged, so its
  // history/HistoryService identity is trivially preserved.
  state.provider = provider;
  // A real switch without an explicit model leaves the target provider's
  // default in force; the applied model must describe what the runtime uses.
  if (providerChanged || model !== undefined)
    state.model = operations.readAppliedModel();
  operations.rebuild();
  return {
    changed: providerChanged,
    previousProvider:
      previousProvider === UNCONFIGURED_PROVIDER ? null : previousProvider,
    nextProvider: provider,
    ...(defaultModel !== undefined ? { defaultModel } : {}),
    infoMessages,
  };
}
