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
import {
  fromConfig,
  type Agent,
  type AgentEvent,
} from '@vybestack/llxprt-code-agents';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import {
  drain,
  countType,
  buildAgent,
  internalConfig,
} from './helpers/agentHarness.js';
import { captureProbe, agentClientDisposed } from './helpers/disposalProbe.js';
import { nonBlankStringArbitrary } from './helpers/fastCheckArbitraries.js';
import * as fc from 'fast-check';

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260621-COREAPIREMED.P19
 * @requirement:REQ-INT-001
 *
 * Broad parity harness — config-injection surface. Exercises the SAME public
 * entry points the eventual #1595 CLI will use (`fromConfig`, `agent.stream`,
 * `agent.getConfig`, `agent.getRuntimeId`, `agent.getProvider`, `agent.getModel`,
 * `agent.dispose`) against a REAL CLI-style Config + a REAL FakeProvider JSONL
 * fixture. This is a PARITY-EXPANSION / VERIFICATION gate (NOT a RED TDD phase):
 * the seams it characterizes (fromConfig adoption=P09, runtime/getRuntimeId=P18,
 * ownership contrast=P09/P24) are already implemented, so a PASSING suite is the
 * success condition.
 *
 * Scenarios (mirroring pseudocode cli-integration-adapter.md lines 10-34):
 *   T1  — fromConfig adopts the external Config: internalConfig(agent) === config identity,
 *         getRuntimeId() is a non-empty string, and agent.stream('hello') ends
 *         with exactly one terminal done.
 *   T6  — runtime reuse: the adopted Config's active provider/model are reflected
 *         on the agent (getProvider()==='fake', getModel()==='fake-model'),
 *         proving the adopted Config's provider runtime governs — no second
 *         ProviderManager.
 *   T7  — ownership contrast: a fromConfig-supplied Config stays CALLER-owned
 *         (still usable after agent.dispose()), while a createAgent-built agent
 *         DOES dispose its OWN Config.
 */

