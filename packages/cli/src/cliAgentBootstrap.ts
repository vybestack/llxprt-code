/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config, MessageBus } from '@vybestack/llxprt-code-core';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import { registerCleanup } from './utils/cleanup.js';

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
 * The adopted {@link Config} is a temporary migration bridge: later subissues
 * (see #1595) will remove the remaining direct Config consumers in the UI.
 */
export async function createForegroundAgent({
  config,
  sessionMessageBus,
}: ForegroundAgentOptions): Promise<Agent> {
  const agent = await fromConfig({ config, messageBus: sessionMessageBus });

  // Dispose the Agent on every exit path (normal interactive exit and
  // interrupted/fatal startup). Because the Config is caller-owned, this
  // dispose() aborts active runs and fires SessionEnd without tearing down the
  // caller-owned Config.
  registerCleanup(async () => {
    await agent.dispose();
  });

  return agent;
}
