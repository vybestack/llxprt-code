/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config, MessageBus } from '@vybestack/llxprt-code-core';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import { registerCleanup } from './utils/cleanup.js';
import {
  switchActiveProvider,
  setActiveModel,
} from '@vybestack/llxprt-code-providers/runtime/runtimeSettings.js';

export interface ForegroundAgentOptions {
  config: Config;
  sessionMessageBus: MessageBus;
}

/**
 * `fromConfig` → `activate()` calls `resetInfrastructure()` which clears the
 * active provider on the shared ProviderManager. This re-activates the provider
 * and model that were configured (via --profile-load or --provider) so the
 * status bar and the first request use the correct provider.
 */
async function restoreActiveProvider(
  config: Config,
  agent: Agent,
): Promise<void> {
  const provider = config.getProvider() ?? agent.getProvider();
  if (!provider) return;
  try {
    await switchActiveProvider(provider);
    const model = config.getModel();
    if (model && model !== 'placeholder-model') {
      await setActiveModel(model);
    }
  } catch {
    // Best-effort: auth will be triggered lazily on the first API call.
  }
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
 * The adopted {@link Config} is a temporary migration bridge: later subissues
 * (see #1595) will remove the remaining direct Config consumers in the UI.
 */
export async function createForegroundAgent({
  config,
  sessionMessageBus,
}: ForegroundAgentOptions): Promise<Agent> {
  const agent = await fromConfig({ config, messageBus: sessionMessageBus });

  // fromConfig → activate() resets the active provider on the shared
  // ProviderManager; restore it so profile-loaded providers survive.
  await restoreActiveProvider(config, agent);

  registerCleanup(async () => {
    await agent.dispose();
  });

  return agent;
}
