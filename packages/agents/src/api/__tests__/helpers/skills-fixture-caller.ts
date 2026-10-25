/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { SessionClientOwner } from '../../../session/session-client-owner.js';
import {
  Config,
  type ConfigParameters,
} from '@vybestack/llxprt-code-core/config/config.js';
import type { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import type { ExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cleanupAfterFailure,
  runCleanupSteps,
} from '../../../core/subagent-cleanup.js';
import { releaseAdoptedFileScope } from '../../adoption-release.js';
import { toConfigParameters } from '../../agentConfig.adapter.js';
import type { AgentConfig } from '../../config-types.js';
import { injectConfirmationForcingPolicy } from '../../confirmationForcing.js';
import { assembleModelSelection } from '../../model-selection.js';
import {
  acquirePreferredOAuth,
  acquirePreferredProviderManager,
  preparePreferredProviderCompletion,
} from '../../preferred-provider-acquisition.js';
import { executeProviderActivation } from '../../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../../providerSwitchAssembly.js';
import {
  createAgentRuntimeFactoryBindings,
  type AgentRuntimeFactoryBindings,
} from '../../runtimeFactories.js';
import { AgentResourceCapture } from './agent-resource-capture.js';
import { buildTestMcpRuntime } from './mcp-owner-fixture.js';

interface SkillCallerOptions {
  readonly fixture: URL;
  readonly authority: CredentialAuthority;
  readonly overrides: Readonly<Partial<AgentConfig>>;
  readonly parameters?: Pick<
    ConfigParameters,
    'enableExtensionReloading' | 'storageRoot'
  >;
  readonly factories?: Readonly<Partial<AgentRuntimeFactoryBindings>>;
  readonly extensionLoader?: ExtensionLoader;
  readonly operations?: WorkspaceSkillAssemblyOperations;
}

function configureCaller(
  selection: AgentConfig,
  options: SkillCallerOptions,
): Config {
  const parameters = {
    ...toConfigParameters(selection),
    ...options.parameters,
  };
  parameters.interactive = true;
  if (options.overrides.hooks !== undefined) parameters.enableHooks = true;
  if (
    options.overrides.filesystemOwner === undefined &&
    (options.overrides.harness?.includeProcessCwd ?? true)
  )
    parameters.includeDirectories = [
      ...(parameters.includeDirectories ?? []),
      process.cwd(),
    ];
  return new Config(parameters);
}

interface CallerProviders {
  readonly settings: SettingsService;
  readonly runtimeId: string;
  readonly release: AcquisitionRelease;
  readonly settingsOwner: SessionSettingsOwner;
  readonly files: ProviderFileLifecycle;
  readonly manager: ReturnType<typeof acquirePreferredProviderManager>;
  readonly tokenizer: ReturnType<typeof configureProviderTokenizer>;
  readonly content: ReturnType<typeof createRuntimeContentGeneratorFactory>;
  readonly oauth: ReturnType<typeof acquirePreferredOAuth>;
}

export interface SkillsCaller extends CallerProviders {
  readonly config: Config;
  readonly mcp: Awaited<ReturnType<typeof buildTestMcpRuntime>>;
  readonly close: () => Promise<void>;
  readonly client: AgentClientContract;
  readonly policy: RuntimePolicyOwner;
}

function createCallerSettings(config: Config): SettingsService {
  const settings = new SettingsService();
  for (const [key, value] of Object.entries(config.getInitialSettings()))
    settings.set(key, value);
  return settings;
}

function acquireCallerProviders(
  config: Config,
  policy: RuntimePolicyOwner,
  mcp: Awaited<ReturnType<typeof buildTestMcpRuntime>>,
  authority: CredentialAuthority,
  settings: SettingsService,
): CallerProviders {
  const runtimeId = 'caller-' + randomUUID();
  const release = new AcquisitionRelease();
  const settingsOwner = new SessionSettingsOwner(settings);
  release.acquire('settings', () => settingsOwner.dispose());
  settingsOwner.initializeProviderSelection(
    config.getProvider(),
    config.getModel(),
  );
  settingsOwner.bindTelemetry(config);
  const files = new ProviderFileLifecycle({
    maxFiles: 100,
    maxBytes: 512 * 1024 * 1024,
  });
  for (const scope of [runtimeId, config.getSessionId()])
    release.acquire('files', () => releaseAdoptedFileScope(files, scope));
  const manager = acquirePreferredProviderManager(
    config,
    settings,
    settingsOwner,
    files,
    runtimeId,
    authority,
    release,
  );
  const tokenizer = configureProviderTokenizer(manager);
  const content = createRuntimeContentGeneratorFactory();
  const oauth = acquirePreferredOAuth(
    undefined,
    policy.session.messageBus,
    config,
    settings,
    manager,
    runtimeId,
    mcp.profileDefinitions,
    authority,
    release,
    undefined,
  );
  return {
    settings,
    runtimeId,
    release,
    settingsOwner,
    files,
    manager,
    tokenizer,
    content,
    oauth,
  };
}

async function initializeCaller(
  config: Config,
  mcp: Awaited<ReturnType<typeof buildTestMcpRuntime>>,
  owner: SessionClientOwner,
  providers: CallerProviders,
  selection: AgentConfig,
  capture: AgentResourceCapture,
): Promise<void> {
  const { settings, settingsOwner, manager, oauth, runtimeId, tokenizer } =
    providers;
  await preparePreferredProviderCompletion(
    config,
    settings,
    settingsOwner,
    manager,
    oauth,
    runtimeId,
    tokenizer,
    undefined,
  );
  await mcp.initialize();
  const activation = await executeProviderActivation(
    config,
    selection.activation ?? {
      provider: config.getProvider(),
      model: config.getModel(),
    },
    assembleProviderSwitch(
      config,
      settings,
      manager,
      oauth,
      () => 'agent',
      () => owner.refreshAuth(),
      settingsOwner,
    ),
    settings,
    manager,
    (method) => owner.refreshAuth(method),
    assembleModelSelection(settingsOwner),
  );
  if (activation.authFailed) throw activation.authError;
  await owner.initializeTools();
  await capture.publishedClient(owner.conversation).startChat();
}

function closeCaller(
  config: Config,
  mcp: Awaited<ReturnType<typeof buildTestMcpRuntime>>,
  owner: SessionClientOwner,
  providers: CallerProviders,
  media: SessionMediaOwner,
  directory: string,
  previousReplay: string | undefined,
): () => Promise<void> {
  return async (): Promise<void> => {
    try {
      await runCleanupSteps([
        () => owner.dispose(),
        () => providers.release.close(),
        () => media.dispose(),
        () => mcp.dispose(),
        () => config.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ]);
    } finally {
      if (previousReplay === undefined)
        delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = previousReplay;
    }
  };
}

async function acquireCallerSession(
  config: Config,
  mcp: Awaited<ReturnType<typeof buildTestMcpRuntime>>,
  providers: CallerProviders,
  factories: AgentRuntimeFactoryBindings,
): Promise<{ owner: SessionClientOwner; media: SessionMediaOwner }> {
  const media = new SessionMediaOwner(
    config.projectTempDir,
    1024 * 1024 * 1024,
  );
  const owner = await SessionClientOwner.create(
    config,
    assembleTaskSchemaPolicy(providers.settings),
    providers.manager,
    factories.agentClientFactory,
    media.store,
    mcp.readInstructions,
    mcp.workspacePaths,
    providers.settingsOwner,
    providers.content,
    providers.tokenizer,
    new CredentialAuthority(),
  );
  owner.bindMcpRuntime(mcp);
  owner.bindProviderFiles(providers.files, (provider) =>
    providers.oauth.composeRetryOperations(provider),
  );
  owner.bindHooks();
  return { owner, media };
}

export async function openSkillsCaller(
  options: SkillCallerOptions,
): Promise<SkillsCaller> {
  const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
  process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(options.fixture);
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'explicit-caller-')),
  );
  const selection: AgentConfig = {
    provider: 'fake',
    model: 'fake-model',
    sessionId: randomUUID(),
    ...options.overrides,
    workingDir:
      options.overrides.workingDir === undefined
        ? directory
        : await realpath(options.overrides.workingDir),
  };
  const config = configureCaller(selection, options);
  const capture = new AgentResourceCapture();
  const factories = capture.factories({
    ...createAgentRuntimeFactoryBindings(),
    ...options.factories,
  });
  const settings = createCallerSettings(config);
  const policy = new RuntimePolicyOwner(config);
  injectConfirmationForcingPolicy(policy.session.confirmation);
  const mcp = await buildTestMcpRuntime(
    config,
    policy.session.messageBus,
    options.overrides,
    options.extensionLoader,
    policy,
    options.operations,
  );
  const providers = acquireCallerProviders(
    config,
    policy,
    mcp,
    options.authority,
    settings,
  );
  const { owner, media } = await acquireCallerSession(
    config,
    mcp,
    providers,
    factories,
  );
  const close = closeCaller(
    config,
    mcp,
    owner,
    providers,
    media,
    directory,
    previousReplay,
  );
  try {
    await initializeCaller(config, mcp, owner, providers, selection, capture);
  } catch (primary) {
    await cleanupAfterFailure(primary, close);
  }
  return {
    config,
    mcp,
    close,
    client: capture.publishedClient(owner.conversation),
    policy,
    ...providers,
  };
}
