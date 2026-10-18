import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { McpRuntimeOwner } from '../../../../agents/src/api/mcpRuntimeAssembly.js';
import { toConfigParameters } from '../../../../agents/src/api/agentConfig.adapter.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { useOwnedCredentials } from '../../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
  preparePreferredProviderCompletion,
} from '../../../../agents/src/api/preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../../../../agents/src/api/adoption-release.js';
import { randomUUID } from 'node:crypto';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../../../agents/src/core/subagent-cleanup.js';
import { SessionClientOwner } from '../../../../agents/src/session/session-client-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from '../../../../agents/src/api/__tests__/helpers/mcp-owner-fixture.js';
import { createAgentRuntimeFactoryBindings } from '../../../../agents/src/api/runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../../../../agents/src/api/confirmationForcing.js';
import { executeProviderActivation } from '../../../../agents/src/api/providerActivationExecutor.js';
import { assembleProviderSwitch } from '../../../../agents/src/api/providerSwitchAssembly.js';
import { assembleModelSelection } from '../../../../agents/src/api/model-selection.js';
import {
  fromConfig,
  SessionProviderReads,
} from '@vybestack/llxprt-code-agents';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

describe('interactive runtime owner admission', () => {
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

  const firstCredentials = useOwnedCredentials();
  let firstCallerConfig: Config;
  let firstCallerSettings: SettingsService;
  let firstCallerSettingsOwner: SessionSettingsOwner;
  let firstCallerPolicy: RuntimePolicyOwner;
  let firstCallerMcp: McpRuntimeOwner;
  let firstCallerManager: ReturnType<typeof acquirePreferredProviderManager>;
  let firstCallerOwner: SessionClientOwner;
  let firstCallerClose: () => Promise<void>;
  const firstCallerFactories = createAgentRuntimeFactoryBindings();
  let firstCallerRelease: AcquisitionRelease;
  let firstCallerFiles: ProviderFileLifecycle;
  let firstCallerRuntimeId: string;
  let firstCallerOAuth: ReturnType<typeof acquirePreferredOAuth>;
  let firstCallerTokenizer: ReturnType<typeof configureProviderTokenizer>;
  let firstCallerContent: ReturnType<
    typeof createRuntimeContentGeneratorFactory
  >;

  async function openfirstCaller(fixture: string): Promise<void> {
    const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL(
        '../../../../agents/src/api/__tests__/fixtures/' + fixture,
        import.meta.url,
      ),
    );
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'firstCaller-adoption-')),
    );
    firstCallerConfig = new Config({
      ...toConfigParameters({
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        workingDir: directory,
      }),
      interactive: true,
      includeDirectories: [process.cwd()],
    });
    firstCallerSettings = new SettingsService();
    firstCallerPolicy = new RuntimePolicyOwner(firstCallerConfig);
    injectConfirmationForcingPolicy(firstCallerPolicy.session.confirmation);
    firstCallerMcp = await buildTestMcpRuntime(
      firstCallerConfig,
      firstCallerPolicy.session.messageBus,
      {},
      undefined,
      firstCallerPolicy,
    );
    acquirefirstCallerProviders();
    const media = new SessionMediaOwner(
      firstCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    firstCallerOwner = await SessionClientOwner.create(
      firstCallerConfig,
      assembleTaskSchemaPolicy(firstCallerSettings),
      firstCallerManager,
      firstCallerFactories.agentClientFactory,
      media.store,
      firstCallerMcp.readInstructions,
      firstCallerMcp.workspacePaths,
      firstCallerSettingsOwner,
      firstCallerContent,
      firstCallerTokenizer,
    );
    firstCallerOwner.bindMcpRuntime(firstCallerMcp);
    firstCallerOwner.bindProviderFiles(firstCallerFiles, (provider) =>
      firstCallerOAuth.composeRetryOperations(provider),
    );
    firstCallerOwner.bindHooks();
    firstCallerClose = settleEngineRelease.bind(
      undefined,
      [
        () => firstCallerOwner.dispose(),
        () => firstCallerRelease.close(),
        () => media.dispose(),
        () => firstCallerMcp.dispose(),
        () => firstCallerConfig.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ],
      previousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        firstCallerConfig,
        firstCallerSettings,
        firstCallerSettingsOwner,
        firstCallerManager,
        firstCallerOAuth,
        firstCallerRuntimeId,
        firstCallerTokenizer,
        undefined,
      );
      await firstCallerMcp.initialize();
      await activatefirstCallerClient();
    } catch (primary) {
      await cleanupAfterFailure(primary, firstCallerClose);
    }
  }
  function acquirefirstCallerProviders(): void {
    firstCallerRuntimeId = 'firstCaller-' + randomUUID();
    firstCallerRelease = new AcquisitionRelease();
    firstCallerSettingsOwner = new SessionSettingsOwner(firstCallerSettings);
    firstCallerRelease.acquire('settings', () =>
      firstCallerSettingsOwner.dispose(),
    );
    firstCallerSettingsOwner.initializeProviderSelection(
      firstCallerConfig.getProvider(),
      firstCallerConfig.getModel(),
    );
    firstCallerSettingsOwner.bindTelemetry(firstCallerConfig);
    firstCallerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [
      firstCallerRuntimeId,
      firstCallerConfig.getSessionId(),
    ])
      firstCallerRelease.acquire('files', () =>
        releaseAdoptedFileScope(firstCallerFiles, scope),
      );
    firstCallerManager = acquirePreferredProviderManager(
      firstCallerConfig,
      firstCallerSettings,
      firstCallerSettingsOwner,
      firstCallerFiles,
      firstCallerRuntimeId,
      firstCredentials().authority,
      firstCallerRelease,
    );
    const factoriesTokenizer = configureProviderTokenizer(firstCallerManager);
    const factoriesContent = createRuntimeContentGeneratorFactory();
    firstCallerTokenizer = factoriesTokenizer;
    firstCallerContent = factoriesContent;
    firstCallerOAuth = acquirePreferredOAuth(
      undefined,
      firstCallerPolicy.session.messageBus,
      firstCallerConfig,
      firstCallerSettings,
      firstCallerManager,
      firstCallerRuntimeId,
      firstCallerMcp.profileDefinitions,
      firstCredentials().authority,
      firstCallerRelease,
      undefined,
    );
  }
  async function activatefirstCallerClient(): Promise<void> {
    const activation = await executeProviderActivation(
      firstCallerConfig,
      {
        provider: firstCallerConfig.getProvider(),
        model: firstCallerConfig.getModel(),
      },
      assembleProviderSwitch(
        firstCallerConfig,
        firstCallerSettings,
        firstCallerManager,
        firstCallerOAuth,
        () => 'agent',
        () => firstCallerOwner.refreshAuth(),
        firstCallerSettingsOwner,
      ),
      firstCallerSettings,
      firstCallerManager,
      (method) => firstCallerOwner.refreshAuth(method),
      assembleModelSelection(firstCallerSettingsOwner),
    );
    requireCallerActivation(activation);
    await firstCallerOwner.initializeTools();
    await firstCallerOwner.getAgentClient().startChat();
  }

  const secondCredentials = useOwnedCredentials();
  let secondCallerConfig: Config;
  let secondCallerSettings: SettingsService;
  let secondCallerSettingsOwner: SessionSettingsOwner;
  let secondCallerPolicy: RuntimePolicyOwner;
  let secondCallerMcp: McpRuntimeOwner;
  let secondCallerManager: ReturnType<typeof acquirePreferredProviderManager>;
  let secondCallerOwner: SessionClientOwner;
  let secondCallerClose: () => Promise<void>;
  const secondCallerFactories = createAgentRuntimeFactoryBindings();
  let secondCallerRelease: AcquisitionRelease;
  let secondCallerFiles: ProviderFileLifecycle;
  let secondCallerRuntimeId: string;
  let secondCallerOAuth: ReturnType<typeof acquirePreferredOAuth>;
  let secondCallerTokenizer: ReturnType<typeof configureProviderTokenizer>;
  let secondCallerContent: ReturnType<
    typeof createRuntimeContentGeneratorFactory
  >;

  async function opensecondCaller(fixture: string): Promise<void> {
    const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL(
        '../../../../agents/src/api/__tests__/fixtures/' + fixture,
        import.meta.url,
      ),
    );
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'secondCaller-adoption-')),
    );
    secondCallerConfig = new Config({
      ...toConfigParameters({
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        workingDir: directory,
      }),
      interactive: true,
      includeDirectories: [process.cwd()],
    });
    secondCallerSettings = new SettingsService();
    secondCallerPolicy = new RuntimePolicyOwner(secondCallerConfig);
    injectConfirmationForcingPolicy(secondCallerPolicy.session.confirmation);
    secondCallerMcp = await buildTestMcpRuntime(
      secondCallerConfig,
      secondCallerPolicy.session.messageBus,
      {},
      undefined,
      secondCallerPolicy,
    );
    acquiresecondCallerProviders();
    const media = new SessionMediaOwner(
      secondCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    secondCallerOwner = await SessionClientOwner.create(
      secondCallerConfig,
      assembleTaskSchemaPolicy(secondCallerSettings),
      secondCallerManager,
      secondCallerFactories.agentClientFactory,
      media.store,
      secondCallerMcp.readInstructions,
      secondCallerMcp.workspacePaths,
      secondCallerSettingsOwner,
      secondCallerContent,
      secondCallerTokenizer,
    );
    secondCallerOwner.bindMcpRuntime(secondCallerMcp);
    secondCallerOwner.bindProviderFiles(secondCallerFiles, (provider) =>
      secondCallerOAuth.composeRetryOperations(provider),
    );
    secondCallerOwner.bindHooks();
    secondCallerClose = settleEngineRelease.bind(
      undefined,
      [
        () => secondCallerOwner.dispose(),
        () => secondCallerRelease.close(),
        () => media.dispose(),
        () => secondCallerMcp.dispose(),
        () => secondCallerConfig.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ],
      previousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        secondCallerConfig,
        secondCallerSettings,
        secondCallerSettingsOwner,
        secondCallerManager,
        secondCallerOAuth,
        secondCallerRuntimeId,
        secondCallerTokenizer,
        undefined,
      );
      await secondCallerMcp.initialize();
      await activatesecondCallerClient();
    } catch (primary) {
      await cleanupAfterFailure(primary, secondCallerClose);
    }
  }
  function acquiresecondCallerProviders(): void {
    secondCallerRuntimeId = 'secondCaller-' + randomUUID();
    secondCallerRelease = new AcquisitionRelease();
    secondCallerSettingsOwner = new SessionSettingsOwner(secondCallerSettings);
    secondCallerRelease.acquire('settings', () =>
      secondCallerSettingsOwner.dispose(),
    );
    secondCallerSettingsOwner.initializeProviderSelection(
      secondCallerConfig.getProvider(),
      secondCallerConfig.getModel(),
    );
    secondCallerSettingsOwner.bindTelemetry(secondCallerConfig);
    secondCallerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [
      secondCallerRuntimeId,
      secondCallerConfig.getSessionId(),
    ])
      secondCallerRelease.acquire('files', () =>
        releaseAdoptedFileScope(secondCallerFiles, scope),
      );
    secondCallerManager = acquirePreferredProviderManager(
      secondCallerConfig,
      secondCallerSettings,
      secondCallerSettingsOwner,
      secondCallerFiles,
      secondCallerRuntimeId,
      secondCredentials().authority,
      secondCallerRelease,
    );
    const factoriesTokenizer = configureProviderTokenizer(secondCallerManager);
    const factoriesContent = createRuntimeContentGeneratorFactory();
    secondCallerTokenizer = factoriesTokenizer;
    secondCallerContent = factoriesContent;
    secondCallerOAuth = acquirePreferredOAuth(
      undefined,
      secondCallerPolicy.session.messageBus,
      secondCallerConfig,
      secondCallerSettings,
      secondCallerManager,
      secondCallerRuntimeId,
      secondCallerMcp.profileDefinitions,
      secondCredentials().authority,
      secondCallerRelease,
      undefined,
    );
  }
  async function activatesecondCallerClient(): Promise<void> {
    const activation = await executeProviderActivation(
      secondCallerConfig,
      {
        provider: secondCallerConfig.getProvider(),
        model: secondCallerConfig.getModel(),
      },
      assembleProviderSwitch(
        secondCallerConfig,
        secondCallerSettings,
        secondCallerManager,
        secondCallerOAuth,
        () => 'agent',
        () => secondCallerOwner.refreshAuth(),
        secondCallerSettingsOwner,
      ),
      secondCallerSettings,
      secondCallerManager,
      (method) => secondCallerOwner.refreshAuth(method),
      assembleModelSelection(secondCallerSettingsOwner),
    );
    requireCallerActivation(activation);
    await secondCallerOwner.initializeTools();
    await secondCallerOwner.getAgentClient().startChat();
  }

  it('rejects ownerless service reads while two same-label Agents are active', async () => {
    await openfirstCaller('multi-turn-text.jsonl');
    await opensecondCaller('multi-turn-text.jsonl');
    const a = await fromConfig(
      firstCallerConfig,
      firstCallerSettings,
      { sessionId: 'shared-service-label' },
      firstCallerSettingsOwner,
      firstCallerManager,
      undefined,
      firstCallerPolicy.session.messageBus,
      firstCallerMcp,
    );
    const b = await fromConfig(
      secondCallerConfig,
      secondCallerSettings,
      { sessionId: 'shared-service-label' },
      secondCallerSettingsOwner,
      secondCallerManager,
      undefined,
      secondCallerPolicy.session.messageBus,
      secondCallerMcp,
    );
    try {
      const missingOwner = (): unknown =>
        Reflect.construct(SessionProviderReads, []);
      expect(missingOwner).toThrow(
        'Provider reads require an explicit session owner',
      );
      expect(firstCallerManager).not.toBe(secondCallerManager);
    } finally {
      await a.dispose();
      await b.dispose();
      await firstCallerConfig.dispose();
      await secondCallerConfig.dispose();
      await firstCallerClose();
      await secondCallerClose();
    }
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
