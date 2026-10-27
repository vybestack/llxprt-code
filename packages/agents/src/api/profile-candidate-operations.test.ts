import {
  createCapturedSessionOwner,
  ownerClients,
} from './__tests__/helpers/session-client-capture.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService, Profile } from '@vybestack/llxprt-code-settings';
import { McpRuntimeOwner } from './mcpRuntimeAssembly.js';
import { toConfigParameters } from './agentConfig.adapter.js';
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
import { useOwnedCredentials } from './__tests__/helpers/owned-credential-fixture.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
  preparePreferredProviderCompletion,
} from './preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from './adoption-release.js';
import { randomUUID } from 'node:crypto';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../core/subagent-cleanup.js';
import { SessionClientOwner } from '../session/session-client-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from './__tests__/helpers/mcp-owner-fixture.js';
import { buildAgentClientFactory } from './agentBootstrap.js';
import { injectConfirmationForcingPolicy } from './confirmationForcing.js';
import { executeProviderActivation } from './providerActivationExecutor.js';
import { assembleProviderSwitch } from './providerSwitchAssembly.js';
import { assembleModelSelection } from './model-selection.js';
import { AgentConfig } from './config-types.js';
import { applyProfileCascade } from './profileApplication.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

describe('profile candidate operations', () => {
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
  const secondCredentials = useOwnedCredentials();

  it('holds named-key preparation without changing either root and leaves its sibling usable after failure', async () => {
    const firstCallerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('__tests__/fixtures/' + 'plain-text.jsonl', import.meta.url),
    );
    const firstCallerDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-caller-')),
    );
    const firstCallerOverrides: Readonly<Partial<AgentConfig>> = {
      model: 'first',
      sessionId: 'same-label',
    };
    const firstCallerSelection: AgentConfig = {
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      ...firstCallerOverrides,
      workingDir: firstCallerDirectory,
    };
    const firstCallerParameters = {
      ...toConfigParameters(firstCallerSelection),
      ...{},
    };
    firstCallerParameters.interactive = true;

    firstCallerParameters.includeDirectories = [
      ...(firstCallerParameters.includeDirectories ?? []),
      process.cwd(),
    ];
    const firstCallerConfig = new Config(firstCallerParameters);
    const firstCallerSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      firstCallerConfig.getInitialSettings(),
    ))
      firstCallerSettings.set(key, value);
    const firstCallerPolicy = new RuntimePolicyOwner(firstCallerConfig);
    injectConfirmationForcingPolicy(firstCallerPolicy.session.confirmation);
    const firstCallerMcp = await buildTestMcpRuntime(
      firstCallerConfig,
      firstCallerPolicy.session.messageBus,
      firstCallerOverrides,
      undefined,
      firstCallerPolicy,
      undefined,
    );
    const firstCallerRuntimeId = 'caller-' + randomUUID();
    const firstCallerRelease = new AcquisitionRelease();
    const firstCallerSettingsOwner = new SessionSettingsOwner(
      firstCallerSettings,
    );
    firstCallerRelease.acquire('settings', () =>
      firstCallerSettingsOwner.dispose(),
    );
    firstCallerSettingsOwner.initializeProviderSelection(
      firstCallerConfig.getProvider(),
      firstCallerConfig.getModel(),
    );
    firstCallerSettingsOwner.bindTelemetry(firstCallerConfig);
    const firstCallerFiles = new ProviderFileLifecycle({
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
    const firstCallerManager = acquirePreferredProviderManager(
      firstCallerConfig,
      firstCallerSettings,
      firstCallerSettingsOwner,
      firstCallerFiles,
      firstCallerRuntimeId,
      firstCredentials().authority,
      firstCallerRelease,
    );
    const firstCallerTokenizer = configureProviderTokenizer(firstCallerManager);
    const firstCallerContent = createRuntimeContentGeneratorFactory();
    const firstCallerOAuth = acquirePreferredOAuth(
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
    const firstCallerMedia = new SessionMediaOwner(
      firstCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    const firstCallerOwner = await createCapturedSessionOwner(
      firstCallerConfig,
      assembleTaskSchemaPolicy(firstCallerSettings),
      firstCallerManager,
      buildAgentClientFactory(),
      firstCallerMedia.store,
      firstCallerMcp.readInstructions,
      firstCallerMcp.workspacePaths,
      firstCallerSettingsOwner,
      firstCallerContent,
      firstCallerTokenizer,
    );
    firstCallerOwner.bindMcpRuntime(firstCallerMcp);
    firstCallerOwner.clients.bindProviderFiles(firstCallerFiles, (provider) =>
      firstCallerOAuth.composeRetryOperations(provider),
    );
    firstCallerOwner.bindHooks();
    const firstCallerClose = settleEngineRelease.bind(
      undefined,
      [
        () => firstCallerOwner.dispose(),
        () => firstCallerRelease.close(),
        () => firstCallerMedia.dispose(),
        () => firstCallerMcp.dispose(),
        () => firstCallerConfig.dispose(),
        () => rm(firstCallerDirectory, { recursive: true, force: true }),
      ],
      firstCallerPreviousReplay,
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
      const activation = await executeProviderActivation(
        firstCallerConfig,
        firstCallerSelection.activation ?? {
          provider: firstCallerConfig.getProvider(),
          model: firstCallerConfig.getModel(),
        },
        assembleProviderSwitch(
          firstCallerConfig,
          firstCallerSettings,
          firstCallerManager,
          firstCallerOAuth,
          () => 'agent',
          () => firstCallerOwner.clients.refreshAuth(),
          firstCallerSettingsOwner,
        ),
        firstCallerSettings,
        firstCallerManager,
        (method) => firstCallerOwner.clients.refreshAuth(method),
        assembleModelSelection(firstCallerSettingsOwner),
      );
      requireCallerActivation(activation);
      await firstCallerOwner.initializeTools();
      await ownerClients(firstCallerOwner)[1].startChat();
    } catch (primary) {
      await cleanupAfterFailure(primary, firstCallerClose);
    }

    const secondCallerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('__tests__/fixtures/' + 'plain-text.jsonl', import.meta.url),
    );
    const secondCallerDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-caller-')),
    );
    const secondCallerOverrides: Readonly<Partial<AgentConfig>> = {
      model: 'second',
      sessionId: 'same-label',
    };
    const secondCallerSelection: AgentConfig = {
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      ...secondCallerOverrides,
      workingDir: secondCallerDirectory,
    };
    const secondCallerParameters = {
      ...toConfigParameters(secondCallerSelection),
      ...{},
    };
    secondCallerParameters.interactive = true;

    secondCallerParameters.includeDirectories = [
      ...(secondCallerParameters.includeDirectories ?? []),
      process.cwd(),
    ];
    const secondCallerConfig = new Config(secondCallerParameters);
    const secondCallerSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      secondCallerConfig.getInitialSettings(),
    ))
      secondCallerSettings.set(key, value);
    const secondCallerPolicy = new RuntimePolicyOwner(secondCallerConfig);
    injectConfirmationForcingPolicy(secondCallerPolicy.session.confirmation);
    const secondCallerMcp = await buildTestMcpRuntime(
      secondCallerConfig,
      secondCallerPolicy.session.messageBus,
      secondCallerOverrides,
      undefined,
      secondCallerPolicy,
      undefined,
    );
    const secondCallerRuntimeId = 'caller-' + randomUUID();
    const secondCallerRelease = new AcquisitionRelease();
    const secondCallerSettingsOwner = new SessionSettingsOwner(
      secondCallerSettings,
    );
    secondCallerRelease.acquire('settings', () =>
      secondCallerSettingsOwner.dispose(),
    );
    secondCallerSettingsOwner.initializeProviderSelection(
      secondCallerConfig.getProvider(),
      secondCallerConfig.getModel(),
    );
    secondCallerSettingsOwner.bindTelemetry(secondCallerConfig);
    const secondCallerFiles = new ProviderFileLifecycle({
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
    const secondCallerManager = acquirePreferredProviderManager(
      secondCallerConfig,
      secondCallerSettings,
      secondCallerSettingsOwner,
      secondCallerFiles,
      secondCallerRuntimeId,
      secondCredentials().authority,
      secondCallerRelease,
    );
    const secondCallerTokenizer =
      configureProviderTokenizer(secondCallerManager);
    const secondCallerContent = createRuntimeContentGeneratorFactory();
    const secondCallerOAuth = acquirePreferredOAuth(
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
    const secondCallerMedia = new SessionMediaOwner(
      secondCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    const secondCallerOwner = await createCapturedSessionOwner(
      secondCallerConfig,
      assembleTaskSchemaPolicy(secondCallerSettings),
      secondCallerManager,
      buildAgentClientFactory(),
      secondCallerMedia.store,
      secondCallerMcp.readInstructions,
      secondCallerMcp.workspacePaths,
      secondCallerSettingsOwner,
      secondCallerContent,
      secondCallerTokenizer,
    );
    secondCallerOwner.bindMcpRuntime(secondCallerMcp);
    secondCallerOwner.clients.bindProviderFiles(secondCallerFiles, (provider) =>
      secondCallerOAuth.composeRetryOperations(provider),
    );
    secondCallerOwner.bindHooks();
    const secondCallerClose = settleEngineRelease.bind(
      undefined,
      [
        () => secondCallerOwner.dispose(),
        () => secondCallerRelease.close(),
        () => secondCallerMedia.dispose(),
        () => secondCallerMcp.dispose(),
        () => secondCallerConfig.dispose(),
        () => rm(secondCallerDirectory, { recursive: true, force: true }),
      ],
      secondCallerPreviousReplay,
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
      const activation = await executeProviderActivation(
        secondCallerConfig,
        secondCallerSelection.activation ?? {
          provider: secondCallerConfig.getProvider(),
          model: secondCallerConfig.getModel(),
        },
        assembleProviderSwitch(
          secondCallerConfig,
          secondCallerSettings,
          secondCallerManager,
          secondCallerOAuth,
          () => 'agent',
          () => secondCallerOwner.clients.refreshAuth(),
          secondCallerSettingsOwner,
        ),
        secondCallerSettings,
        secondCallerManager,
        (method) => secondCallerOwner.clients.refreshAuth(method),
        assembleModelSelection(secondCallerSettingsOwner),
      );
      requireCallerActivation(activation);
      await secondCallerOwner.initializeTools();
      await ownerClients(secondCallerOwner)[1].startChat();
    } catch (primary) {
      await cleanupAfterFailure(primary, secondCallerClose);
    }

    let release: (value: string | null) => void = () => {
      throw new Error('Gate is not initialized');
    };
    const held = new Promise<string | null>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => {
      throw new Error('Gate is not initialized');
    };
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const apply = (
      config: Config,
      settingsService: SettingsService,
      settingsOwner: SessionSettingsOwner,
      providerManager: ReturnType<typeof acquirePreferredProviderManager>,
      sessionClient: SessionClientOwner,
      mcpRuntime: McpRuntimeOwner,
      profile: Profile,
      readKey: (name: string) => Promise<string | null>,
    ): ReturnType<typeof applyProfileCascade> =>
      applyProfileCascade(
        profile,
        {},
        settingsService,
        providerManager,
        mcpRuntime.profileDefinitions,
        assembleProviderSwitch(
          config,
          settingsService,
          providerManager,
          null,
          () => undefined,
          () => sessionClient.clients.refreshAuth(),
          settingsOwner,
        ),
        assembleModelSelection(settingsOwner),
        {
          readEndpoint: () => settingsOwner.readSelectedEndpoint(),
          applyParameter: (key, value) =>
            settingsOwner.writeUserParameter(key, value),
        },
        readKey,
      );
    try {
      const before = firstCallerSettings.exportForStateSnapshot();
      const profile: Profile = {
        version: 1,
        provider: 'fake',
        model: 'replacement',
        modelParams: {},
        ephemeralSettings: { 'auth-key-name': 'first-key' },
      };
      const pending = apply(
        firstCallerConfig,
        firstCallerSettings,
        firstCallerSettingsOwner,
        firstCallerManager,
        firstCallerOwner,
        firstCallerMcp,
        profile,
        async () => {
          entered();
          return held;
        },
      );
      const observed = pending.catch((error: unknown) => error);
      await started;
      expect(firstCallerSettings.exportForStateSnapshot()).toStrictEqual(
        before,
      );
      await apply(
        secondCallerConfig,
        secondCallerSettings,
        secondCallerSettingsOwner,
        secondCallerManager,
        secondCallerOwner,
        secondCallerMcp,
        {
          ...profile,
          model: 'sibling-selected',
          ephemeralSettings: {
            'base-url': 'https://sibling.example',
          },
        },
        async () => {
          throw new Error('Unexpected key read');
        },
      );
      expect(secondCallerSettingsOwner.readSelectedModel()).toBe(
        'sibling-selected',
      );
      release(null);
      expect(await observed).toBeInstanceOf(Error);
      expect(firstCallerSettings.exportForStateSnapshot()).toStrictEqual(
        before,
      );
      expect(secondCallerSettingsOwner.readSelectedEndpoint()).toBe(
        'https://sibling.example',
      );
      await firstCallerClose();
      expect(secondCallerSettingsOwner.readSelectedModel()).toBe(
        'sibling-selected',
      );
    } finally {
      release(null);
      await firstCallerClose();
      await secondCallerClose();
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
