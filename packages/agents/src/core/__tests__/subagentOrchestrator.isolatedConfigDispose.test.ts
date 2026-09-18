/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3222 follow-up: the orchestrator constructs the isolated subagent
 * Config (buildIsolatedAgentConfig) and hands it to the isolated runtime
 * factory, which treats that Config as CALLER-OWNED — the handle cleanup
 * never disposes it, and SubAgentScope.dispose does not touch it either.
 * These tests pin the disposal contract on every teardown path (success,
 * scope-creation failure, runtime-loader failure) through REAL
 * collaborators: provider activation's refreshAuth constructs a real
 * AgentClient on that Config, whose constructor subscribes to the
 * runtime-state registry; only Config.dispose() -> client.dispose()
 * releases that subscription. The probe reads that subscription handle
 * structurally (function -> undefined), the same idiom as the API layer's
 * disposalProbe helper.
 */

import { describe, expect, it, vi } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import type { Profile, ProfileManager } from '@vybestack/llxprt-code-settings';
import type { SubagentConfig } from '@vybestack/llxprt-code-core/config/types.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { SubAgentScope } from '../subagent.js';
import { SubagentOrchestrator } from '../subagentOrchestrator.js';
import type { SubagentOrchestratorOptions } from '../subagentOrchestrator.js';
import {
  makeForegroundConfig,
  createRuntimeBundle,
} from './subagentOrchestrator-test-helpers.js';

/** True while the client's runtime-state subscription is still registered. */
function agentClientSubscribed(client: AgentClientContract): boolean {
  return (
    (client as unknown as { _unsubscribe?: unknown })._unsubscribe !== undefined
  );
}

/** Fail-fast read of the client activation constructed on the Config. */
function requireAgentClient(config: Config): AgentClientContract {
  const client = config.getAgentClient() as AgentClientContract | undefined;
  if (client === undefined) {
    throw new Error('isolated config did not construct an agent client');
  }
  return client;
}

/** The isolated Config threads to the runtime loader as profile.config. */
function isolatedConfigFromLoaderCalls(
  runtimeLoaderCalls: ReadonlyArray<readonly unknown[]>,
): Config {
  const options = runtimeLoaderCalls[0]?.[0] as
    | { profile?: { config?: Config } }
    | undefined;
  if (options?.profile?.config === undefined) {
    throw new Error('runtime loader did not receive the isolated config');
  }
  return options.profile.config;
}

/** Runs the body with LLXPRT_CONFIG_HOME pointed at a throwaway directory. */
async function withIsolatedConfigHome(run: () => Promise<void>): Promise<void> {
  const isolatedHome = mkdtempSync(join(tmpdir(), 'issue3222-cfg-dispose-'));
  const previous = process.env.LLXPRT_CONFIG_HOME;
  process.env.LLXPRT_CONFIG_HOME = isolatedHome;
  try {
    await run();
  } finally {
    if (previous === undefined) {
      delete process.env.LLXPRT_CONFIG_HOME;
    } else {
      process.env.LLXPRT_CONFIG_HOME = previous;
    }
    rmSync(isolatedHome, { recursive: true, force: true });
  }
}

