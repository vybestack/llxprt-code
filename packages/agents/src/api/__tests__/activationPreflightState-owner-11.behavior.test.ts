import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import {
  ProviderFileLifecycle,
  FakeProvider,
} from '@vybestack/llxprt-code-providers';
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
import { fixturesDir } from './helpers/fixture-data.js';
import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../confirmationForcing.js';
import { executeProviderActivation } from '../providerActivationExecutor.js';
import {
  assembleProviderSwitch,
  assembleAgentActivationBootstrap,
} from '../providerSwitchAssembly.js';
import { assembleModelSelection } from '../model-selection.js';
import { AgentConfig } from '../config-types.js';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import { MemoryTokenStore } from './helpers/provider-auth-fixtures.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class DelayedCredentialProvider extends FakeProvider {
  override name = 'claudecode';
  readonly entered = deferred();
  readonly released = deferred();
  async hasNonOAuthAuthentication(): Promise<boolean> {
    this.entered.resolve();
    await this.released.promise;
    return true;
  }
}

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
describe('activation bootstrap ownership and queued work', () => {
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

  it('allows an independent owner to finish while another is blocked', async () => {
    const blocked_builtCallerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('fixtures/' + 'plain-text.jsonl', import.meta.url),
    );
    const blocked_builtCallerDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-caller-')),
    );
    const blocked_builtCallerOverrides: Readonly<Partial<AgentConfig>> = {};
    const blocked_builtCallerSelection: AgentConfig = {
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      ...blocked_builtCallerOverrides,
      workingDir: blocked_builtCallerDirectory,
    };
    const blocked_builtCallerParameters = {
      ...toConfigParameters(blocked_builtCallerSelection),
      ...{},
    };
    blocked_builtCallerParameters.interactive = true;

    blocked_builtCallerParameters.includeDirectories = [
      ...(blocked_builtCallerParameters.includeDirectories ?? []),
      process.cwd(),
    ];
    const blocked_builtCallerConfig = new Config(blocked_builtCallerParameters);
    const blocked_builtCallerFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...{},
    };
    const blocked_builtCallerSettings = new SettingsService();
    for (const [blocked_key, blocked_value] of Object.entries(
      blocked_builtCallerConfig.getInitialSettings(),
    ))
      blocked_builtCallerSettings.set(blocked_key, blocked_value);
    const blocked_builtCallerPolicy = new RuntimePolicyOwner(
      blocked_builtCallerConfig,
    );
    injectConfirmationForcingPolicy(
      blocked_builtCallerPolicy.session.confirmation,
    );
    const blocked_builtCallerMcp = await buildTestMcpRuntime(
      blocked_builtCallerConfig,
      blocked_builtCallerPolicy.session.messageBus,
      blocked_builtCallerOverrides,
      undefined,
      blocked_builtCallerPolicy,
      undefined,
    );
    const blocked_builtCallerRuntimeId = 'caller-' + randomUUID();
    const blocked_builtCallerRelease = new AcquisitionRelease();
    const blocked_builtCallerSettingsOwner = new SessionSettingsOwner(
      blocked_builtCallerSettings,
    );
    blocked_builtCallerRelease.acquire('settings', () =>
      blocked_builtCallerSettingsOwner.dispose(),
    );
    blocked_builtCallerSettingsOwner.initializeProviderSelection(
      blocked_builtCallerConfig.getProvider(),
      blocked_builtCallerConfig.getModel(),
    );
    blocked_builtCallerSettingsOwner.bindTelemetry(blocked_builtCallerConfig);
    const blocked_builtCallerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const blocked_scope of [
      blocked_builtCallerRuntimeId,
      blocked_builtCallerConfig.getSessionId(),
    ])
      blocked_builtCallerRelease.acquire('files', () =>
        releaseAdoptedFileScope(blocked_builtCallerFiles, blocked_scope),
      );
    const blocked_builtCallerManager = acquirePreferredProviderManager(
      blocked_builtCallerConfig,
      blocked_builtCallerSettings,
      blocked_builtCallerSettingsOwner,
      blocked_builtCallerFiles,
      blocked_builtCallerRuntimeId,
      builtCredentials().authority,
      blocked_builtCallerRelease,
    );
    const blocked_builtCallerTokenizer = configureProviderTokenizer(
      blocked_builtCallerManager,
    );
    const blocked_builtCallerContent = createRuntimeContentGeneratorFactory();
    const blocked_builtCallerOAuth = acquirePreferredOAuth(
      undefined,
      blocked_builtCallerPolicy.session.messageBus,
      blocked_builtCallerConfig,
      blocked_builtCallerSettings,
      blocked_builtCallerManager,
      blocked_builtCallerRuntimeId,
      blocked_builtCallerMcp.profileDefinitions,
      builtCredentials().authority,
      blocked_builtCallerRelease,
      undefined,
    );
    const blocked_builtCallerMedia = new SessionMediaOwner(
      blocked_builtCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    const blocked_builtCallerOwner = await SessionClientOwner.create(
      blocked_builtCallerConfig,
      assembleTaskSchemaPolicy(blocked_builtCallerSettings),
      blocked_builtCallerManager,
      blocked_builtCallerFactories.agentClientFactory,
      blocked_builtCallerMedia.store,
      blocked_builtCallerMcp.readInstructions,
      blocked_builtCallerMcp.workspacePaths,
      blocked_builtCallerSettingsOwner,
      blocked_builtCallerContent,
      blocked_builtCallerTokenizer,
    );
    blocked_builtCallerOwner.bindMcpRuntime(blocked_builtCallerMcp);
    blocked_builtCallerOwner.bindProviderFiles(
      blocked_builtCallerFiles,
      (blocked_provider) =>
        blocked_builtCallerOAuth.composeRetryOperations(blocked_provider),
    );
    blocked_builtCallerOwner.bindHooks();
    const blocked_builtCallerClose = settleEngineRelease.bind(
      undefined,
      [
        () => blocked_builtCallerOwner.dispose(),
        () => blocked_builtCallerRelease.close(),
        () => blocked_builtCallerMedia.dispose(),
        () => blocked_builtCallerMcp.dispose(),
        () => blocked_builtCallerConfig.dispose(),
        () =>
          rm(blocked_builtCallerDirectory, { recursive: true, force: true }),
      ],
      blocked_builtCallerPreviousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        blocked_builtCallerConfig,
        blocked_builtCallerSettings,
        blocked_builtCallerSettingsOwner,
        blocked_builtCallerManager,
        blocked_builtCallerOAuth,
        blocked_builtCallerRuntimeId,
        blocked_builtCallerTokenizer,
        undefined,
      );
      await blocked_builtCallerMcp.initialize();
      const blocked_activation = await executeProviderActivation(
        blocked_builtCallerConfig,
        blocked_builtCallerSelection.activation ?? {
          provider: blocked_builtCallerConfig.getProvider(),
          model: blocked_builtCallerConfig.getModel(),
        },
        assembleProviderSwitch(
          blocked_builtCallerConfig,
          blocked_builtCallerSettings,
          blocked_builtCallerManager,
          blocked_builtCallerOAuth,
          () => 'agent',
          () => blocked_builtCallerOwner.refreshAuth(),
          blocked_builtCallerSettingsOwner,
        ),
        blocked_builtCallerSettings,
        blocked_builtCallerManager,
        (blocked_method) =>
          blocked_builtCallerOwner.refreshAuth(blocked_method),
        assembleModelSelection(blocked_builtCallerSettingsOwner),
      );
      requireCallerActivation(blocked_activation);
      await blocked_builtCallerOwner.initializeTools();
      await blocked_builtCallerOwner.getAgentClient().startChat();
    } catch (blocked_primary) {
      await cleanupAfterFailure(blocked_primary, blocked_builtCallerClose);
    }
    const blocked_manager = blocked_builtCallerManager;
    const blocked_provider = new DelayedCredentialProvider(
      join(fixturesDir, 'plain-text.jsonl'),
    );
    blocked_manager.registerProvider(blocked_provider);
    const blocked_oauth = new OAuthManager(new MemoryTokenStore(), undefined, {
      config: blocked_builtCallerConfig,
      messageBus: blocked_builtCallerPolicy.session.messageBus,
    });
    const blocked_operation = await assembleAgentActivationBootstrap(
      blocked_builtCallerConfig,
      blocked_builtCallerSettings,
      blocked_manager,
      blocked_oauth,
      () => 'cli-interactive',
      'borrowed',
      blocked_builtCallerOwner.getAgentClient(),
      blocked_builtCallerMcp,
      blocked_builtCallerMcp.workspaceFilesystem,
      blocked_builtCallerMcp.workspaceMemory,
      blocked_builtCallerSettingsOwner,
    );

    const independent_builtCallerPreviousReplay =
      process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('fixtures/' + 'plain-text.jsonl', import.meta.url),
    );
    const independent_builtCallerDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-caller-')),
    );
    const independent_builtCallerOverrides: Readonly<Partial<AgentConfig>> = {};
    const independent_builtCallerSelection: AgentConfig = {
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      ...independent_builtCallerOverrides,
      workingDir: independent_builtCallerDirectory,
    };
    const independent_builtCallerParameters = {
      ...toConfigParameters(independent_builtCallerSelection),
      ...{},
    };
    independent_builtCallerParameters.interactive = true;

    independent_builtCallerParameters.includeDirectories = [
      ...(independent_builtCallerParameters.includeDirectories ?? []),
      process.cwd(),
    ];
    const independent_builtCallerConfig = new Config(
      independent_builtCallerParameters,
    );
    const independent_builtCallerFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...{},
    };
    const independent_builtCallerSettings = new SettingsService();
    for (const [independent_key, independent_value] of Object.entries(
      independent_builtCallerConfig.getInitialSettings(),
    ))
      independent_builtCallerSettings.set(independent_key, independent_value);
    const independent_builtCallerPolicy = new RuntimePolicyOwner(
      independent_builtCallerConfig,
    );
    injectConfirmationForcingPolicy(
      independent_builtCallerPolicy.session.confirmation,
    );
    const independent_builtCallerMcp = await buildTestMcpRuntime(
      independent_builtCallerConfig,
      independent_builtCallerPolicy.session.messageBus,
      independent_builtCallerOverrides,
      undefined,
      independent_builtCallerPolicy,
      undefined,
    );
    const independent_builtCallerRuntimeId = 'caller-' + randomUUID();
    const independent_builtCallerRelease = new AcquisitionRelease();
    const independent_builtCallerSettingsOwner = new SessionSettingsOwner(
      independent_builtCallerSettings,
    );
    independent_builtCallerRelease.acquire('settings', () =>
      independent_builtCallerSettingsOwner.dispose(),
    );
    independent_builtCallerSettingsOwner.initializeProviderSelection(
      independent_builtCallerConfig.getProvider(),
      independent_builtCallerConfig.getModel(),
    );
    independent_builtCallerSettingsOwner.bindTelemetry(
      independent_builtCallerConfig,
    );
    const independent_builtCallerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const independent_scope of [
      independent_builtCallerRuntimeId,
      independent_builtCallerConfig.getSessionId(),
    ])
      independent_builtCallerRelease.acquire('files', () =>
        releaseAdoptedFileScope(
          independent_builtCallerFiles,
          independent_scope,
        ),
      );
    const independent_builtCallerManager = acquirePreferredProviderManager(
      independent_builtCallerConfig,
      independent_builtCallerSettings,
      independent_builtCallerSettingsOwner,
      independent_builtCallerFiles,
      independent_builtCallerRuntimeId,
      builtCredentials().authority,
      independent_builtCallerRelease,
    );
    const independent_builtCallerTokenizer = configureProviderTokenizer(
      independent_builtCallerManager,
    );
    const independent_builtCallerContent =
      createRuntimeContentGeneratorFactory();
    const independent_builtCallerOAuth = acquirePreferredOAuth(
      undefined,
      independent_builtCallerPolicy.session.messageBus,
      independent_builtCallerConfig,
      independent_builtCallerSettings,
      independent_builtCallerManager,
      independent_builtCallerRuntimeId,
      independent_builtCallerMcp.profileDefinitions,
      builtCredentials().authority,
      independent_builtCallerRelease,
      undefined,
    );
    const independent_builtCallerMedia = new SessionMediaOwner(
      independent_builtCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    const independent_builtCallerOwner = await SessionClientOwner.create(
      independent_builtCallerConfig,
      assembleTaskSchemaPolicy(independent_builtCallerSettings),
      independent_builtCallerManager,
      independent_builtCallerFactories.agentClientFactory,
      independent_builtCallerMedia.store,
      independent_builtCallerMcp.readInstructions,
      independent_builtCallerMcp.workspacePaths,
      independent_builtCallerSettingsOwner,
      independent_builtCallerContent,
      independent_builtCallerTokenizer,
    );
    independent_builtCallerOwner.bindMcpRuntime(independent_builtCallerMcp);
    independent_builtCallerOwner.bindProviderFiles(
      independent_builtCallerFiles,
      (independent_provider) =>
        independent_builtCallerOAuth.composeRetryOperations(
          independent_provider,
        ),
    );
    independent_builtCallerOwner.bindHooks();
    const independent_builtCallerClose = settleEngineRelease.bind(
      undefined,
      [
        () => independent_builtCallerOwner.dispose(),
        () => independent_builtCallerRelease.close(),
        () => independent_builtCallerMedia.dispose(),
        () => independent_builtCallerMcp.dispose(),
        () => independent_builtCallerConfig.dispose(),
        () =>
          rm(independent_builtCallerDirectory, {
            recursive: true,
            force: true,
          }),
      ],
      independent_builtCallerPreviousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        independent_builtCallerConfig,
        independent_builtCallerSettings,
        independent_builtCallerSettingsOwner,
        independent_builtCallerManager,
        independent_builtCallerOAuth,
        independent_builtCallerRuntimeId,
        independent_builtCallerTokenizer,
        undefined,
      );
      await independent_builtCallerMcp.initialize();
      const independent_activation = await executeProviderActivation(
        independent_builtCallerConfig,
        independent_builtCallerSelection.activation ?? {
          provider: independent_builtCallerConfig.getProvider(),
          model: independent_builtCallerConfig.getModel(),
        },
        assembleProviderSwitch(
          independent_builtCallerConfig,
          independent_builtCallerSettings,
          independent_builtCallerManager,
          independent_builtCallerOAuth,
          () => 'agent',
          () => independent_builtCallerOwner.refreshAuth(),
          independent_builtCallerSettingsOwner,
        ),
        independent_builtCallerSettings,
        independent_builtCallerManager,
        (independent_method) =>
          independent_builtCallerOwner.refreshAuth(independent_method),
        assembleModelSelection(independent_builtCallerSettingsOwner),
      );
      requireCallerActivation(independent_activation);
      await independent_builtCallerOwner.initializeTools();
      await independent_builtCallerOwner.getAgentClient().startChat();
    } catch (independent_primary) {
      await cleanupAfterFailure(
        independent_primary,
        independent_builtCallerClose,
      );
    }
    const independent_manager = independent_builtCallerManager;

    const independent_operation = await assembleAgentActivationBootstrap(
      independent_builtCallerConfig,
      independent_builtCallerSettings,
      independent_manager,
      null,
      () => undefined,
      'borrowed',
      independent_builtCallerOwner.getAgentClient(),
      independent_builtCallerMcp,
      independent_builtCallerMcp.workspaceFilesystem,
      independent_builtCallerMcp.workspaceMemory,
      independent_builtCallerSettingsOwner,
    );
    try {
      blocked_builtCallerSettingsOwner.writeUserParameter(
        'auth-key',
        'blocked-key',
      );
      independent_builtCallerSettingsOwner.writeUserParameter(
        'auth-key',
        'independent-key',
      );
      blocked_builtCallerSettings.setProviderSetting(
        'claudecode',
        'top_p',
        0.3,
      );
      const first = blocked_operation.preflight({
        provider: 'claudecode',
        authMode: 'none',
        model: 'blocked-model',
        modelParams: { temperature: 0.2 },
      });
      await blocked_provider.entered.promise;
      const second = await independent_operation.preflight({
        ...intent,
        model: 'independent-model',
        modelParams: { temperature: 0.8, top_p: 0.9 },
      });
      expect(second.token).toBeDefined();
      expect(independent_builtCallerSettingsOwner.readSelectedModel()).toBe(
        'independent-model',
      );
      blocked_provider.released.resolve();
      expect((await first).token).toBeDefined();
      expect(blocked_builtCallerManager.getActiveProviderName()).toBe(
        'claudecode',
      );
      expect(blocked_builtCallerSettingsOwner.readSelectedModel()).toBe(
        'blocked-model',
      );
      expect(independent_builtCallerSettingsOwner.readSelectedModel()).toBe(
        'independent-model',
      );
      const blockedSettings =
        blocked_builtCallerSettings.getProviderSettings('claudecode');
      const independentSettings =
        independent_builtCallerSettings.getProviderSettings('fake');
      expect(blockedSettings.temperature).toBe(0.2);
      expect(blockedSettings.top_p).toBeUndefined();
      expect(independentSettings.temperature).toBe(0.8);
      expect(independentSettings.top_p).toBe(0.9);
      expect(blockedSettings['auth-key']).toBe('blocked-key');
      expect(
        independent_builtCallerSettingsOwner.readNamedParameter('auth-key'),
      ).toBe('independent-key');
      expect(independentSettings['auth-key']).not.toBe('blocked-key');
    } finally {
      blocked_provider.released.resolve();
      await independent_operation.dispose();
      await blocked_operation.dispose();
      await independent_builtCallerClose();
      await blocked_builtCallerClose();
    }
  });
});

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
