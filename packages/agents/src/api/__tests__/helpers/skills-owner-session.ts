/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  cleanupAfterFailure,
  runCleanupSteps,
} from '../../../core/subagent-cleanup.js';
import type { SessionClientOwner } from '../../../session/session-client-owner.js';
import { releaseAdoptedFileScope } from '../../adoption-release.js';
import { toConfigParameters } from '../../agentConfig.adapter.js';
import { buildAgentClientFactory } from '../../agentBootstrap.js';
import type { AgentConfig } from '../../config-types.js';
import { injectConfirmationForcingPolicy } from '../../confirmationForcing.js';
import { SkillsControl } from '../../control/skillsControl.js';
import { assembleModelSelection } from '../../model-selection.js';
import type { McpRuntimeOwner } from '../../mcpRuntimeAssembly.js';
import { preparePreferredProviderCompletion } from '../../preferred-provider-acquisition.js';
import {
  acquirePreferredOAuth,
  acquirePreferredProviderManager,
} from './provider-acquisition.js';
import { executeProviderActivation } from '../../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../../providerSwitchAssembly.js';
import { buildTestMcpRuntime } from './mcp-owner-fixture.js';
import {
  createCapturedSessionOwner,
  ownerClients,
} from './session-client-capture.js';

interface SkillsOwnerOptions {
  readonly authority: CredentialAuthority;
  readonly overrides: Readonly<Partial<AgentConfig>>;
  readonly parameters?: Pick<
    ConfigParameters,
    'enableExtensionReloading' | 'storageRoot'
  >;
  readonly operations?: WorkspaceSkillAssemblyOperations;
}

export interface SkillsOwnerSession {
  readonly config: Config;
  readonly mcp: McpRuntimeOwner;
  readonly owner: SessionClientOwner;
  readonly client: AgentClientContract;
  readonly skills: SkillsControl;
  readonly close: () => Promise<void>;
}

interface SkillsProviders {
  readonly settings: SettingsService;
  readonly runtimeId: string;
  readonly release: AcquisitionRelease;
  readonly settingsOwner: SessionSettingsOwner;
  readonly files: ProviderFileLifecycle;
  readonly manager: ReturnType<typeof acquirePreferredProviderManager>;
  readonly tokenizer: ReturnType<typeof configureProviderTokenizer>;
  readonly oauth: ReturnType<typeof acquirePreferredOAuth>;
}

function acquireProviders(
  config: Config,
  policy: RuntimePolicyOwner,
  mcp: McpRuntimeOwner,
  authority: CredentialAuthority,
): SkillsProviders {
  const settings = new SettingsService();
  for (const [key, value] of Object.entries(config.getInitialSettings()))
    settings.set(key, value);
  const runtimeId = 'skills-owner-' + randomUUID();
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
    tokenizer: configureProviderTokenizer(manager),
    oauth,
  };
}

async function acquireOwner(
  config: Config,
  mcp: McpRuntimeOwner,
  providers: SkillsProviders,
  media: SessionMediaOwner,
): Promise<SessionClientOwner> {
  const owner = await createCapturedSessionOwner(
    config,
    assembleTaskSchemaPolicy(providers.settings),
    providers.manager,
    buildAgentClientFactory(),
    media.store,
    mcp.readInstructions,
    mcp.workspacePaths,
    providers.settingsOwner,
    createRuntimeContentGeneratorFactory(),
    providers.tokenizer,
  );
  owner.bindMcpRuntime(mcp);
  owner.clients.bindProviderFiles(providers.files, (provider) =>
    providers.oauth.composeRetryOperations(provider),
  );
  owner.bindHooks();
  return owner;
}

async function activateAndStart(
  config: Config,
  mcp: McpRuntimeOwner,
  owner: SessionClientOwner,
  providers: SkillsProviders,
  selection: AgentConfig,
): Promise<AgentClientContract> {
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
    process.env.LLXPRT_FAKE_RESPONSES,
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
      () => owner.clients.refreshAuth(),
      settingsOwner,
    ),
    settings,
    manager,
    (method) => owner.clients.refreshAuth(method),
    assembleModelSelection(settingsOwner),
  );
  if (activation.authFailed) throw activation.authError;
  await owner.initializeTools();
  const clients = ownerClients(owner);
  const client = clients[clients.length - 1];
  await client.startChat();
  return client;
}

async function buildSelection(
  options: SkillsOwnerOptions,
  directory: string,
): Promise<AgentConfig> {
  return {
    provider: 'fake',
    model: 'fake-model',
    sessionId: randomUUID(),
    ...options.overrides,
    workingDir:
      options.overrides.workingDir === undefined
        ? directory
        : await realpath(options.overrides.workingDir),
  };
}

/**
 * Domain-level session for the workspace skill owner: a `SessionClientOwner`
 * built through its production `create` and bound to a production
 * `McpRuntimeOwner`, with the chat started. `client` is the last client the
 * owner's factory returned. The caller sets the fake-response replay seam.
 */
export async function openSkillsOwner(
  options: SkillsOwnerOptions,
): Promise<SkillsOwnerSession> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'skills-owner-')),
  );
  const selection = await buildSelection(options, directory);
  const config = new Config({
    ...toConfigParameters(selection),
    ...options.parameters,
    interactive: true,
  });
  const policy = new RuntimePolicyOwner(config);
  injectConfirmationForcingPolicy(policy.session.confirmation);
  const mcp = await buildTestMcpRuntime(
    config,
    policy.session.messageBus,
    selection,
    undefined,
    policy,
    options.operations,
  );
  const providers = acquireProviders(config, policy, mcp, options.authority);
  const media = new SessionMediaOwner(config.projectTempDir, 1024 * 1024);
  const owner = await acquireOwner(config, mcp, providers, media);
  const close = (): Promise<void> =>
    runCleanupSteps([
      () => owner.dispose(),
      () => providers.release.close(),
      () => media.dispose(),
      () => mcp.dispose(),
      () => policy.dispose(),
      () => config.dispose(),
      () => rm(directory, { recursive: true, force: true }),
    ]);
  try {
    const client = await activateAndStart(
      config,
      mcp,
      owner,
      providers,
      selection,
    );
    return {
      config,
      mcp,
      owner,
      client,
      skills: new SkillsControl(mcp.workspaceSkills.operations),
      close,
    };
  } catch (primary) {
    return cleanupAfterFailure(primary, close);
  }
}
