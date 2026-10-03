/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type Config,
  type MessageBus,
  PLACEHOLDER_MODEL,
} from '@vybestack/llxprt-code-core';
import {
  fromConfig,
  type Agent,
  type ProviderActivationIntent,
  type ActivationPreflightToken,
} from '@vybestack/llxprt-code-agents';

import { registerCleanup } from './utils/cleanup.js';
import { createPolicyUpdater } from './config/policy.js';
import {
  hasProfileAuthEphemerals,
  snapshotProfileAuthEphemerals,
} from './config/profileAuthEphemerals.js';

export interface ForegroundAgentOptions {
  config: Config;
  messageBus: MessageBus;
  activationPreflightToken?: ActivationPreflightToken;
  activationPreflightIntent?: ProviderActivationIntent;
}

/**
 * Single creation point for the interactive CLI Agent.
 *
 * Adopts the already-built {@link Config} through the public {@link fromConfig}
 * entrypoint. The CLI runtime supplies its bus explicitly to fromConfig so
 * provider events, OAuth, policy updates, and tool approvals use the same bus.
 * The Agent borrows this bus and does not close it on disposal.
 * `fromConfig` keeps `configOwnership` caller-owned (its default), which means
 * the returned Agent's `dispose()` deliberately SKIPS `config.dispose()` —
 * recording/Config teardown remains owned by the existing bootstrap.
 *
 * #2374: Provider activation + auth is now declarative — the activation
 * intent is passed to fromConfig instead of imperatively calling the provider
 * switch primitive after construction. The intent reproduces the exact
 * precedence the old restoreActiveProvider followed: profile auth ephemerals
 * are snapshotted so the executor can preserve them across the switch; the
 * provider is derived from config (or the agent fallback); the model is
 * reasserted when it is not the placeholder sentinel.
 */
export async function createForegroundAgent({
  config,
  messageBus,
  activationPreflightToken,
  activationPreflightIntent,
}: ForegroundAgentOptions): Promise<Agent> {
  const provider = config.getProvider();
  const model = config.getModel();
  const profileAuthEphemerals = snapshotProfileAuthEphemerals(config);

  // Build the activation intent mirroring the old restoreActiveProvider logic:
  // - authMode 'auto' (auth initialization with provider auth + fallback)
  // - provider from config
  // - model reasserted when not the placeholder sentinel
  // - profile auth ephemerals snapshotted so the executor preserves them
  const activation: ProviderActivationIntent = {
    provider: provider ?? undefined,
    authMode: 'auto',
    ...(model && model !== PLACEHOLDER_MODEL ? { model } : {}),
    ...(hasProfileAuthEphemerals(profileAuthEphemerals)
      ? { cliOverrides: { keyName: undefined } }
      : {}),
  };

  const agent = await fromConfig({
    config,
    messageBus,
    activation: activationPreflightIntent ?? activation,
    activationPreflightToken,
  });

  // Wire the session policy engine to UPDATE_POLICY bus messages ("Allow for
  // this session/for all future sessions") against the exact Config engine
  // and Agent bus the scheduler uses.
  createPolicyUpdater(config.getPolicyEngine(), agent.getMessageBus());

  registerCleanup(async () => {
    await agent.dispose();
  });

  return agent;
}
