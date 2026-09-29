/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../../config/config.js';
import type { LspServiceClient } from '@vybestack/llxprt-code-ide-integration';
import {
  initializeLsp,
  shutdownLsp,
  type LspState,
} from '../../config/lspIntegration.js';
import { initializeTestConfig } from '../../__tests__/config-test-helpers.js';

const states = new WeakMap<Config, LspState>();

/** Core LSP integration tests start the service explicitly, outside Config. */
export async function initializeTestLsp(config: Config): Promise<void> {
  await initializeTestConfig(config);
  const state: LspState = { lspConfig: config.getLspConfig() };
  states.set(config, state);
  await initializeLsp(state, config);
}

export function testLspClient(config: Config): LspServiceClient | undefined {
  return states.get(config)?.lspServiceClient;
}

export async function shutdownTestLsp(config: Config): Promise<void> {
  const state = states.get(config);
  if (state === undefined) throw new Error('LSP test runtime was not started');
  await shutdownLsp(state, config.getToolRegistry());
}
