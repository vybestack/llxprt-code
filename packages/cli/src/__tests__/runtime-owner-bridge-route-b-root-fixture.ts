/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { Config } from '@vybestack/llxprt-code-core';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import type {
  AgentConfig,
  ProviderActivationIntent,
} from '../../../agents/src/api/config-types.js';
import { openRouteBPreflight } from '../../../agents/src/api/__tests__/helpers/route-b-preflight.js';
import {
  cleanupAfterFailure,
  runCleanupSteps,
} from '../../../agents/src/core/subagent-cleanup.js';

export interface BridgeRootOptions {
  readonly authority: CredentialAuthority;
  /** Runtime id and session id of the root; two roots may share one. */
  readonly label: string;
  /** Fields merged over the helper's defaults. */
  readonly config?: Partial<AgentConfig>;
  /** The provider activation the foreground agent is built for. */
  readonly intent?: ProviderActivationIntent;
}

/**
 * One foreground agent the way the CLI builds it (Route B), over a
 * `SessionSettingsOwner` the test owns, so the test can read and write the
 * owner's parameters. The caller disposes the agent first; `close` releases
 * the owner and the route.
 */
export interface BridgeRoot {
  readonly agent: Agent;
  readonly settingsOwner: SessionSettingsOwner;
  readonly config: Config;
  readonly close: () => Promise<void>;
}

export async function openBridgeRoot(
  options: BridgeRootOptions,
): Promise<BridgeRoot> {
  const route = await openRouteBPreflight({
    authority: options.authority,
    runtimeId: options.label,
    config: {
      sessionId: options.label,
      interactive: true,
      ...options.config,
    },
  });
  const settingsOwner = new SessionSettingsOwner(route.settings);
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> =>
    (closing ??= runCleanupSteps([
      () => settingsOwner.dispose(),
      () => route.close(),
    ]));
  try {
    settingsOwner.initializeProviderSelection(
      route.config.getProvider(),
      route.config.getModel(),
    );
    await route.prepare({ settingsOwner });
    const agent = await route.createAgent(options.intent);
    return { agent, settingsOwner, config: route.config, close };
  } catch (primary) {
    return cleanupAfterFailure(primary, close);
  }
}
