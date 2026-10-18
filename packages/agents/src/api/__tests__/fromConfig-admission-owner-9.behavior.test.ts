import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { mkdtemp, realpath, rm, readdir } from 'node:fs/promises';
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
import { beforeAll, afterAll, describe, expect, it, afterEach } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../confirmationForcing.js';
import { executeProviderActivation } from '../providerActivationExecutor.js';
import {
  assembleProviderSwitch,
  assembleAgentActivationBootstrap,
} from '../providerSwitchAssembly.js';
import { assembleModelSelection } from '../model-selection.js';
import { AgentConfig, ProviderActivationIntent } from '../config-types.js';
import { fromConfig } from '../fromConfig.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const intent: ProviderActivationIntent = {
  provider: 'fake',
  model: 'fake-model',
  authMode: 'none',
};

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
describe('fromConfig admission before resource effects', () => {
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
  const builtCredentials = useOwnedCredentials();
  const otherCredentials = useOwnedCredentials();

  const credentials = useOwnedCredentials();

  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function rejectWithoutAcquisition(
    workspaceDirectory: string,
    adopt: () => ReturnType<typeof fromConfig>,
  ): Promise<unknown> {
    const home = process.env.LLXPRT_CONFIG_HOME;
    if (home === undefined) throw new Error('Missing fixture config home');
    const before = (await readdir(home, { recursive: true })).sort();
    const workspaceBefore = (
      await readdir(workspaceDirectory, { recursive: true })
    ).sort();
    const transports = credentials().snapshot();
    const outcome = await adopt().then(
      async (agent) => {
        await agent.dispose();
        return undefined;
      },
      (error: unknown) => error,
    );
    const after = await readdir(home, { recursive: true });
    const workspaceAfter = await readdir(workspaceDirectory, {
      recursive: true,
    });
    expect([
      ...after.filter((entry) => !before.includes(entry)),
      ...before.filter((entry) => !after.includes(entry)),
    ]).toStrictEqual([]);
    expect([
      ...workspaceAfter.filter((entry) => !workspaceBefore.includes(entry)),
      ...workspaceBefore.filter((entry) => !workspaceAfter.includes(entry)),
    ]).toStrictEqual([]);
    expect(credentials().snapshot().length - transports.length).toBe(0);
    return outcome;
  }

  for (const mismatch of ['settings', 'config', 'manager', 'intent', 'bus']) {
    it(`rejects preflight ${mismatch} identity before transferring or acquiring resources`, async () => {
      const builtCallerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
      process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
        new URL('fixtures/' + 'plain-text.jsonl', import.meta.url),
      );
      const builtCallerDirectory = await realpath(
        await mkdtemp(join(tmpdir(), 'explicit-caller-')),
      );
      const builtCallerOverrides: Readonly<Partial<AgentConfig>> = {};
      const builtCallerSelection: AgentConfig = {
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        ...builtCallerOverrides,
        workingDir: builtCallerDirectory,
      };
      const builtCallerParameters = {
        ...toConfigParameters(builtCallerSelection),
        ...{},
      };
      builtCallerParameters.interactive = true;

      builtCallerParameters.includeDirectories = [
        ...(builtCallerParameters.includeDirectories ?? []),
        process.cwd(),
      ];
      const builtCallerConfig = new Config(builtCallerParameters);
      const builtCallerFactories = {
        ...createAgentRuntimeFactoryBindings(),
        ...{},
      };
      const builtCallerSettings = new SettingsService();
      for (const [key, value] of Object.entries(
        builtCallerConfig.getInitialSettings(),
      ))
        builtCallerSettings.set(key, value);
      const builtCallerPolicy = new RuntimePolicyOwner(builtCallerConfig);
      injectConfirmationForcingPolicy(builtCallerPolicy.session.confirmation);
      const builtCallerMcp = await buildTestMcpRuntime(
        builtCallerConfig,
        builtCallerPolicy.session.messageBus,
        builtCallerOverrides,
        undefined,
        builtCallerPolicy,
        undefined,
      );
      const builtCallerRuntimeId = 'caller-' + randomUUID();
      const builtCallerRelease = new AcquisitionRelease();
      const builtCallerSettingsOwner = new SessionSettingsOwner(
        builtCallerSettings,
      );
      builtCallerRelease.acquire('settings', () =>
        builtCallerSettingsOwner.dispose(),
      );
      builtCallerSettingsOwner.initializeProviderSelection(
        builtCallerConfig.getProvider(),
        builtCallerConfig.getModel(),
      );
      builtCallerSettingsOwner.bindTelemetry(builtCallerConfig);
      const builtCallerFiles = new ProviderFileLifecycle({
        maxFiles: 100,
        maxBytes: 512 * 1024 * 1024,
      });
      for (const scope of [
        builtCallerRuntimeId,
        builtCallerConfig.getSessionId(),
      ])
        builtCallerRelease.acquire('files', () =>
          releaseAdoptedFileScope(builtCallerFiles, scope),
        );
      const builtCallerManager = acquirePreferredProviderManager(
        builtCallerConfig,
        builtCallerSettings,
        builtCallerSettingsOwner,
        builtCallerFiles,
        builtCallerRuntimeId,
        builtCredentials().authority,
        builtCallerRelease,
      );
      const builtCallerTokenizer =
        configureProviderTokenizer(builtCallerManager);
      const builtCallerContent = createRuntimeContentGeneratorFactory();
      const builtCallerOAuth = acquirePreferredOAuth(
        undefined,
        builtCallerPolicy.session.messageBus,
        builtCallerConfig,
        builtCallerSettings,
        builtCallerManager,
        builtCallerRuntimeId,
        builtCallerMcp.profileDefinitions,
        builtCredentials().authority,
        builtCallerRelease,
        undefined,
      );
      const builtCallerMedia = new SessionMediaOwner(
        builtCallerConfig.projectTempDir,
        1024 * 1024 * 1024,
      );
      const builtCallerOwner = await SessionClientOwner.create(
        builtCallerConfig,
        assembleTaskSchemaPolicy(builtCallerSettings),
        builtCallerManager,
        builtCallerFactories.agentClientFactory,
        builtCallerMedia.store,
        builtCallerMcp.readInstructions,
        builtCallerMcp.workspacePaths,
        builtCallerSettingsOwner,
        builtCallerContent,
        builtCallerTokenizer,
      );
      builtCallerOwner.bindMcpRuntime(builtCallerMcp);
      builtCallerOwner.bindProviderFiles(builtCallerFiles, (provider) =>
        builtCallerOAuth.composeRetryOperations(provider),
      );
      builtCallerOwner.bindHooks();
      const builtCallerClose = settleEngineRelease.bind(
        undefined,
        [
          () => builtCallerOwner.dispose(),
          () => builtCallerRelease.close(),
          () => builtCallerMedia.dispose(),
          () => builtCallerMcp.dispose(),
          () => builtCallerConfig.dispose(),
          () => rm(builtCallerDirectory, { recursive: true, force: true }),
        ],
        builtCallerPreviousReplay,
      );
      try {
        await preparePreferredProviderCompletion(
          builtCallerConfig,
          builtCallerSettings,
          builtCallerSettingsOwner,
          builtCallerManager,
          builtCallerOAuth,
          builtCallerRuntimeId,
          builtCallerTokenizer,
          undefined,
        );
        await builtCallerMcp.initialize();
        const activation = await executeProviderActivation(
          builtCallerConfig,
          builtCallerSelection.activation ?? {
            provider: builtCallerConfig.getProvider(),
            model: builtCallerConfig.getModel(),
          },
          assembleProviderSwitch(
            builtCallerConfig,
            builtCallerSettings,
            builtCallerManager,
            builtCallerOAuth,
            () => 'agent',
            () => builtCallerOwner.refreshAuth(),
            builtCallerSettingsOwner,
          ),
          builtCallerSettings,
          builtCallerManager,
          (method) => builtCallerOwner.refreshAuth(method),
          assembleModelSelection(builtCallerSettingsOwner),
        );
        requireCallerActivation(activation);
        await builtCallerOwner.initializeTools();
        await builtCallerOwner.getAgentClient().startChat();
      } catch (primary) {
        await cleanupAfterFailure(primary, builtCallerClose);
      }

      cleanups.push(builtCallerClose);
      const otherDirectory = await realpath(
        await mkdtemp(join(tmpdir(), 'from-config-admission-')),
      );
      cleanups.push(() => rm(otherDirectory, { recursive: true, force: true }));
      const otherOverrides = {
        workingDir: otherDirectory,
        folderTrust: true,
        mcpEnabled: false,
        skillsSupport: false,
        recording: { enabled: false },
        telemetry: { enabled: false },
        settings: { jitContextEnabled: false },
      };

      const otherCallerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
      process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
        new URL('fixtures/' + 'plain-text.jsonl', import.meta.url),
      );
      const otherCallerDirectory = await realpath(
        await mkdtemp(join(tmpdir(), 'explicit-caller-')),
      );
      const otherCallerOverrides: Readonly<Partial<AgentConfig>> =
        otherOverrides;
      const otherCallerSelection: AgentConfig = {
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        ...otherCallerOverrides,
        workingDir:
          otherCallerOverrides.workingDir === undefined
            ? otherCallerDirectory
            : await realpath(otherCallerOverrides.workingDir),
      };
      const otherCallerParameters = {
        ...toConfigParameters(otherCallerSelection),
        ...{},
      };
      otherCallerParameters.interactive = true;
      if (otherCallerOverrides.hooks !== undefined)
        otherCallerParameters.enableHooks = true;
      if (
        otherCallerOverrides.filesystemOwner === undefined &&
        (otherCallerOverrides.harness?.includeProcessCwd ?? true)
      )
        otherCallerParameters.includeDirectories = [
          ...(otherCallerParameters.includeDirectories ?? []),
          process.cwd(),
        ];
      const otherCallerConfig = new Config(otherCallerParameters);
      const otherCallerFactories = {
        ...createAgentRuntimeFactoryBindings(),
        ...{},
      };
      const otherCallerSettings = new SettingsService();
      for (const [key, value] of Object.entries(
        otherCallerConfig.getInitialSettings(),
      ))
        otherCallerSettings.set(key, value);
      const otherCallerPolicy = new RuntimePolicyOwner(otherCallerConfig);
      injectConfirmationForcingPolicy(otherCallerPolicy.session.confirmation);
      const otherCallerMcp = await buildTestMcpRuntime(
        otherCallerConfig,
        otherCallerPolicy.session.messageBus,
        otherCallerOverrides,
        undefined,
        otherCallerPolicy,
        undefined,
      );
      const otherCallerRuntimeId = 'caller-' + randomUUID();
      const otherCallerRelease = new AcquisitionRelease();
      const otherCallerSettingsOwner = new SessionSettingsOwner(
        otherCallerSettings,
      );
      otherCallerRelease.acquire('settings', () =>
        otherCallerSettingsOwner.dispose(),
      );
      otherCallerSettingsOwner.initializeProviderSelection(
        otherCallerConfig.getProvider(),
        otherCallerConfig.getModel(),
      );
      otherCallerSettingsOwner.bindTelemetry(otherCallerConfig);
      const otherCallerFiles = new ProviderFileLifecycle({
        maxFiles: 100,
        maxBytes: 512 * 1024 * 1024,
      });
      for (const scope of [
        otherCallerRuntimeId,
        otherCallerConfig.getSessionId(),
      ])
        otherCallerRelease.acquire('files', () =>
          releaseAdoptedFileScope(otherCallerFiles, scope),
        );
      const otherCallerManager = acquirePreferredProviderManager(
        otherCallerConfig,
        otherCallerSettings,
        otherCallerSettingsOwner,
        otherCallerFiles,
        otherCallerRuntimeId,
        otherCredentials().authority,
        otherCallerRelease,
      );
      const otherCallerTokenizer =
        configureProviderTokenizer(otherCallerManager);
      const otherCallerContent = createRuntimeContentGeneratorFactory();
      const otherCallerOAuth = acquirePreferredOAuth(
        undefined,
        otherCallerPolicy.session.messageBus,
        otherCallerConfig,
        otherCallerSettings,
        otherCallerManager,
        otherCallerRuntimeId,
        otherCallerMcp.profileDefinitions,
        otherCredentials().authority,
        otherCallerRelease,
        undefined,
      );
      const otherCallerMedia = new SessionMediaOwner(
        otherCallerConfig.projectTempDir,
        1024 * 1024 * 1024,
      );
      const otherCallerOwner = await SessionClientOwner.create(
        otherCallerConfig,
        assembleTaskSchemaPolicy(otherCallerSettings),
        otherCallerManager,
        otherCallerFactories.agentClientFactory,
        otherCallerMedia.store,
        otherCallerMcp.readInstructions,
        otherCallerMcp.workspacePaths,
        otherCallerSettingsOwner,
        otherCallerContent,
        otherCallerTokenizer,
      );
      otherCallerOwner.bindMcpRuntime(otherCallerMcp);
      otherCallerOwner.bindProviderFiles(otherCallerFiles, (provider) =>
        otherCallerOAuth.composeRetryOperations(provider),
      );
      otherCallerOwner.bindHooks();
      const otherCallerClose = settleEngineRelease.bind(
        undefined,
        [
          () => otherCallerOwner.dispose(),
          () => otherCallerRelease.close(),
          () => otherCallerMedia.dispose(),
          () => otherCallerMcp.dispose(),
          () => otherCallerConfig.dispose(),
          () => rm(otherCallerDirectory, { recursive: true, force: true }),
        ],
        otherCallerPreviousReplay,
      );
      try {
        await preparePreferredProviderCompletion(
          otherCallerConfig,
          otherCallerSettings,
          otherCallerSettingsOwner,
          otherCallerManager,
          otherCallerOAuth,
          otherCallerRuntimeId,
          otherCallerTokenizer,
          undefined,
        );
        await otherCallerMcp.initialize();
        const activation = await executeProviderActivation(
          otherCallerConfig,
          otherCallerSelection.activation ?? {
            provider: otherCallerConfig.getProvider(),
            model: otherCallerConfig.getModel(),
          },
          assembleProviderSwitch(
            otherCallerConfig,
            otherCallerSettings,
            otherCallerManager,
            otherCallerOAuth,
            () => 'agent',
            () => otherCallerOwner.refreshAuth(),
            otherCallerSettingsOwner,
          ),
          otherCallerSettings,
          otherCallerManager,
          (method) => otherCallerOwner.refreshAuth(method),
          assembleModelSelection(otherCallerSettingsOwner),
        );
        requireCallerActivation(activation);
        await otherCallerOwner.initializeTools();
        await otherCallerOwner.getAgentClient().startChat();
      } catch (primary) {
        await cleanupAfterFailure(primary, otherCallerClose);
      }
      cleanups.push(otherCallerClose);
      const operation = await assembleAgentActivationBootstrap(
        builtCallerConfig,
        builtCallerSettings,
        builtCallerManager,
        builtCallerOAuth,
        () => 'agent',
        'borrowed',
        builtCallerOwner.getAgentClient(),
        builtCallerMcp,
        undefined,
        undefined,
        builtCallerSettingsOwner,
        'borrowed',
        undefined,
        undefined,
        undefined,
        undefined,
        builtCallerFiles,
        builtCallerPolicy.session.messageBus,
      );
      cleanups.push(() => Promise.resolve(operation.dispose()));
      const result = await operation.preflight(intent);
      if (result.token === undefined)
        throw new Error('Missing preflight receipt');
      const token = result.token;
      await expect(
        rejectWithoutAcquisition(
          (mismatch === 'config'
            ? otherCallerConfig
            : builtCallerConfig
          ).getTargetDir(),
          () =>
            fromConfig(
              mismatch === 'config' ? otherCallerConfig : builtCallerConfig,
              mismatch === 'settings'
                ? otherCallerSettings
                : builtCallerSettings,
              {
                activation:
                  mismatch === 'intent'
                    ? { ...intent, model: 'other' }
                    : intent,
              },
              undefined,
              mismatch === 'manager' ? otherCallerManager : builtCallerManager,
              undefined,
              mismatch === 'bus'
                ? otherCallerPolicy.session.messageBus
                : builtCallerPolicy.session.messageBus,
              builtCallerMcp,
              { operation, token },
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              credentials().authority,
            ),
        ),
      ).resolves.toMatchObject({
        message: expect.stringMatching(
          mismatch === 'settings' ? /settings/i : /preflight/i,
        ),
      });
    });
  }
});

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
