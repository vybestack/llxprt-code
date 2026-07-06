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
    autoOAuth?: boolean;
    addItem?: (event: OAuthUIEvent, timestamp?: number) => number | undefined;
  } = {};
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
