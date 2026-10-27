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
import { releaseAdoptedFileScope } from '../../adoption-release.js';
import { toConfigParameters } from '../../agentConfig.adapter.js';
import { buildAgentClientFactory } from '../../agentBootstrap.js';
import type { SessionClientOwner } from '../../../session/session-client-owner.js';
import type { AgentConfig } from '../../config-types.js';
import { injectConfirmationForcingPolicy } from '../../confirmationForcing.js';
import type { McpRuntimeOwner } from '../../mcpRuntimeAssembly.js';
import { assembleModelSelection } from '../../model-selection.js';
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

export interface SkillWorkspaceSessionOptions {
  readonly authority: CredentialAuthority;
  /** `AgentConfig` fields the `Config` and the MCP runtime are built from. */
  readonly overrides: Readonly<Partial<AgentConfig>>;
  readonly parameters?: Pick<
    ConfigParameters,
    'enableExtensionReloading' | 'storageRoot'
  >;
  /** Absent: the production skill operations. */
  readonly operations?: WorkspaceSkillAssemblyOperations;
}

/**
 * One workspace root at the domain level: the `Config`, the `McpRuntimeOwner`
 * with its workspace skill and extension owners, and the session client the
 * `SessionClientOwner` built through its production `create`. `client` is the
 * last client the owner's factory returned, the one `startChat()` ran on.
 * `close` runs every step and reports the failures together.
 */
export interface SkillWorkspaceSession {
  readonly config: Config;
  readonly mcp: McpRuntimeOwner;
  readonly client: AgentClientContract;
  readonly close: () => Promise<void>;
}

function buildConfig(
  options: SkillWorkspaceSessionOptions,
  selection: AgentConfig,
): Config {
  const parameters = {
    ...toConfigParameters(selection),
    ...options.parameters,
  };
  parameters.interactive = true;
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

interface Providers {
  readonly settings: SettingsService;
  readonly settingsOwner: SessionSettingsOwner;
  readonly runtimeId: string;
  readonly release: AcquisitionRelease;
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
): Providers {
  const settings = new SettingsService();
  for (const [key, value] of Object.entries(config.getInitialSettings()))
    settings.set(key, value);
  const runtimeId = 'skill-workspace-' + randomUUID();
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
    settingsOwner,
    runtimeId,
    release,
    files,
    manager,
    tokenizer: configureProviderTokenizer(manager),
    oauth,
  };
}

async function activateAndStart(
  config: Config,
  selection: AgentConfig,
  mcp: McpRuntimeOwner,
  providers: Providers,
  owner: SessionClientOwner,
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

/**
 * The provider is selected by the `LLXPRT_FAKE_RESPONSES` replay seam, which
 * the suite sets with `useFakeResponsesReplay`.
 */
export async function openSkillWorkspaceSession(
  options: SkillWorkspaceSessionOptions,
): Promise<SkillWorkspaceSession> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'skill-workspace-session-')),
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
  const config = buildConfig(options, selection);
  const policy = new RuntimePolicyOwner(config);
  injectConfirmationForcingPolicy(policy.session.confirmation);
  const mcp = await buildTestMcpRuntime(
    config,
    policy.session.messageBus,
    options.overrides,
    undefined,
    policy,
    options.operations,
  );
  const providers = acquireProviders(config, policy, mcp, options.authority);
  const media = new SessionMediaOwner(
    config.projectTempDir,
    1024 * 1024 * 1024,
  );
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
  const close = (): Promise<void> =>
    runCleanupSteps([
      () => owner.dispose(),
      () => providers.release.close(),
      () => media.dispose(),
      () => mcp.dispose(),
      () => config.dispose(),
      () => rm(directory, { recursive: true, force: true }),
    ]);
  try {
    const client = await activateAndStart(
      config,
      selection,
      mcp,
      providers,
      owner,
    );
    return { config, mcp, client, close };
  } catch (primary) {
    return cleanupAfterFailure(primary, close);
  }
}
