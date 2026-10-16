import { CallerAgentRuntimeFactories } from './helpers/fixture-data.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';

import { readdir } from 'node:fs/promises';

import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';

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
import { cleanupAfterFailure } from '../../core/subagent-cleanup.js';
import { SessionClientOwner } from '../../session/session-client-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { beforeAll, afterAll, describe, expect, it, afterEach } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';

import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';

import { injectConfirmationForcingPolicy } from '../confirmationForcing.js';
import { executeProviderActivation } from '../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';
import { assembleModelSelection } from '../model-selection.js';
import { AgentConfig, FromConfigOptions } from '../config-types.js';
import { fromConfig } from '../fromConfig.js';

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
  useOwnedCredentials();

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

  const credentials = useOwnedCredentials();

  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function rejectWithoutAcquisition(
    options: FromConfigOptions,
  ): Promise<unknown> {
    const home = process.env.LLXPRT_CONFIG_HOME;
    if (home === undefined) throw new Error('Missing fixture config home');
    const before = (await readdir(home, { recursive: true })).sort();
    const workspaceBefore = (
      await readdir(options.config.getTargetDir(), { recursive: true })
    ).sort();
    const transports = credentials().snapshot();
    const outcome = await fromConfig({
      ...options,
      credentialAuthority: credentials().authority,
    }).then(
      async (agent) => {
        await agent.dispose();
        return undefined;
      },
      (error: unknown) => error,
    );
    const after = await readdir(home, { recursive: true });
    const workspaceAfter = await readdir(options.config.getTargetDir(), {
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

  it('rejects an MCP handoff for another Config before media or provider acquisition', async () => {
    const builtDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'from-config-admission-')),
    );
    cleanups.push(() => rm(builtDirectory, { recursive: true, force: true }));
    const builtOverrides = {
      workingDir: builtDirectory,
      folderTrust: true,
      mcpEnabled: false,
      skillsSupport: false,
      recording: { enabled: false },
      telemetry: { enabled: false },
      settings: { jitContextEnabled: false },
    };

    const builtCallerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('fixtures/' + 'plain-text.jsonl', import.meta.url),
    );
    const builtCallerDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-caller-')),
    );
    const builtCallerOverrides: Readonly<Partial<AgentConfig>> = builtOverrides;
    const builtCallerSelection: AgentConfig = {
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      ...builtCallerOverrides,
      workingDir:
        builtCallerOverrides.workingDir === undefined
          ? builtCallerDirectory
          : await realpath(builtCallerOverrides.workingDir),
    };
    const builtCallerParameters = {
      ...toConfigParameters(builtCallerSelection),
      ...{},
    };
    builtCallerParameters.interactive = true;
    if (builtCallerOverrides.hooks !== undefined)
      builtCallerParameters.enableHooks = true;
    if (
      builtCallerOverrides.filesystemOwner === undefined &&
      (builtCallerOverrides.harness?.includeProcessCwd ?? true)
    )
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
    const builtCallerTokenizer = configureProviderTokenizer(builtCallerManager);
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
    const otherFactorylessPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('fixtures/' + 'plain-text.jsonl', import.meta.url),
    );
    const otherFactorylessDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'factoryless-caller-')),
    );
    const otherFactorylessSupplied: CallerAgentRuntimeFactories = {};
    const otherFactorylessConfig = new Config(
      toConfigParameters({
        ...{
          provider: 'fake',
          model: 'fake-model',
          workingDir: otherFactorylessDirectory,
        },
        ...otherOverrides,
      }),
    );
    const otherFactorylessSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      otherFactorylessConfig.getInitialSettings(),
    ))
      otherFactorylessSettings.set(key, value);
    const otherFactorylessSettingsOwner = new SessionSettingsOwner(
      otherFactorylessSettings,
    );
    otherFactorylessSettingsOwner.bindTelemetry(otherFactorylessConfig);
    otherFactorylessSettingsOwner.initializeProviderSelection(
      otherFactorylessConfig.getProvider(),
      otherFactorylessConfig.getModel(),
    );
    const otherFactorylessPolicy = new RuntimePolicyOwner(
      otherFactorylessConfig,
    );
    const otherFactorylessTask = otherFactorylessSupplied.taskToolRegistration;
    const otherFactorylessFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...(otherFactorylessSupplied.agentClientFactory
        ? { agentClientFactory: otherFactorylessSupplied.agentClientFactory }
        : {}),
      ...(otherFactorylessTask
        ? { taskToolRegistration: () => otherFactorylessTask }
        : {}),
    };

    const otherFactorylessClose = settleFactorylessRelease.bind(
      undefined,
      [
        () => otherFactorylessSettingsOwner.dispose(),
        () => otherFactorylessPolicy.dispose(),
        () => otherFactorylessConfig.dispose(),
        () => rm(otherFactorylessDirectory, { recursive: true, force: true }),
      ],
      otherFactorylessPreviousReplay,
    );
    cleanups.push(otherFactorylessClose);

    await expect(
      rejectWithoutAcquisition({
        config: otherFactorylessConfig,
        settingsService: otherFactorylessSettings,
        settingsOwner: otherFactorylessSettingsOwner,
        policyOwner: otherFactorylessPolicy,
        messageBus: otherFactorylessPolicy.session.messageBus,
        runtimeFactoryBindings: otherFactorylessFactories,
        mcpRuntime: builtCallerMcp,
      }),
    ).resolves.toMatchObject({ message: expect.stringMatching(/Config/i) });
  });
});
async function settleFactorylessRelease(
  steps: ReadonlyArray<() => void | Promise<void>>,
  previous: string | undefined,
): Promise<void> {
  try {
    await runCleanupSteps(steps);
  } finally {
    if (previous === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previous;
  }
}

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
