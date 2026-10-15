import {
  useConsumerPromptDirectory,
  acquireConsumerRelease,
  selectConsumerTokenizer,
  createConsumerContentGenerator,
  acquireConsumerPolicy,
  acquireConsumerMedia,
  createConsumerSessionClient,
} from './helpers/consumer-owner-primitives.js';
import type { RuntimePolicyOwner } from '@vybestack/llxprt-code-core';
import { Config } from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { SessionSettingsOwner } from '@vybestack/llxprt-code-core';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';

import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
  preparePreferredProviderCompletion,
} from '../preferred-provider-acquisition.js';

import { randomUUID } from 'node:crypto';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../core/subagent-cleanup.js';
import { SessionClientOwner } from '../../session/session-client-owner.js';

import { describe, expect, it } from 'bun:test';

import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';

import { executeProviderActivation } from '../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';
import { assembleModelSelection } from '../model-selection.js';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import * as fc from 'fast-check';

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260621-COREAPIREMED.P19
 * @requirement:REQ-INT-003
 *
 * Broad parity harness — settings surface. Exercises the SAME public entry
 * points the eventual #1595 CLI will use (`agent.getEphemeralSetting` /
 * `setEphemeralSetting` / `getEphemeralSettings`) against a REAL CLI-style
 * Config + a REAL FakeProvider JSONL fixture. This is a PARITY-EXPANSION /
 * VERIFICATION gate (NOT a RED TDD phase): the settings seam is already
 * implemented (P12), so a PASSING suite is the success condition.
 *
 * Scenario T8 (mirroring pseudocode cli-integration-adapter.md lines 60-68):
 *   - numeric normalization: setEphemeralSetting('context-limit','1000') →
 *     getEphemeralSetting returns the number 1000 (Config rule), AND parity
 *     with the Config after the same set.
 *   - streaming enum: setEphemeralSetting('streaming','enabled') →
 *     getEphemeralSetting returns 'enabled', parity with Config.
 *   - invalid throws: setEphemeralSetting('streaming',123) throws with a
 *     message naming 'must resolve' (the Config rule propagates; never
 *     swallowed).
 *   - deep-equal: agent.getEphemeralSettings() deep-equals
 *     built.config.getEphemeralSettings() after the same mutations.
 *
 * Property (lines 70-73): for any inert key + JSON scalar value, set through
 * the agent and read through both the agent and the Config are strictly equal.
 */

