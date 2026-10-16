import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { toConfigParameters } from '../agentConfig.adapter.js';
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
import {
  assembleProviderSwitch,
  assembleAgentActivationBootstrap,
} from '../providerSwitchAssembly.js';
import { assembleModelSelection } from '../model-selection.js';
import { AgentConfig } from '../config-types.js';
import { AgentActivationBootstrap } from '../activationPreflightState.js';
import { fromConfig } from '../fromConfig.js';

const intent = { provider: 'fake', authMode: 'auto' } as const;

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
describe('preflight adoption boundaries', () => {
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

  it('rechecks the actual adopted manager at consumption', async () => {
    const built_builtCallerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('fixtures/' + 'plain-text.jsonl', import.meta.url),
    );
    const built_builtCallerDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-caller-')),
    );
    const built_builtCallerOverrides: Readonly<Partial<AgentConfig>> = {};
    const built_builtCallerSelection: AgentConfig = {
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      ...built_builtCallerOverrides,
      workingDir: built_builtCallerDirectory,
    };
    const built_builtCallerParameters = {
      ...toConfigParameters(built_builtCallerSelection),
      ...{},
    };
    built_builtCallerParameters.interactive = true;

    built_builtCallerParameters.includeDirectories = [
      ...(built_builtCallerParameters.includeDirectories ?? []),
      process.cwd(),
    ];
    const built_builtCallerConfig = new Config(built_builtCallerParameters);
    const built_builtCallerFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...{},
    };
    const built_builtCallerSettings = new SettingsService();
    for (const [built_key, built_value] of Object.entries(
      built_builtCallerConfig.getInitialSettings(),
    ))
      built_builtCallerSettings.set(built_key, built_value);
    const built_builtCallerPolicy = new RuntimePolicyOwner(
      built_builtCallerConfig,
    );
    injectConfirmationForcingPolicy(
      built_builtCallerPolicy.session.confirmation,
    );
    const built_builtCallerMcp = await buildTestMcpRuntime(
      built_builtCallerConfig,
      built_builtCallerPolicy.session.messageBus,
      built_builtCallerOverrides,
      undefined,
      built_builtCallerPolicy,
      undefined,
    );
    const built_builtCallerRuntimeId = 'caller-' + randomUUID();
    const built_builtCallerRelease = new AcquisitionRelease();
    const built_builtCallerSettingsOwner = new SessionSettingsOwner(
      built_builtCallerSettings,
    );
    built_builtCallerRelease.acquire('settings', () =>
      built_builtCallerSettingsOwner.dispose(),
    );
    built_builtCallerSettingsOwner.initializeProviderSelection(
      built_builtCallerConfig.getProvider(),
      built_builtCallerConfig.getModel(),
    );
    built_builtCallerSettingsOwner.bindTelemetry(built_builtCallerConfig);
    const built_builtCallerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const built_scope of [
      built_builtCallerRuntimeId,
      built_builtCallerConfig.getSessionId(),
    ])
      built_builtCallerRelease.acquire('files', () =>
        releaseAdoptedFileScope(built_builtCallerFiles, built_scope),
      );
    const built_builtCallerManager = acquirePreferredProviderManager(
      built_builtCallerConfig,
      built_builtCallerSettings,
      built_builtCallerSettingsOwner,
      built_builtCallerFiles,
      built_builtCallerRuntimeId,
      builtCredentials().authority,
      built_builtCallerRelease,
    );
    const built_builtCallerTokenizer = configureProviderTokenizer(
      built_builtCallerManager,
    );
    const built_builtCallerContent = createRuntimeContentGeneratorFactory();
    const built_builtCallerOAuth = acquirePreferredOAuth(
      undefined,
      built_builtCallerPolicy.session.messageBus,
      built_builtCallerConfig,
      built_builtCallerSettings,
      built_builtCallerManager,
      built_builtCallerRuntimeId,
      built_builtCallerMcp.profileDefinitions,
      builtCredentials().authority,
      built_builtCallerRelease,
      undefined,
    );
    const built_builtCallerMedia = new SessionMediaOwner(
      built_builtCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    const built_builtCallerOwner = await SessionClientOwner.create(
      built_builtCallerConfig,
      assembleTaskSchemaPolicy(built_builtCallerSettings),
      built_builtCallerManager,
      built_builtCallerFactories.agentClientFactory,
      built_builtCallerMedia.store,
      built_builtCallerMcp.readInstructions,
      built_builtCallerMcp.workspacePaths,
      built_builtCallerSettingsOwner,
      built_builtCallerContent,
      built_builtCallerTokenizer,
    );
    built_builtCallerOwner.bindMcpRuntime(built_builtCallerMcp);
    built_builtCallerOwner.bindProviderFiles(
      built_builtCallerFiles,
      (built_provider) =>
        built_builtCallerOAuth.composeRetryOperations(built_provider),
    );
    built_builtCallerOwner.bindHooks();
    const built_builtCallerClose = settleEngineRelease.bind(
      undefined,
      [
        () => built_builtCallerOwner.dispose(),
        () => built_builtCallerRelease.close(),
        () => built_builtCallerMedia.dispose(),
        () => built_builtCallerMcp.dispose(),
        () => built_builtCallerConfig.dispose(),
        () => rm(built_builtCallerDirectory, { recursive: true, force: true }),
      ],
      built_builtCallerPreviousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        built_builtCallerConfig,
        built_builtCallerSettings,
        built_builtCallerSettingsOwner,
        built_builtCallerManager,
        built_builtCallerOAuth,
        built_builtCallerRuntimeId,
        built_builtCallerTokenizer,
        undefined,
      );
      await built_builtCallerMcp.initialize();
      const built_activation = await executeProviderActivation(
        built_builtCallerConfig,
        built_builtCallerSelection.activation ?? {
          provider: built_builtCallerConfig.getProvider(),
          model: built_builtCallerConfig.getModel(),
        },
        assembleProviderSwitch(
          built_builtCallerConfig,
          built_builtCallerSettings,
          built_builtCallerManager,
          built_builtCallerOAuth,
          () => 'agent',
          () => built_builtCallerOwner.refreshAuth(),
          built_builtCallerSettingsOwner,
        ),
        built_builtCallerSettings,
        built_builtCallerManager,
        (built_method) => built_builtCallerOwner.refreshAuth(built_method),
        assembleModelSelection(built_builtCallerSettingsOwner),
      );
      requireCallerActivation(built_activation);
      await built_builtCallerOwner.initializeTools();
      await built_builtCallerOwner.getAgentClient().startChat();
    } catch (built_primary) {
      await cleanupAfterFailure(built_primary, built_builtCallerClose);
    }
    const built_manager = built_builtCallerManager;

    const built_operation = await assembleAgentActivationBootstrap(
      built_builtCallerConfig,
      built_builtCallerSettings,
      built_manager,
      null,
      () => undefined,
      'borrowed',
      built_builtCallerOwner.getAgentClient(),
      built_builtCallerMcp,
      built_builtCallerMcp.workspaceFilesystem,
      built_builtCallerMcp.workspaceMemory,
      built_builtCallerSettingsOwner,
    );

    const other_builtCallerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('fixtures/' + 'plain-text.jsonl', import.meta.url),
    );
    const other_builtCallerDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-caller-')),
    );
    const other_builtCallerOverrides: Readonly<Partial<AgentConfig>> = {};
    const other_builtCallerSelection: AgentConfig = {
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      ...other_builtCallerOverrides,
      workingDir: other_builtCallerDirectory,
    };
    const other_builtCallerParameters = {
      ...toConfigParameters(other_builtCallerSelection),
      ...{},
    };
    other_builtCallerParameters.interactive = true;

    other_builtCallerParameters.includeDirectories = [
      ...(other_builtCallerParameters.includeDirectories ?? []),
      process.cwd(),
    ];
    const other_builtCallerConfig = new Config(other_builtCallerParameters);
    const other_builtCallerFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...{},
    };
    const other_builtCallerSettings = new SettingsService();
    for (const [other_key, other_value] of Object.entries(
      other_builtCallerConfig.getInitialSettings(),
    ))
      other_builtCallerSettings.set(other_key, other_value);
    const other_builtCallerPolicy = new RuntimePolicyOwner(
      other_builtCallerConfig,
    );
    injectConfirmationForcingPolicy(
      other_builtCallerPolicy.session.confirmation,
    );
    const other_builtCallerMcp = await buildTestMcpRuntime(
      other_builtCallerConfig,
      other_builtCallerPolicy.session.messageBus,
      other_builtCallerOverrides,
      undefined,
      other_builtCallerPolicy,
      undefined,
    );
    const other_builtCallerRuntimeId = 'caller-' + randomUUID();
    const other_builtCallerRelease = new AcquisitionRelease();
    const other_builtCallerSettingsOwner = new SessionSettingsOwner(
      other_builtCallerSettings,
    );
    other_builtCallerRelease.acquire('settings', () =>
      other_builtCallerSettingsOwner.dispose(),
    );
    other_builtCallerSettingsOwner.initializeProviderSelection(
      other_builtCallerConfig.getProvider(),
      other_builtCallerConfig.getModel(),
    );
    other_builtCallerSettingsOwner.bindTelemetry(other_builtCallerConfig);
    const other_builtCallerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const other_scope of [
      other_builtCallerRuntimeId,
      other_builtCallerConfig.getSessionId(),
    ])
      other_builtCallerRelease.acquire('files', () =>
        releaseAdoptedFileScope(other_builtCallerFiles, other_scope),
      );
    const other_builtCallerManager = acquirePreferredProviderManager(
      other_builtCallerConfig,
      other_builtCallerSettings,
      other_builtCallerSettingsOwner,
      other_builtCallerFiles,
      other_builtCallerRuntimeId,
      builtCredentials().authority,
      other_builtCallerRelease,
    );
    const other_builtCallerTokenizer = configureProviderTokenizer(
      other_builtCallerManager,
    );
    const other_builtCallerContent = createRuntimeContentGeneratorFactory();
    const other_builtCallerOAuth = acquirePreferredOAuth(
      undefined,
      other_builtCallerPolicy.session.messageBus,
      other_builtCallerConfig,
      other_builtCallerSettings,
      other_builtCallerManager,
      other_builtCallerRuntimeId,
      other_builtCallerMcp.profileDefinitions,
      builtCredentials().authority,
      other_builtCallerRelease,
      undefined,
    );
    const other_builtCallerMedia = new SessionMediaOwner(
      other_builtCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    const other_builtCallerOwner = await SessionClientOwner.create(
      other_builtCallerConfig,
      assembleTaskSchemaPolicy(other_builtCallerSettings),
      other_builtCallerManager,
      other_builtCallerFactories.agentClientFactory,
      other_builtCallerMedia.store,
      other_builtCallerMcp.readInstructions,
      other_builtCallerMcp.workspacePaths,
      other_builtCallerSettingsOwner,
      other_builtCallerContent,
      other_builtCallerTokenizer,
    );
    other_builtCallerOwner.bindMcpRuntime(other_builtCallerMcp);
    other_builtCallerOwner.bindProviderFiles(
      other_builtCallerFiles,
      (other_provider) =>
        other_builtCallerOAuth.composeRetryOperations(other_provider),
    );
    other_builtCallerOwner.bindHooks();
    const other_builtCallerClose = settleEngineRelease.bind(
      undefined,
      [
        () => other_builtCallerOwner.dispose(),
        () => other_builtCallerRelease.close(),
        () => other_builtCallerMedia.dispose(),
        () => other_builtCallerMcp.dispose(),
        () => other_builtCallerConfig.dispose(),
        () => rm(other_builtCallerDirectory, { recursive: true, force: true }),
      ],
      other_builtCallerPreviousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        other_builtCallerConfig,
        other_builtCallerSettings,
        other_builtCallerSettingsOwner,
        other_builtCallerManager,
        other_builtCallerOAuth,
        other_builtCallerRuntimeId,
        other_builtCallerTokenizer,
        undefined,
      );
      await other_builtCallerMcp.initialize();
      const other_activation = await executeProviderActivation(
        other_builtCallerConfig,
        other_builtCallerSelection.activation ?? {
          provider: other_builtCallerConfig.getProvider(),
          model: other_builtCallerConfig.getModel(),
        },
        assembleProviderSwitch(
          other_builtCallerConfig,
          other_builtCallerSettings,
          other_builtCallerManager,
          other_builtCallerOAuth,
          () => 'agent',
          () => other_builtCallerOwner.refreshAuth(),
          other_builtCallerSettingsOwner,
        ),
        other_builtCallerSettings,
        other_builtCallerManager,
        (other_method) => other_builtCallerOwner.refreshAuth(other_method),
        assembleModelSelection(other_builtCallerSettingsOwner),
      );
      requireCallerActivation(other_activation);
      await other_builtCallerOwner.initializeTools();
      await other_builtCallerOwner.getAgentClient().startChat();
    } catch (other_primary) {
      await cleanupAfterFailure(other_primary, other_builtCallerClose);
    }
    const other_manager = other_builtCallerManager;

    const other_operation = await assembleAgentActivationBootstrap(
      other_builtCallerConfig,
      other_builtCallerSettings,
      other_manager,
      null,
      () => undefined,
      'borrowed',
      other_builtCallerOwner.getAgentClient(),
      other_builtCallerMcp,
      other_builtCallerMcp.workspaceFilesystem,
      other_builtCallerMcp.workspaceMemory,
      other_builtCallerSettingsOwner,
    );
    try {
      const result = await built_operation.preflight(intent);
      if (!result.token) throw new Error('Missing receipt');
      const preflight = { operation: built_operation, token: result.token };
      expect(() =>
        AgentActivationBootstrap.consume(
          preflight,
          built_builtCallerConfig,
          intent,
          other_builtCallerManager,
          built_builtCallerSettings,
        ),
      ).toThrow('different ProviderManager');
      const agent = await fromConfig({
        settingsService: built_builtCallerSettings,
        agentClient: built_builtCallerOwner.getAgentClient(),
        providerManager: built_builtCallerManager,
        config: built_builtCallerConfig,
        mcpRuntime: built_builtCallerMcp,
        activation: intent,
        activationPreflight: preflight,
      });
      expect(agent.getProvider()).toBe('fake');
      await agent.dispose();
    } finally {
      await other_operation.dispose();
      await built_operation.dispose();
      await other_builtCallerClose();
      await built_builtCallerClose();
    }
  });
});

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
