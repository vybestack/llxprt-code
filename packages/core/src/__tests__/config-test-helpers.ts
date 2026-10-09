/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../config/config.js';
import type { AgentClientContract } from '../core/clientContract.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import {
  initializeTestConfig as initializeTestConfigImpl,
  attachTestAgentFactories as attachTestAgentFactoriesImpl,
  getTestRuntimeMessageBus as getTestRuntimeMessageBusImpl,
  makeFakeConfig as makeFakeConfigImpl,
  createTestAgentClient as createTestAgentClientImpl,
} from '@vybestack/llxprt-code-test-utils/core/config.js';

/**
 * The Config-coupled test helpers live in @vybestack/llxprt-code-test-utils.
 * When this package typechecks its own tests, TypeScript resolves that
 * workspace through its compiled declarations (project reference redirect),
 * so the `Config` in those helper signatures is the dist declaration. That
 * declaration and src/config/config.ts are nominally incompatible because of
 * private members, even though bun executes a single source of truth via the
 * `bun` export condition. These wrappers restore src-side types for core
 * tests, confining the declaration-identity cast to this one boundary.
 */

export async function initializeTestConfig(config: Config): Promise<void> {
  await initializeTestConfigImpl(
    config as unknown as Parameters<typeof initializeTestConfigImpl>[0],
  );
}

export function attachTestAgentFactories(config: Config): void {
  attachTestAgentFactoriesImpl(
    config as unknown as Parameters<typeof attachTestAgentFactoriesImpl>[0],
  );
}

export function getTestRuntimeMessageBus(config: Config): MessageBus {
  return getTestRuntimeMessageBusImpl(
    config as unknown as Parameters<typeof getTestRuntimeMessageBusImpl>[0],
  ) as unknown as MessageBus;
}

export function makeFakeConfig(options?: {
  ephemeralSettings?: Record<string, unknown>;
}): Config {
  return makeFakeConfigImpl(options) as unknown as Config;
}

export function createTestAgentClient(
  overrides?: Partial<AgentClientContract>,
): AgentClientContract {
  return createTestAgentClientImpl(
    overrides as unknown as Parameters<typeof createTestAgentClientImpl>[0],
  ) as unknown as AgentClientContract;
}
