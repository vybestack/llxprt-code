import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
  preparePreferredProviderCompletion,
} from '../preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../adoption-release.js';
import { randomUUID } from 'node:crypto';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../core/subagent-cleanup.js';
import { SessionClientOwner } from '../../session/session-client-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../confirmationForcing.js';
import { executeProviderActivation } from '../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';
import { assembleModelSelection } from '../model-selection.js';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import { internalConfig } from './helpers/agentHarness.js';
import * as fc from 'fast-check';

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260621-COREAPIREMED.P11
 * @requirement:REQ-002,REQ-INT-003
 *
 * Behavioral RED suite for the Agent settings/config surface. The ephemeral
 * settings methods on AgentImpl are stubs until P12, so the ephemeral tests
 * fail at RED because the stub raises NotYetImplemented before any Config
 * value is read or written. These are genuine forward behavioral assertions
 * (real Config values, identities, error propagation), not assertions about
 * the stub error itself, and contain no mock theater.
 *
 * The system under test is a REAL Config (via the canonical buildCliStyleConfig
 * helper) wrapped by a REAL Agent (via fromConfig). The suite asserts that the
 * Agent delegates to the SAME Config instance — no parallel store, no
 * re-normalization, no error swallowing — by comparing every observable value
 * against the bound Config directly.
 */

const dangerousPathSegments = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

function isInertSettingKey(key: string): boolean {
  return (
    key !== 'streaming' &&
    key.split('.').every((segment) => !dangerousPathSegments.has(segment))
  );
}