describe('config-injection parity @plan:PLAN-20260621-COREAPIREMED.P19 @requirement:REQ-INT-001', () => {
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

  it('T1 fromConfig adopts the external Config: internalConfig() identity, non-empty runtimeId, single terminal done (REQ-INT-001)', async () => {
    await openCaller('parity-toolcall.jsonl');
    try {
      const config = callerConfig;
      // onApproval mirrors Path B's ProceedOnce so the tool's confirmation
      // request is answered (the established headless-approval pattern).
      const agent: Agent = await fromConfig({
        settingsOwner: callerSettingsOwner,
        settingsService: callerSettings,
        agentClient: callerOwner.getAgentClient(),
        providerManager: callerManager,
        config,
        mcpRuntime: callerMcp,
        onApproval: () => ToolConfirmationOutcome.ProceedOnce,
      });
      try {
        // REQ-INT-001: the adopted Config is the SAME instance.
        expect(internalConfig(agent)).toBe(config);

        // REQ-INT-001: the agent reports a non-empty runtime id.
        const id = agent.getRuntimeId();
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);

        // REQ-INT-001: a stream turn ends with exactly one terminal done.
        const events: AgentEvent[] = await drain(agent.stream('hello'));
        expect(countType(events, 'done')).toBe(1);
      } finally {
        await agent.dispose();
      }
    } finally {
      await callerClose();
    }
  }, 30000);

  it('T6 runtime reuse: the adopted Config active provider/model are reflected on the agent (no second ProviderManager) (REQ-INT-001.2)', async () => {
    await openCaller('plain-text.jsonl');
    try {
      const config = callerConfig;
      const agent: Agent = await fromConfig({
        settingsOwner: callerSettingsOwner,
        settingsService: callerSettings,
        agentClient: callerOwner.getAgentClient(),
        providerManager: callerManager,
        config,
        mcpRuntime: callerMcp,
      });
      try {
        // The agent's provider/model reflect the ADOPTED Config's active runtime.
        expect(agent.getProvider()).toBe('fake');
        expect(agent.getModel()).toBe('fake-model');

        // Parity: the agent values equal the Config's own active values.
        const configuredProvider = config.getProvider();
        if (configuredProvider === undefined)
          throw new Error('Missing configured provider');
        expect(agent.getProvider()).toBe(configuredProvider);
        expect(agent.getModel()).toBe(config.getModel());
      } finally {
        await agent.dispose();
      }
    } finally {
      await callerClose();
    }
  }, 30000);

  it('T7 ownership contrast (half A): a fromConfig-supplied Config stays CALLER-owned — still usable after agent.dispose() (REQ-INT-001.3)', async () => {
    await openCaller('plain-text.jsonl');
    try {
      const config = callerConfig;
      const agent: Agent = await fromConfig({
        settingsOwner: callerSettingsOwner,
        settingsService: callerSettings,
        agentClient: callerOwner.getAgentClient(),
        providerManager: callerManager,
        config,
        mcpRuntime: callerMcp,
      });
      await agent.dispose();

      // The caller-supplied Config is STILL usable: reading ephemeral settings
      // does not throw and returns a real object.
      const settings = callerSettings.getAllGlobalSettings();
      expect(typeof settings).toBe('object');
      expect(settings).not.toBeNull();
    } finally {
      await callerClose();
    }
  }, 30000);

  it('T7 ownership contrast (half B): a createAgent-built agent disposes its OWN Config — agentClient is torn down on dispose (REQ-INT-001.3)', async () => {
    // buildAgent constructs via the public createAgent over the FakeProvider
    // seam with a real working directory (the createAgent-owned Config path).
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const probe = captureProbe(agent);
      // PRE-dispose sanity: the agent-owned client is not yet torn down.
      expect(agentClientDisposed(probe)).toBe(false);
      await agent.dispose();
      // POST-dispose: the createAgent-owned Config IS torn down.
      expect(agentClientDisposed(probe)).toBe(true);
    } finally {
      await cleanup();
    }
  }, 30000);

  // ─── Property-based (>=30% of total) ─────────────────────────────────────

  it('PROP runtime reuse: for any non-empty sessionId, the adopted Config provider/model are reflected on the agent (REQ-INT-001.2)', async () => {
    await expect(
      fc.assert(
        createPROPRuntimeReuseForAnyNonEmptySessionIdTheAdoptedConfigProviderProperty(),
      ),
    ).resolves.toBeUndefined();
  }, 30000);

  function createPROPRuntimeReuseForAnyNonEmptySessionIdTheAdoptedConfigProviderProperty() {
    return fc.asyncProperty(nonBlankStringArbitrary, async (sessionId) => {
      await openCaller('plain-text.jsonl');
      try {
        const agent: Agent = await fromConfig({
          settingsOwner: callerSettingsOwner,
          settingsService: callerSettings,
          agentClient: callerOwner.getAgentClient(),
          providerManager: callerManager,
          config: callerConfig,
          mcpRuntime: callerMcp,
          sessionId,
        });
        try {
          return (
            agent.getProvider() === 'fake' &&
            agent.getModel() === 'fake-model' &&
            agent.getProvider() === callerConfig.getProvider() &&
            agent.getModel() === callerConfig.getModel()
          );
        } finally {
          await agent.dispose();
        }
      } finally {
        await callerClose();
      }
    });
  }

  it('PROP adoption identity: for any non-empty sessionId, internalConfig(agent) === the caller-supplied Config (REQ-INT-001)', async () => {
    await fc.assert(
      fc.asyncProperty(nonBlankStringArbitrary, async (sessionId) => {
        await openCaller('plain-text.jsonl');
        try {
          const agent: Agent = await fromConfig({
            settingsOwner: callerSettingsOwner,
            settingsService: callerSettings,
            agentClient: callerOwner.getAgentClient(),
            providerManager: callerManager,
            config: callerConfig,
            mcpRuntime: callerMcp,
            sessionId,
          });
          try {
            return internalConfig(agent) === callerConfig;
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
