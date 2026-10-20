/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'bun:test';
import { createUiSessionOwner, uiFixtureResources } from './uiSessionOwner.js';
import { Config } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';

/**
 * Minimal fake {@link Agent} satisfying the threaded `agent` prop in UI tests.
 *
 * The interactive component suites mock the streaming hooks wholesale, so the
 * Agent itself is never exercised — it only needs to satisfy the type and prove
 * the component mounts when given one. Centralizing the stub here keeps the
 * ongoing Agent-prop migration (#1595) from turning future contract tweaks into
 * multi-file copy edits.
 */
export async function createMockAgent(config: Config): Promise<Agent> {
  const owner = await createUiSessionOwner(
    config instanceof Config ? config : undefined,
  );
  return {
    workspace: owner.workspace,
    providerReads: owner.providerReads,
    authentication: owner.authentication,
    dispose: vi.fn().mockResolvedValue(undefined),
    hasActiveProvider: () =>
      uiFixtureResources(owner).manager.hasActiveProvider(),
    getProviderContextLimit: () =>
      uiFixtureResources(owner)
        .manager.getActiveProvider()
        ?.getContextLimit?.(),
    listAvailableModels: (provider?: string) =>
      uiFixtureResources(owner).manager.getAvailableModels(provider),
    sessionClient: owner.sessionClient,
  } as unknown as Agent;
}