describe('agent settings surface @plan:PLAN-20260621-COREAPIREMED.P11 @requirement:REQ-002 @requirement:REQ-INT-003', () => {
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'engine-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });

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
  let callerRelease: AcquisitionRelease;
  let callerFiles: ProviderFileLifecycle;
  let callerRuntimeId: string;
  let callerOAuth: ReturnType<typeof acquirePreferredOAuth>;
  let callerTokenizer: ReturnType<
    typeof configureProviderRuntimeFactories
  >['tokenizerFactory'];
  let callerContent: ReturnType<
    typeof configureProviderRuntimeFactories
  >['contentGeneratorFactory'];

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
    callerPolicy = new RuntimePolicyOwner(callerConfig);
    injectConfirmationForcingPolicy(callerPolicy.session.confirmation);
    callerMcp = await buildTestMcpRuntime(
      callerConfig,
      callerPolicy.session.messageBus,
      {},
      undefined,
      callerPolicy,
    );
    acquireCallerProviders();
    const media = new SessionMediaOwner(
      callerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    callerOwner = await SessionClientOwner.create(
      callerConfig,
      assembleTaskSchemaPolicy(callerSettings),
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
      );
      await callerMcp.initialize();
      await activateCallerClient();
    } catch (primary) {
      await cleanupAfterFailure(primary, callerClose);
    }
  }
  function acquireCallerProviders(): void {
    callerRuntimeId = 'caller-' + randomUUID();
    callerRelease = new AcquisitionRelease();
    callerSettingsOwner = new SessionSettingsOwner(callerSettings);
    callerRelease.acquire('settings', () => callerSettingsOwner.dispose());
    callerSettingsOwner.initializeProviderSelection(
      callerConfig.getProvider(),
      callerConfig.getModel(),
    );
    callerSettingsOwner.bindTelemetry(callerConfig);
    callerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [callerRuntimeId, callerConfig.getSessionId()])
      callerRelease.acquire('files', () =>
        releaseAdoptedFileScope(callerFiles, scope),
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
    const factories = configureProviderRuntimeFactories(
      callerConfig,
      callerManager,
    );
    callerTokenizer = factories.tokenizerFactory;
    callerContent = factories.contentGeneratorFactory;
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

  it('T3 internalConfig(agent) returns the SAME caller-supplied Config instance (identity) @requirement:REQ-002 @scenario:identity @given:a real CLI-style Config wrapped by fromConfig @when:internalConfig(agent) @then:the returned Config is the SAME instance supplied to fromConfig', async () => {
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
      expect(internalConfig(agent)).toBe(callerConfig);
      await agent.dispose();
    } finally {
      await callerClose();
    }
  });

  it('T3b get/set round-trip for context-limit returns the Config-normalized value @requirement:REQ-002 @scenario:round-trip-context-limit @given:a fromConfig agent over a real Config @when:setEphemeralSetting("context-limit", 100000) then getEphemeralSetting("context-limit") @then:the returned value equals built.config.getEphemeralSetting("context-limit") after the same set on the Config', async () => {
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
      agent.setEphemeralSetting('context-limit', 100000);
      const viaAgent = agent.getEphemeralSetting('context-limit');
      callerSettingsOwner.writeUserParameter('context-limit', 100000);
      const viaConfig = callerSettingsOwner.readNamedParameter('context-limit');
      expect(viaAgent).toStrictEqual(viaConfig);
      await agent.dispose();
    } finally {
      await callerClose();
    }
  });

  it('T3b-numeric-string get/set round-trip applies Config normalization (numeric string persists as a number) @requirement:REQ-002 @scenario:round-trip-normalization @given:a fromConfig agent over a real Config @when:setEphemeralSetting("context-limit", "8000") then getEphemeralSetting("context-limit") @then:the returned value is the Config-normalized value (identical to built.config.getEphemeralSetting on the same input)', async () => {
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
      agent.setEphemeralSetting('context-limit', '8000');
      const viaAgent = agent.getEphemeralSetting('context-limit');
      callerSettingsOwner.writeUserParameter('context-limit', '8000');
      const viaConfig = callerSettingsOwner.readNamedParameter('context-limit');
      expect(viaAgent).toStrictEqual(viaConfig);
      await agent.dispose();
    } finally {
      await callerClose();
    }
  });

  it('T3b-streaming get/set round-trip for streaming="disabled" returns the Config-normalized value @requirement:REQ-002 @scenario:round-trip-streaming @given:a fromConfig agent over a real Config @when:setEphemeralSetting("streaming", "disabled") then getEphemeralSetting("streaming") @then:the returned value equals built.config.getEphemeralSetting("streaming") after the same set on the Config', async () => {
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
      agent.setEphemeralSetting('streaming', 'disabled');
      const viaAgent = agent.getEphemeralSetting('streaming');
      callerSettingsOwner.writeUserParameter('streaming', 'disabled');
      const viaConfig = callerSettingsOwner.readNamedParameter('streaming');
      expect(viaAgent).toStrictEqual(viaConfig);
      await agent.dispose();
    } finally {
      await callerClose();
    }
  });

  it('T3b-custom get/set round-trip for a plain custom key returns the stored value (parity with Config) @requirement:REQ-002 @scenario:round-trip-custom @given:a fromConfig agent over a real Config @when:setEphemeralSetting("my-custom-key", "v") then getEphemeralSetting("my-custom-key") @then:the returned value equals built.config.getEphemeralSetting("my-custom-key") after the same set on the Config', async () => {
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
      agent.setEphemeralSetting('my-custom-key', 'v');
      const viaAgent = agent.getEphemeralSetting('my-custom-key');
      callerSettingsOwner.writeUserParameter('my-custom-key', 'v');
      const viaConfig = callerSettingsOwner.readNamedParameter('my-custom-key');
      expect(viaAgent).toStrictEqual(viaConfig);
      await agent.dispose();
    } finally {
      await callerClose();
    }
  });

  it('T3c getEphemeralSettings() deep-equals built.config.getEphemeralSettings() (same normalized global map) @requirement:REQ-002 @scenario:settings-map @given:a fromConfig agent over a real Config @when:agent.getEphemeralSettings() @then:the returned map deep-equals built.config.getEphemeralSettings()', async () => {
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
      agent.setEphemeralSetting('context-limit', 50000);
      agent.setEphemeralSetting('my-custom-key', 'abc');
      const viaAgent = agent.getEphemeralSettings();
      callerSettingsOwner.writeUserParameter('context-limit', 50000);
      callerSettingsOwner.writeUserParameter('my-custom-key', 'abc');
      const viaConfig = callerSettingsOwner.captureNamedParameters();
      expect(viaAgent).toStrictEqual(viaConfig);
      await agent.dispose();
    } finally {
      await callerClose();
    }
  });

  it('T3d setEphemeralSetting("streaming", 123) propagates the Config error (message names "must resolve"), never swallowed @requirement:REQ-002 @scenario:error-propagation @given:a fromConfig agent over a real Config @when:setEphemeralSetting("streaming", 123) @then:the call throws an Error whose message contains "must resolve" (the propagated Config normalization error)', async () => {
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
      expect(() => agent.setEphemeralSetting('streaming', 123)).toThrow(
        /must resolve/,
      );
      await agent.dispose();
    } finally {
      await callerClose();
    }
  });

  it('T3d-object setEphemeralSetting("streaming", <object>) propagates the Config error (message names "must resolve") @requirement:REQ-002 @scenario:error-propagation-object @given:a fromConfig agent over a real Config @when:setEphemeralSetting("streaming", { x: 1 }) @then:the call throws an Error whose message contains "must resolve"', async () => {
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
      expect(() => agent.setEphemeralSetting('streaming', { x: 1 })).toThrow(
        /must resolve/,
      );
      await agent.dispose();
    } finally {
      await callerClose();
    }
  });

  it('T3e-forward a value set directly on the Config is visible via agent.getEphemeralSetting (delegation, not a local cache) @requirement:REQ-002 @scenario:delegation-config-to-agent @given:a fromConfig agent over a real Config @when:built.config.setEphemeralSetting("delegated-key", 42) @then:agent.getEphemeralSetting("delegated-key") equals built.config.getEphemeralSetting("delegated-key")', async () => {
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
      callerSettingsOwner.writeUserParameter('delegated-key', 42);
      expect(agent.getEphemeralSetting('delegated-key')).toStrictEqual(
        callerSettingsOwner.readNamedParameter('delegated-key'),
      );
      await agent.dispose();
    } finally {
      await callerClose();
    }
  });

  it('T3e-reverse a value set via the agent is visible on built.config.getEphemeralSetting (delegation both directions) @requirement:REQ-002 @scenario:delegation-agent-to-config @given:a fromConfig agent over a real Config @when:agent.setEphemeralSetting("reverse-key", "hello") @then:built.config.getEphemeralSetting("reverse-key") equals the value the agent wrote', async () => {
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
      agent.setEphemeralSetting('reverse-key', 'hello');
      expect(
        callerSettingsOwner.readNamedParameter('reverse-key'),
      ).toStrictEqual('hello');
      await agent.dispose();
    } finally {
      await callerClose();
    }
  });

  it('T8 normalization parity: agent.getEphemeralSetting("context-limit") equals built.config.getEphemeralSetting("context-limit") for representative inputs @requirement:REQ-002 @scenario:normalization-parity @given:a fromConfig agent over a real Config @when:both have context-limit set to 250000 @then:agent.getEphemeralSetting("context-limit") strictly equals built.config.getEphemeralSetting("context-limit")', async () => {
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
      agent.setEphemeralSetting('context-limit', 250000);
      callerSettingsOwner.writeUserParameter('context-limit', 250000);
      expect(agent.getEphemeralSetting('context-limit')).toBe(
        callerSettingsOwner.readNamedParameter('context-limit'),
      );
      await agent.dispose();
    } finally {
      await callerClose();
    }
  });

  // ─── Property-based tests (>=30% of total) ──────────────────────────────

  it('PROP-1 for any inert string key + JSON-serializable value (excluding the throwing streaming path), agent get-then-get strictly equals the Config get-then-get after setting the SAME value through the agent @requirement:REQ-002 @scenario:property-round-trip @given:any inert string key and any JSON-serializable value @when:set via the agent then read via the agent AND read the same key directly off the Config @then:agent.getEphemeralSetting(k) strictly equals built.config.getEphemeralSetting(k) for every generated (key, value)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }).filter(isInertSettingKey),
        fc.json(),
        async (key, jsonValue) => {
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
            const value = JSON.parse(jsonValue);
            agent.setEphemeralSetting(key, value);
            const viaAgent = agent.getEphemeralSetting(key);
            const viaConfig = callerSettingsOwner.readNamedParameter(key);
            await agent.dispose();
            return viaAgent === viaConfig;
          } finally {
            await callerClose();
          }
        },
      ),
    );
  });

  it('PROP-2 for any inert string key, after a set through the agent, agent.getEphemeralSettings()[key] strictly equals built.config.getEphemeralSettings()[key] @requirement:REQ-002 @scenario:property-settings-map @given:any inert string key and any JSON-serializable value @when:set via the agent then read both full maps @then:agent.getEphemeralSettings()[key] strictly equals built.config.getEphemeralSettings()[key] for every generated (key, value)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }).filter(isInertSettingKey),
        fc.json(),
        async (key, jsonValue) => {
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
            const value = JSON.parse(jsonValue);
            agent.setEphemeralSetting(key, value);
            const agentMap = agent.getEphemeralSettings();
            const configMap = callerSettingsOwner.captureNamedParameters();
            await agent.dispose();
            return agentMap[key] === configMap[key];
          } finally {
            await callerClose();
          }
        },
      ),
    );
  });

  it('PROP-3 for any numeric context-limit value, agent.getEphemeralSetting("context-limit") equals built.config.getEphemeralSetting("context-limit") (normalization parity) @requirement:REQ-002 @scenario:property-context-limit @given:any finite numeric context-limit value @when:set via the agent then read from both surfaces @then:agent.getEphemeralSetting("context-limit") equals built.config.getEphemeralSetting("context-limit") for every generated value', async () => {
    await fc.assert(
      fc.asyncProperty(fc.nat(), async (limit) => {
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
          agent.setEphemeralSetting('context-limit', limit);
          callerSettingsOwner.writeUserParameter('context-limit', limit);
          const viaAgent = agent.getEphemeralSetting('context-limit');
          const viaConfig =
            callerSettingsOwner.readNamedParameter('context-limit');
          await agent.dispose();
          return viaAgent === viaConfig;
        } finally {
          await callerClose();
        }
      }),
    );
  });

  it('PROP-4 for streaming="enabled", agent.getEphemeralSetting("streaming") equals built.config.getEphemeralSetting("streaming") (both normalize to the same string) @requirement:REQ-002 @scenario:property-streaming-enabled @given:a fromConfig agent over a real Config @when:both set streaming="enabled" @then:agent.getEphemeralSetting("streaming") strictly equals built.config.getEphemeralSetting("streaming") for every generated scenario', async () => {
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
          agent.setEphemeralSetting('streaming', mode);
          callerSettingsOwner.writeUserParameter('streaming', mode);
          const viaAgent = agent.getEphemeralSetting('streaming');
          const viaConfig = callerSettingsOwner.readNamedParameter('streaming');
          await agent.dispose();
          return viaAgent === viaConfig;
        } finally {
          await callerClose();
        }
      }),
    );
  });

  it('PROP-5 for any inert string key, a value set directly on the Config is visible via agent.getEphemeralSetting (no parallel store — the agent reads through to the SAME Config) @requirement:REQ-002 @scenario:property-no-parallel-store @given:any inert string key and any JSON-serializable value written directly on the Config @when:agent.getEphemeralSetting(k) is read @then:it strictly equals built.config.getEphemeralSetting(k) for every generated (key, value)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }).filter(isInertSettingKey),
        fc.json(),
        async (key, jsonValue) => {
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
            const value = JSON.parse(jsonValue);
            callerSettingsOwner.writeUserParameter(key, value);
            const viaAgent = agent.getEphemeralSetting(key);
            const viaConfig = callerSettingsOwner.readNamedParameter(key);
            await agent.dispose();
            return viaAgent === viaConfig;
          } finally {
            await callerClose();
          }
        },
      ),
    );
  });
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