describe('SubagentOrchestrator - isolated Config disposal', () => {
  const subagentConfig: SubagentConfig = {
    name: 'planner',
    profile: 'planner-profile',
    systemPrompt: 'You are a structured planner.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // A BUILT-IN provider is required here: activation must register a real
  // provider on the isolated manager so refreshAuth constructs the real
  // AgentClient this test probes. Since #3702 gemini is contributed only by
  // the google-gemini runtime plugin, and the isolated subagent registration
  // path (registerProvidersOntoManager -> createProviderManager) still builds
  // a built-ins-only manager because nothing threads the CLI startup's plugin
  // contributions into it — a gap on main this test exposed (#3730). Anthropic keeps the probe fully real: alias registration,
  // switchActiveProvider, refreshAuth('provider'), AgentClient construction.
  const profile: Profile = {
    version: 1,
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    modelParams: { temperature: 0.3, top_p: 0.95 },
    ephemeralSettings: { 'auth-key': 'test-api-key' },
  };

  type TestRuntimeLoader = NonNullable<
    SubagentOrchestratorOptions['runtimeLoader']
  >;
  type TestScopeFactory = NonNullable<
    SubagentOrchestratorOptions['scopeFactory']
  >;

  function buildOrchestrator(options: {
    runtimeLoader: TestRuntimeLoader;
    scopeFactory: TestScopeFactory;
  }): SubagentOrchestrator {
    const loadSubagent = vi.fn().mockResolvedValue(subagentConfig);
    const loadProfile = vi.fn().mockResolvedValue(profile);
    return new SubagentOrchestrator({
      subagentManager: { loadSubagent } as unknown as SubagentManager,
      profileManager: { loadProfile } as unknown as ProfileManager,
      foregroundConfig: makeForegroundConfig(),
      scopeFactory: options.scopeFactory,
      runtimeLoader: options.runtimeLoader,
      messageBus: new MessageBus(),
    });
  }

  it('disposes the orchestrator-constructed isolated Config on the success path (result.dispose)', async () => {
    await withIsolatedConfigHome(async () => {
      const runtimeBundle = createRuntimeBundle('dispose-success');
      const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);
      const scope = {
        runtimeContext: runtimeBundle.runtimeContext,
        getAgentId: () => 'planner-dispose-success',
      } as unknown as SubAgentScope;
      const scopeFactory = vi
        .fn<typeof SubAgentScope.create>()
        .mockResolvedValue(scope);

      const orchestrator = buildOrchestrator({ runtimeLoader, scopeFactory });
      const result = await orchestrator.launch({
        name: subagentConfig.name,
        runConfig: { max_time_minutes: 8, max_turns: 12 },
      });

      const isolatedConfig = isolatedConfigFromLoaderCalls(
        runtimeLoader.mock.calls,
      );
      // Activation's refreshAuth constructed a real, subscribed client on the
      // isolated Config.
      const client = requireAgentClient(isolatedConfig);
      expect(agentClientSubscribed(client)).toBe(true);

      await result.dispose();

      // Config.dispose() released the client's registry subscription: the
      // success path previously never disposed this Config, leaving the
      // constructed client (and its subscription) alive.
      expect(agentClientSubscribed(client)).toBe(false);

      // Double dispose is safe (Config.dispose is idempotent here).
      await expect(result.dispose()).resolves.toBeUndefined();
    });
  });

  it('disposes the isolated Config when scope creation fails after runtime assembly', async () => {
    await withIsolatedConfigHome(async () => {
      const runtimeBundle = createRuntimeBundle('dispose-scope-failure');
      const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);
      const scopeFactory = vi
        .fn<typeof SubAgentScope.create>()
        .mockRejectedValue(new Error('scope creation failed'));

      const orchestrator = buildOrchestrator({ runtimeLoader, scopeFactory });
      await expect(
        orchestrator.launch({
          name: subagentConfig.name,
          runConfig: { max_time_minutes: 8, max_turns: 12 },
        }),
      ).rejects.toThrow('scope creation failed');

      // The original error surfaced; the isolated Config was still disposed.
      const client = requireAgentClient(
        isolatedConfigFromLoaderCalls(runtimeLoader.mock.calls),
      );
      expect(agentClientSubscribed(client)).toBe(false);
    });
  });

  it('disposes the isolated Config when the runtime loader fails after activation', async () => {
    await withIsolatedConfigHome(async () => {
      const runtimeLoader = vi
        .fn()
        .mockRejectedValue(new Error('runtime loader failed'));
      const scopeFactory = vi
        .fn<typeof SubAgentScope.create>()
        .mockResolvedValue({} as unknown as SubAgentScope);

      const orchestrator = buildOrchestrator({ runtimeLoader, scopeFactory });
      await expect(
        orchestrator.launch({
          name: subagentConfig.name,
          runConfig: { max_time_minutes: 8, max_turns: 12 },
        }),
      ).rejects.toThrow('runtime loader failed');

      // The original error surfaced; the isolated Config was still disposed.
      const client = requireAgentClient(
        isolatedConfigFromLoaderCalls(runtimeLoader.mock.calls),
      );
      expect(agentClientSubscribed(client)).toBe(false);
    });
  });
});
