import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { McpRuntimeOwner } from '../../agents/src/api/mcpRuntimeAssembly.js';
import { toConfigParameters } from '../../agents/src/api/agentConfig.adapter.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { useOwnedCredentials } from '../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
  preparePreferredProviderCompletion,
} from '../../agents/src/api/preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../../agents/src/api/adoption-release.js';
import { randomUUID } from 'node:crypto';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../agents/src/core/subagent-cleanup.js';
import { SessionClientOwner } from '../../agents/src/session/session-client-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from '../../agents/src/api/__tests__/helpers/mcp-owner-fixture.js';
import { createAgentRuntimeFactoryBindings } from '../../agents/src/api/runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../../agents/src/api/confirmationForcing.js';
import { executeProviderActivation } from '../../agents/src/api/providerActivationExecutor.js';
import { assembleProviderSwitch } from '../../agents/src/api/providerSwitchAssembly.js';
import { assembleModelSelection } from '../../agents/src/api/model-selection.js';
import {
  buildZedConfigOptions,
  setZedConfigOption,
} from './zed-config-options.js';
import { fromConfig } from '@vybestack/llxprt-code-agents';
import { projectZedSessionAgent } from './zed-session-ports.js';
import { resolveZedContextWindowSize } from './zed-helpers.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

