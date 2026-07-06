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
} from '@vybestack/llxprt-code-providers/runtime.js';
import {
  hasProfileAuthEphemerals,
  snapshotProfileAuthEphemerals,
} from './config/profileAuthEphemerals.js';

export interface ForegroundAgentOptions {
  config: Config;
  sessionMessageBus: MessageBus;
}

/**
 * `fromConfig` can disturb provider runtime state during foreground-agent
 * construction. For provider-only paths we re-switch the provider here. For
 * already-applied profile auth paths, switching again clears keyfile/base-url
 * ephemerals and regresses interactive profile-load, so the existing profile
 * runtime remains authoritative and only the model is reasserted.
 */

async function restoreActiveProvider(
  config: Config,
  agent: Agent,
): Promise<void> {
  const provider = config.getProvider() ?? agent.getProvider();
  if (!provider) return;
  try {
    const model = config.getModel();
    const profileAuthEphemerals = snapshotProfileAuthEphemerals(config);
    if (!hasProfileAuthEphemerals(profileAuthEphemerals)) {
      await switchActiveProvider(provider);
    }
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
