/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared helpers for subagent orchestrator test files. Extracted from the
 * original monolithic subagentOrchestrator.test.ts so no file-level
 * max-lines disable is needed.
 */

import { vi } from 'vitest';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import type { Profile, ProfileManager } from '@vybestack/llxprt-code-settings';
import type { SubagentConfig } from '@vybestack/llxprt-code-core/config/types.js';
import type { RunConfig } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { SubagentOrchestrator } from '../subagentOrchestrator.js';
import { type SubAgentScope as SubAgentScopeInstance } from '../subagent.js';

export function makeForegroundConfig(): Config {
  return {
    getSessionId: () => 'primary-session',
    getProvider: () => 'gemini',
    getContentGeneratorConfig: () => undefined,
    getModel: () => 'gemini-1.5-flash',
    getToolRegistry: () => undefined,
  } as unknown as Config;
}

/**
 * Creates a stub scope factory and fake scope, returning both so callers can
 * inspect the `runConfig` (5th positional arg — index 4) passed to
 * `SubAgentScope.create`.
 */
export function createScopeFactory() {
  const fakeScope = {
    runtimeContext: {
      state: { runtimeId: 'runtime#1' },
      history: { clear: vi.fn() },
    },
    getAgentId: () => 'agent-helper-123',
  } as unknown as SubAgentScopeInstance;

  const factory = vi.fn<typeof SubAgentScopeInstance.create>(
    async () => fakeScope,
  );
  return { factory, fakeScope };
}

/**
 * Convenience builder that wires stub subagent/profile managers around a
 * single profile + subagent config, then constructs a real
 * {@link SubagentOrchestrator} with stubbed runtime/scope layers. Eliminates
 * the repeated manager-creation boilerplate across max-turns precedence tests.
 */
export function createOrchestratorForTurns(options: {
  subagentName: string;
  profileName?: string;
  systemPrompt?: string;
  profile: Profile;
  foregroundConfig?: Config;
  loadProfile?: (profileName: string) => Promise<Profile>;
}) {
  const subagentConfig: SubagentConfig = {
    name: options.subagentName,
    profile: options.profileName ?? 'default-profile',
    systemPrompt: options.systemPrompt ?? 'Assist.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const loadSubagent = vi.fn().mockResolvedValue(subagentConfig);
  const subagentManager = {
    loadSubagent,
  } as unknown as SubagentManager;

  const loadProfile = vi.fn(
    options.loadProfile ?? (async () => options.profile),
  );
  const profileManager = {
    loadProfile,
  } as unknown as ProfileManager;

  const { factory } = createScopeFactory();
  const runtimeLoader = vi.fn().mockResolvedValue(createRuntimeBundle());

  const orchestrator = new SubagentOrchestrator({
    subagentManager,
    profileManager,
    foregroundConfig: options.foregroundConfig ?? makeForegroundConfig(),
    scopeFactory: factory,
    runtimeLoader,
  });

  return { orchestrator, factory };
}

/**
 * Extracts the `runConfig` (5th positional arg — index 4) passed to the scope
 * factory on the given invocation, so tests can assert `max_turns` values.
 */
export function extractRunConfig(
  factory: ReturnType<typeof createScopeFactory>['factory'],
  callIndex = 0,
): RunConfig {
  if (callIndex < 0 || callIndex >= factory.mock.calls.length) {
    throw new Error(`Scope factory call ${callIndex} does not exist`);
  }
  const factoryCall = factory.mock.calls[callIndex];
  if (factoryCall.length <= 4) {
    throw new Error(
      `Scope factory call ${callIndex} does not contain a runConfig argument`,
    );
  }
  return factoryCall[4];
}

export function createRuntimeBundle(label = 'bundle') {
  const clearHistory = vi.fn();
  const history = { clear: clearHistory } as unknown as {
    clear: () => void;
  };
  const runtimeContext = {
    state: { runtimeId: `${label}-runtime-id`, sessionId: `${label}-session` },
    history,
    ephemerals: {
      compressionThreshold: () => 0.85,
      contextLimit: () => 20_000,
      preserveThreshold: () => 0.3,
      toolFormatOverride: () => undefined,
    },
    telemetry: {},
    provider: {},
    tools: { listToolNames: () => [], getToolMetadata: () => undefined },
    providerRuntime: {},
  } as unknown as SubAgentScopeInstance['runtimeContext'];

  return {
    runtimeContext,
    history,
    providerAdapter: {},
    telemetryAdapter: {},
    toolsView: {
      listToolNames: () => [],
      getToolMetadata: () => undefined,
    },
    contentGenerator: {},
  };
}