describe('ACP model selection without provider-manager authority', () => {
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

  const ownerCredentials = useOwnedCredentials();
  let ownerCallerConfig: Config;
  let ownerCallerSettings: SettingsService;
  let ownerCallerSettingsOwner: SessionSettingsOwner;
  let ownerCallerPolicy: RuntimePolicyOwner;
  let ownerCallerMcp: McpRuntimeOwner;
  let ownerCallerManager: ReturnType<typeof acquirePreferredProviderManager>;
  let ownerCallerOwner: SessionClientOwner;
  let ownerCallerClose: () => Promise<void>;
  const ownerCallerFactories = createAgentRuntimeFactoryBindings();
  let ownerCallerRelease: AcquisitionRelease;
  let ownerCallerFiles: ProviderFileLifecycle;
  let ownerCallerRuntimeId: string;
  let ownerCallerOAuth: ReturnType<typeof acquirePreferredOAuth>;
  let ownerCallerTokenizer: ReturnType<
    typeof configureProviderRuntimeFactories
  >['tokenizerFactory'];
  let ownerCallerContent: ReturnType<
    typeof configureProviderRuntimeFactories
  >['contentGeneratorFactory'];

  async function openownerCaller(fixture: string): Promise<void> {
    const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL(
        '../../agents/src/api/__tests__/fixtures/' + fixture,
        import.meta.url,
      ),
    );
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'ownerCaller-adoption-')),
    );
    ownerCallerConfig = new Config({
      ...toConfigParameters({
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        workingDir: directory,
      }),
      interactive: true,
      includeDirectories: [process.cwd()],
    });
    ownerCallerSettings = new SettingsService();
    ownerCallerPolicy = new RuntimePolicyOwner(ownerCallerConfig);
    injectConfirmationForcingPolicy(ownerCallerPolicy.session.confirmation);
    ownerCallerMcp = await buildTestMcpRuntime(
      ownerCallerConfig,
      ownerCallerPolicy.session.messageBus,
      {},
      undefined,
      ownerCallerPolicy,
    );
    acquireownerCallerProviders();
    const media = new SessionMediaOwner(
      ownerCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    ownerCallerOwner = await SessionClientOwner.create(
      ownerCallerConfig,
      assembleTaskSchemaPolicy(ownerCallerSettings),
      ownerCallerManager,
      ownerCallerFactories.agentClientFactory,
      media.store,
      ownerCallerMcp.readInstructions,
      ownerCallerMcp.workspacePaths,
      ownerCallerSettingsOwner,
      ownerCallerContent,
      ownerCallerTokenizer,
    );
    ownerCallerOwner.bindMcpRuntime(ownerCallerMcp);
    ownerCallerOwner.bindProviderFiles(ownerCallerFiles, (provider) =>
      ownerCallerOAuth.composeRetryOperations(provider),
    );
    ownerCallerOwner.bindHooks();
    ownerCallerClose = settleEngineRelease.bind(
      undefined,
      [
        () => ownerCallerOwner.dispose(),
        () => ownerCallerRelease.close(),
        () => media.dispose(),
        () => ownerCallerMcp.dispose(),
        () => ownerCallerConfig.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ],
      previousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        ownerCallerConfig,
        ownerCallerSettings,
        ownerCallerSettingsOwner,
        ownerCallerManager,
        ownerCallerOAuth,
        ownerCallerRuntimeId,
        ownerCallerTokenizer,
      );
      await ownerCallerMcp.initialize();
      await activateownerCallerClient();
    } catch (primary) {
      await cleanupAfterFailure(primary, ownerCallerClose);
    }
  }
  function acquireownerCallerProviders(): void {
    ownerCallerRuntimeId = 'ownerCaller-' + randomUUID();
    ownerCallerRelease = new AcquisitionRelease();
    ownerCallerSettingsOwner = new SessionSettingsOwner(ownerCallerSettings);
    ownerCallerRelease.acquire('settings', () =>
      ownerCallerSettingsOwner.dispose(),
    );
    ownerCallerSettingsOwner.initializeProviderSelection(
      ownerCallerConfig.getProvider(),
      ownerCallerConfig.getModel(),
    );
    ownerCallerSettingsOwner.bindTelemetry(ownerCallerConfig);
    ownerCallerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [
      ownerCallerRuntimeId,
      ownerCallerConfig.getSessionId(),
    ])
      ownerCallerRelease.acquire('files', () =>
        releaseAdoptedFileScope(ownerCallerFiles, scope),
      );
    ownerCallerManager = acquirePreferredProviderManager(
      ownerCallerConfig,
      ownerCallerSettings,
      ownerCallerSettingsOwner,
      ownerCallerFiles,
      ownerCallerRuntimeId,
      ownerCredentials().authority,
      ownerCallerRelease,
    );
    const factories = configureProviderRuntimeFactories(
      ownerCallerConfig,
      ownerCallerManager,
    );
    ownerCallerTokenizer = factories.tokenizerFactory;
    ownerCallerContent = factories.contentGeneratorFactory;
    ownerCallerOAuth = acquirePreferredOAuth(
      undefined,
      ownerCallerPolicy.session.messageBus,
      ownerCallerConfig,
      ownerCallerSettings,
      ownerCallerManager,
      ownerCallerRuntimeId,
      ownerCallerMcp.profileDefinitions,
      ownerCredentials().authority,
      ownerCallerRelease,
    );
  }
  async function activateownerCallerClient(): Promise<void> {
    const activation = await executeProviderActivation(
      ownerCallerConfig,
      {
        provider: ownerCallerConfig.getProvider(),
        model: ownerCallerConfig.getModel(),
      },
      assembleProviderSwitch(
        ownerCallerConfig,
        ownerCallerSettings,
        ownerCallerManager,
        ownerCallerOAuth,
        () => 'agent',
        () => ownerCallerOwner.refreshAuth(),
        ownerCallerSettingsOwner,
      ),
      ownerCallerSettings,
      ownerCallerManager,
      (method) => ownerCallerOwner.refreshAuth(method),
      assembleModelSelection(ownerCallerSettingsOwner),
    );
    requireCallerActivation(activation);
    await ownerCallerOwner.initializeTools();
    await ownerCallerOwner.getAgentClient().startChat();
  }

  it('re-queries live models after switching and retains the current model outside the catalogue', async () => {
    let model = 'retained';
    const settings = {
      getEphemeralSetting: () => undefined,
      setEphemeralSetting: () => undefined,
    };
    const models = {
      getModel: () => model,
      listAvailableModels: async () =>
        ['first', 'second'].map((id) => ({
          id,
          name: id.toUpperCase(),
          provider: 'local',
        })),
      setModel: async (next: string) => {
        model = next;
      },
    };
    const initial = await buildZedConfigOptions(models, settings);
    expect(initial[0]).toMatchObject({
      id: 'model',
      currentValue: 'retained',
      options: [
        { value: 'retained', name: 'retained' },
        { value: 'first', name: 'FIRST' },
        { value: 'second', name: 'SECOND' },
      ],
    });
    const updated = await setZedConfigOption(
      models,
      settings,
      'model',
      'second',
    );
    expect(updated.configOptions[0]).toMatchObject({
      currentValue: 'second',
      options: [
        { value: 'first', name: 'FIRST' },
        { value: 'second', name: 'SECOND' },
      ],
    });
    await expect(
      setZedConfigOption(models, settings, 'model', 'unavailable'),
    ).rejects.toMatchObject({ code: -32602 });
  });
  it('retains public Agent model queries and provider responses while usage reads stay live', async () => {
    await openownerCaller('plain-text.jsonl');
    const agent = await fromConfig({
      settingsService: ownerCallerSettings,
      config: ownerCallerConfig,
      providerManager: ownerCallerManager,
      messageBus: ownerCallerPolicy.session.messageBus,
      mcpRuntime: ownerCallerMcp,
    });
    try {
      const port = projectZedSessionAgent(agent);
      expect(
        ['providerManager', 'agentClient', 'sessionClient'].filter(
          (key) => key in port,
        ),
      ).toStrictEqual([]);
      const provider = ownerCallerManager.getActiveProvider();
      if (!provider) throw new Error('Expected an activated provider');
      let limit = 8192;
      provider.getContextLimit = () => limit;
      const modelReads = {
        getModel: () => port.getModel(),
        listAvailableModels: () => port.listAvailableModels(),
      };
      const settings = {
        getModel: () => port.getModel(),
        getEphemeralSetting: (key: string) => agent.getEphemeralSetting(key),
        setEphemeralSetting: (key: string, value: unknown) =>
          agent.setEphemeralSetting(key, value),
      };
      await agent.setModel('retained-model');
      const options = await buildZedConfigOptions(modelReads, settings);
      expect(options[0]).toMatchObject({
        id: 'model',
        currentValue: 'retained-model',
      });
      const firstLimit = resolveZedContextWindowSize(settings, () =>
        port.getProviderContextLimit(),
      );
      limit *= 2;
      expect(
        resolveZedContextWindowSize(settings, () =>
          port.getProviderContextLimit(),
        ),
      ).toBe(firstLimit * 2);
      const response = await agent.chat('Retain the ACP provider response');
      expect(response.text).toContain('a plain text reply');
    } finally {
      await agent.dispose();
      await ownerCallerClose();
    }
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
