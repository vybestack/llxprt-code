/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config, MessageBus } from '@vybestack/llxprt-code-core';
import {
  fromConfig,
  type Agent,
  type ProviderActivationIntent,
} from '@vybestack/llxprt-code-agents';
import { registerCleanup } from './utils/cleanup.js';
import {
  hasProfileAuthEphemerals,
  snapshotProfileAuthEphemerals,
} from './config/profileAuthEphemerals.js';

export interface ForegroundAgentOptions {
  config: Config;
  sessionMessageBus: MessageBus;
}

/**
 * Single creation point for the interactive CLI Agent.
 *
 * Adopts the already-built {@link Config} and the bootstrap session
 * {@link MessageBus} through the public {@link fromConfig} entrypoint, so no
 * second ProviderManager/MessageBus is constructed. `fromConfig` keeps
 * `configOwnership` caller-owned (its default), which means the returned
 * Agent's `dispose()` deliberately SKIPS `config.dispose()` — recording/Config
 * teardown remains owned by the existing bootstrap.
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
  sessionMessageBus,
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
    ...(model && model !== 'placeholder-model' ? { model } : {}),
    ...(hasProfileAuthEphemerals(profileAuthEphemerals)
      ? { cliOverrides: { keyName: undefined } }
      : {}),
  };

  const agent = await fromConfig({
    config,
    messageBus: sessionMessageBus,
    activation,
  });

  registerCleanup(async () => {
    await agent.dispose();
  });

  return agent;
}