describe('settings-surface parity @plan:PLAN-20260621-COREAPIREMED.P19 @requirement:REQ-INT-003', () => {
  useConsumerPromptDirectory();

  const credentials = useOwnedCredentials();
  let callerConfig: Config;
  let callerSettings: SettingsService;
  let callerSettingsOwner: SessionSettingsOwner;
  let callerPolicy: RuntimePolicyOwner;
  let callerMcp: McpRuntimeOwner;
  let callerManager: ReturnType<typeof acquirePreferredProviderManager>;
  let callerOwner: SessionClientOwner;
  let callerClose: () => Promise<void>;
  const callerFactories = createAgentRuntimeFactoryBindings();
  let callerRelease: ReturnType<typeof acquireConsumerRelease>;
  let callerFiles: ProviderFileLifecycle;
  let callerRuntimeId: string;
  let callerOAuth: ReturnType<typeof acquirePreferredOAuth>;
  let callerTokenizer: ReturnType<typeof selectConsumerTokenizer>;
  let callerContent: ReturnType<typeof createConsumerContentGenerator>;

  async function openCaller(fixture: string): Promise<void> {
    const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/' + fixture, import.meta.url),
    );
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'caller-adoption-')),
    );
    callerConfig = new Config({
      ...toConfigParameters({
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        workingDir: directory,
      }),
      interactive: true,
      includeDirectories: [process.cwd()],
    });
    callerSettings = new SettingsService();
    callerPolicy = acquireConsumerPolicy(callerConfig);

    callerMcp = await buildTestMcpRuntime(
      callerConfig,
      callerPolicy.session.messageBus,
      {},
      undefined,
      callerPolicy,
    );
    acquireCallerProviders();
    const media = acquireConsumerMedia(callerConfig, 1024 * 1024 * 1024);
    callerOwner = await createConsumerSessionClient(
      callerConfig,
      callerSettings,
      callerManager,
      callerFactories.agentClientFactory,
      media.store,
      callerMcp.readInstructions,
      callerMcp.workspacePaths,
      callerSettingsOwner,
      callerContent,
      callerTokenizer,
    );
    callerOwner.bindMcpRuntime(callerMcp);
    callerOwner.bindProviderFiles(callerFiles, (provider) =>
      callerOAuth.composeRetryOperations(provider),
    );
    callerOwner.bindHooks();
    callerClose = settleEngineRelease.bind(
      undefined,
      [
        () => callerOwner.dispose(),
        () => callerRelease.close(),
        () => media.dispose(),
        () => callerMcp.dispose(),
        () => callerConfig.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ],
      previousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        callerConfig,
        callerSettings,
        callerSettingsOwner,
        callerManager,
        callerOAuth,
        callerRuntimeId,
        callerTokenizer,
        undefined,
      );
      await callerMcp.initialize();
      await activateCallerClient();
    } catch (primary) {
      await cleanupAfterFailure(primary, callerClose);
    }
  }
  function acquireCallerProviders(): void {
    callerRuntimeId = 'caller-' + randomUUID();

    callerSettingsOwner = new SessionSettingsOwner(callerSettings);

    callerSettingsOwner.initializeProviderSelection(
      callerConfig.getProvider(),
      callerConfig.getModel(),
    );
    callerSettingsOwner.bindTelemetry(callerConfig);
    callerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    callerRelease = acquireConsumerRelease(
      callerSettingsOwner,
      callerFiles,
      callerRuntimeId,
      callerConfig.getSessionId(),
    );
    callerManager = acquirePreferredProviderManager(
      callerConfig,
      callerSettings,
      callerSettingsOwner,
      callerFiles,
      callerRuntimeId,
      credentials().authority,
      callerRelease,
    );
    callerTokenizer = selectConsumerTokenizer(callerManager);
    callerContent = createConsumerContentGenerator();

    callerOAuth = acquirePreferredOAuth(
      undefined,
      callerPolicy.session.messageBus,
      callerConfig,
      callerSettings,
      callerManager,
      callerRuntimeId,
      callerMcp.profileDefinitions,
      credentials().authority,
      callerRelease,
      undefined,
    );
  }
  async function activateCallerClient(): Promise<void> {
    const activation = await executeProviderActivation(
      callerConfig,
      { provider: callerConfig.getProvider(), model: callerConfig.getModel() },
      assembleProviderSwitch(
        callerConfig,
        callerSettings,
        callerManager,
        callerOAuth,
        () => 'agent',
        () => callerOwner.refreshAuth(),
        callerSettingsOwner,
      ),
      callerSettings,
      callerManager,
      (method) => callerOwner.refreshAuth(method),
      assembleModelSelection(callerSettingsOwner),
    );
    requireCallerActivation(activation);
    await callerOwner.initializeTools();
    await callerOwner.getAgentClient().startChat();
  }

  it('T8a numeric normalize: agent.setEphemeralSetting("context-limit","1000") yields the Config-normalized number 1000 and parity with the Config (REQ-INT-003)', async () => {
    await openCaller('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig({
        settingsOwner: callerSettingsOwner,
        settingsService: callerSettings,
        agentClient: callerOwner.getAgentClient(),
        providerManager: callerManager,
        config: callerConfig,
        mcpRuntime: callerMcp,
      });
      try {
        agent.setEphemeralSetting('context-limit', '1000');
        const viaAgent = agent.getEphemeralSetting('context-limit');

        // Config normalization: numeric string → number.
        expect(viaAgent).toBe(1000);
        expect(typeof viaAgent).toBe('number');

        // Parity: the SAME set on the Config yields the same value.
        callerSettingsOwner.writeUserParameter('context-limit', '1000');
        expect(viaAgent).toBe(
          callerSettingsOwner.readNamedParameter('context-limit'),
        );
      } finally {
        await agent.dispose();
      }
    } finally {
      await callerClose();
    }
  }, 30000);

  it('T8b streaming enum: agent.setEphemeralSetting("streaming","enabled") yields "enabled" and parity with the Config (REQ-INT-003)', async () => {
    await openCaller('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig({
        settingsOwner: callerSettingsOwner,
        settingsService: callerSettings,
        agentClient: callerOwner.getAgentClient(),
        providerManager: callerManager,
        config: callerConfig,
        mcpRuntime: callerMcp,
      });
      try {
        agent.setEphemeralSetting('streaming', 'enabled');
        const viaAgent = agent.getEphemeralSetting('streaming');

        expect(viaAgent).toBe('enabled');

        callerSettingsOwner.writeUserParameter('streaming', 'enabled');
        expect(viaAgent).toBe(
          callerSettingsOwner.readNamedParameter('streaming'),
        );
      } finally {
        await agent.dispose();
      }
    } finally {
      await callerClose();
    }
  }, 30000);

  it('T8c invalid streaming throws with "must resolve" — the Config rule propagates, never swallowed (REQ-INT-003)', async () => {
    await openCaller('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig({
        settingsOwner: callerSettingsOwner,
        settingsService: callerSettings,
        agentClient: callerOwner.getAgentClient(),
        providerManager: callerManager,
        config: callerConfig,
        mcpRuntime: callerMcp,
      });
      try {
        // The Config rule (configBase.ts:207) throws
        // 'Streaming setting must resolve to "enabled" or "disabled"'; the
        // agent MUST propagate it, never swallow.
        expect(() => agent.setEphemeralSetting('streaming', 123)).toThrow(
          /must resolve/,
        );
      } finally {
        await agent.dispose();
      }
    } finally {
      await callerClose();
    }
  }, 30000);

  it('T8d deep-equal: agent.getEphemeralSettings() deep-equals built.config.getEphemeralSettings() after the same mutations (REQ-INT-003)', async () => {
    await openCaller('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig({
        settingsOwner: callerSettingsOwner,
        settingsService: callerSettings,
        agentClient: callerOwner.getAgentClient(),
        providerManager: callerManager,
        config: callerConfig,
        mcpRuntime: callerMcp,
      });
      try {
        agent.setEphemeralSetting('context-limit', 50000);
        agent.setEphemeralSetting('streaming', 'disabled');
        agent.setEphemeralSetting('parity-key', 'v');

        callerSettingsOwner.writeUserParameter('context-limit', 50000);
        callerSettingsOwner.writeUserParameter('streaming', 'disabled');
        callerSettingsOwner.writeUserParameter('parity-key', 'v');

        expect(agent.getEphemeralSettings()).toStrictEqual(
          callerSettingsOwner.captureNamedParameters(),
        );
      } finally {
        await agent.dispose();
      }
    } finally {
      await callerClose();
    }
  }, 30000);

  // ─── Property-based (>=30% of total) ─────────────────────────────────────

  it('PROP round-trip: for any inert key + JSON scalar value, set-through-agent then read-through-agent strictly equals read-through-Config (REQ-INT-003)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('alpha', 'beta', 'gamma', 'my-key', 'x1'),
        fc.oneof(fc.string({ maxLength: 40 }), fc.integer(), fc.boolean()),
        async (key, value) => {
          await openCaller('plain-text.jsonl');
          try {
            const agent: Agent = await fromConfig({
              settingsOwner: callerSettingsOwner,
              settingsService: callerSettings,
              agentClient: callerOwner.getAgentClient(),
              providerManager: callerManager,
              config: callerConfig,
              mcpRuntime: callerMcp,
            });
            try {
              agent.setEphemeralSetting(key, value);
              callerSettingsOwner.writeUserParameter(key, value);
              return (
                agent.getEphemeralSetting(key) ===
                callerSettingsOwner.readNamedParameter(key)
              );
            } finally {
              await agent.dispose();
            }
          } finally {
            await callerClose();
          }
        },
      ),
    );
  }, 30000);

  it('PROP streaming enum parity: for streaming in {enabled, disabled}, agent and Config normalize identically (REQ-INT-003)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom('enabled', 'disabled'), async (mode) => {
        await openCaller('plain-text.jsonl');
        try {
          const agent: Agent = await fromConfig({
            settingsOwner: callerSettingsOwner,
            settingsService: callerSettings,
            agentClient: callerOwner.getAgentClient(),
            providerManager: callerManager,
            config: callerConfig,
            mcpRuntime: callerMcp,
          });
          try {
            agent.setEphemeralSetting('streaming', mode);
            callerSettingsOwner.writeUserParameter('streaming', mode);
            return (
              agent.getEphemeralSetting('streaming') ===
              callerSettingsOwner.readNamedParameter('streaming')
            );
          } finally {
            await agent.dispose();
          }
        } finally {
          await callerClose();
        }
      }),
    );
  }, 30000);
});

async function settleEngineRelease(
  steps: ReadonlyArray<() => void | Promise<void>>,
  previousReplay: string | undefined,
): Promise<void> {
  try {
    await runCleanupSteps(steps);
  } finally {
    if (previousReplay === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previousReplay;
  }
}

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
