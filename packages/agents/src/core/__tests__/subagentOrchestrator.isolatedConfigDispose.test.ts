import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { createSessionSettingsFixture } from '../../api/__tests__/helpers/session-settings-fixture.js';
import type { TestChildLaunchOptions } from './child-launch-fixture.js';
import { createTestChildOrchestrator } from './child-launch-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { emptyInstructionReads } from '@vybestack/llxprt-code-test-utils/core/instructions.js';
import { fixtureToolSelection } from './subagentOrchestrator-test-helpers.js';

import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { installTestWorkspacePaths } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { createAgentRuntimeFactoryBindings } from '../../api/runtimeFactories.js';
const fixturePaths = installTestWorkspacePaths({
  targetDir: process.cwd(),
  isTrusted: () => true,
});

/**
 * The isolated runtime owns its session clients and settings independently
 * of the foreground Config. Each teardown path must close the real clients'
 * auxiliary admission; successful disposal must also close runtime policy reads.
 */

import { describe, expect, it, vi } from 'bun:test';

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import type { SubagentConfig } from '@vybestack/llxprt-code-core/config/types.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { Profile, ProfileManager } from '@vybestack/llxprt-code-settings';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SubAgentScopeFactory } from '../subagent.js';
import { SubagentOrchestrator } from '../subagentOrchestrator.js';
import {
  createRuntimeBundle,
  fakeChildScope,
  makeForegroundConfig,
} from './subagentOrchestrator-test-helpers.js';

async function expectClientsClosed(
  clients: readonly AgentClientContract[],
): Promise<void> {
  for (const client of clients) {
    await expect(client.generateEmbedding(['after teardown'])).rejects.toThrow(
      'Auxiliary generation is closed',
    );
  }
}

/** Fail-fast read of the client activation constructed on the Config. */
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

  type TestRuntimeLoader = NonNullable<TestChildLaunchOptions['runtimeLoader']>;
  type TestScopeFactory = NonNullable<TestChildLaunchOptions['scopeFactory']>;

  function buildOrchestrator(options: {
    runtimeLoader: TestRuntimeLoader;
    scopeFactory: TestScopeFactory;
  }): {
    orchestrator: SubagentOrchestrator;
    clients: readonly AgentClientContract[];
  } {
    const clients: AgentClientContract[] = [];
    const factories = createAgentRuntimeFactoryBindings();
    const loadSubagent = vi.fn().mockResolvedValue(subagentConfig);
    const loadProfile = vi.fn().mockResolvedValue(profile);
    const foregroundConfig1 = makeForegroundConfig();
    const foregroundSettings1 = createSessionSettingsFixture(foregroundConfig1);
    const orchestrator = createTestChildOrchestrator({
      credentialAuthority: new CredentialAuthority(),
      workspaceTrust: foregroundSettings1.workspaceTrust,
      createChildSettings: () =>
        foregroundSettings1.settingsOwner.createChildStore(),
      readRunPolicy: () =>
        foregroundSettings1.settingsOwner.readSubagentRunPolicy(),

      instructions: emptyInstructionReads,
      toolRegistry: fixtureToolSelection(),
      runtimeFactoryBindings: {
        ...factories,
        agentClientFactory: (...args) => {
          const client = factories.agentClientFactory(...args);
          clients.push(client);
          return client;
        },
      },
      subagentManager: { loadSubagent } as unknown as SubagentManager,
      profileManager: { loadProfile } as unknown as ProfileManager,
      workspacePaths: fixturePaths(),
      foregroundConfig: foregroundConfig1,
      readMcpInstructions: () => undefined,
      scopeFactory: options.scopeFactory,
      runtimeLoader: options.runtimeLoader,
      messageBus: new MessageBus(),
    });
    return { orchestrator, clients };
  }

  it('disposes the orchestrator-constructed isolated Config on the success path (result.dispose)', async () => {
    await withIsolatedConfigHome(async () => {
      const runtimeBundle = createRuntimeBundle('dispose-success');
      const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);
      const scope = fakeChildScope({
        dispose: async () => {},
        getAgentId: () => 'planner-dispose-success',
      });
      const scopeFactory = vi
        .fn<SubAgentScopeFactory>()
        .mockResolvedValue(scope);

      const { orchestrator, clients } = buildOrchestrator({
        runtimeLoader,
        scopeFactory,
      });
      const result = await orchestrator.launch({
        name: subagentConfig.name,
        runConfig: { max_time_minutes: 8, max_turns: 12 },
      });

      const isolatedConfig = isolatedConfigFromLoaderCalls(
        runtimeLoader.mock.calls,
      );
      // Activation replaces the bootstrap client with a provider-bound client.
      expect(clients).toHaveLength(2);
      expect(() => clients[0]?.assertConfig(isolatedConfig)).not.toThrow();
      const readRuntimeSettings =
        runtimeLoader.mock.calls[0][0].profile.readRuntimeSettings;
      if (readRuntimeSettings === undefined)
        throw new Error('Missing isolated runtime policy');
      expect(() => readRuntimeSettings()).not.toThrow();

      await result.dispose();

      // Client admission must be closed before the isolated runtime is released.
      await expectClientsClosed(clients);
      expect(() => readRuntimeSettings()).toThrow('closed');

      // Double dispose is safe (Config.dispose is idempotent here).
      await expect(result.dispose()).resolves.toBeUndefined();
    });
  });

  it('disposes the isolated Config when scope creation fails after runtime assembly', async () => {
    await withIsolatedConfigHome(async () => {
      const runtimeBundle = createRuntimeBundle('dispose-scope-failure');
      const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);
      const scopeFactory = vi
        .fn<SubAgentScopeFactory>()
        .mockRejectedValue(new Error('scope creation failed'));

      const { orchestrator, clients } = buildOrchestrator({
        runtimeLoader,
        scopeFactory,
      });
      await expect(
        orchestrator.launch({
          name: subagentConfig.name,
          runConfig: { max_time_minutes: 8, max_turns: 12 },
        }),
      ).rejects.toThrow('scope creation failed');

      // The original error surfaced; the isolated Config was still disposed.
      expect(clients).toHaveLength(2);
      expect(() =>
        clients[0]?.assertConfig(
          isolatedConfigFromLoaderCalls(runtimeLoader.mock.calls),
        ),
      ).not.toThrow();
      await expectClientsClosed(clients);
    });
  });

  it('disposes the isolated Config when the runtime loader fails after activation', async () => {
    await withIsolatedConfigHome(async () => {
      const runtimeLoader = vi
        .fn()
        .mockRejectedValue(new Error('runtime loader failed'));
      const scopeFactory = vi
        .fn<SubAgentScopeFactory>()
        .mockResolvedValue(fakeChildScope());

      const { orchestrator, clients } = buildOrchestrator({
        runtimeLoader,
        scopeFactory,
      });
      await expect(
        orchestrator.launch({
          name: subagentConfig.name,
          runConfig: { max_time_minutes: 8, max_turns: 12 },
        }),
      ).rejects.toThrow('runtime loader failed');

      // The original error surfaced; the isolated Config was still disposed.
      expect(clients).toHaveLength(2);
      expect(() =>
        clients[0]?.assertConfig(
          isolatedConfigFromLoaderCalls(runtimeLoader.mock.calls),
        ),
      ).not.toThrow();
      await expectClientsClosed(clients);
    });
  });
});
