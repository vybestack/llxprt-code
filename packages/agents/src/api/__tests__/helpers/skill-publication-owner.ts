/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import type { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
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
import { injectConfirmationForcingPolicy } from '../../confirmationForcing.js';
import { assembleModelSelection } from '../../model-selection.js';
import { preparePreferredProviderCompletion } from '../../preferred-provider-acquisition.js';
import {
  acquirePreferredOAuth,
  acquirePreferredProviderManager,
} from './provider-acquisition.js';
import { executeProviderActivation } from '../../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../../providerSwitchAssembly.js';
import type { McpRuntimeOwner } from '../../mcpRuntimeAssembly.js';
import { buildTestMcpRuntime } from './mcp-owner-fixture.js';
import {
  createCapturedSessionOwner,
  ownerClients,
} from './session-client-capture.js';

export interface OpenedSkillPublicationOwner {
  readonly owner: SessionClientOwner;
  readonly client: AgentClientContract;
  readonly mcp: McpRuntimeOwner;
  readonly close: () => Promise<void>;
}

interface ProviderStack {
  readonly config: Config;
  readonly settings: SettingsService;
  readonly settingsOwner: SessionSettingsOwner;
  readonly policy: RuntimePolicyOwner;
  readonly mcp: McpRuntimeOwner;
  readonly runtimeId: string;
  readonly release: AcquisitionRelease;
  readonly files: ProviderFileLifecycle;
  readonly manager: ReturnType<typeof acquirePreferredProviderManager>;
  readonly oauth: ReturnType<typeof acquirePreferredOAuth>;
  readonly tokenizer: ReturnType<typeof configureProviderTokenizer>;
}

async function acquireProviderStack(
  authority: CredentialAuthority,
  workspace: string,
  skillOperations: WorkspaceSkillAssemblyOperations,
): Promise<ProviderStack> {
  const config = new Config(
    toConfigParameters({
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      workingDir: workspace,
      skillsSupport: true,
    }),
  );
  const settings = new SettingsService();
  for (const [key, value] of Object.entries(config.getInitialSettings()))
    settings.set(key, value);
  const policy = new RuntimePolicyOwner(config);
  injectConfirmationForcingPolicy(policy.session.confirmation);
  const mcp = await buildTestMcpRuntime(
    config,
    policy.session.messageBus,
    {},
    undefined,
    policy,
    skillOperations,
  );
  const runtimeId = 'skill-publication-' + randomUUID();
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
    config,
    settings,
    settingsOwner,
    policy,
    mcp,
    runtimeId,
    release,
    files,
    manager,
    oauth,
    tokenizer: configureProviderTokenizer(manager),
  };
}

async function activateAndStart(
  stack: ProviderStack,
  owner: SessionClientOwner,
): Promise<AgentClientContract> {
  const { config, settings, settingsOwner, manager, oauth, mcp } = stack;
  await preparePreferredProviderCompletion(
    config,
    settings,
    settingsOwner,
    manager,
    oauth,
    stack.runtimeId,
    stack.tokenizer,
    undefined,
    process.env.LLXPRT_FAKE_RESPONSES,
  );
  await mcp.initialize();
  const result = await executeProviderActivation(
    config,
    { provider: 'fake', model: 'fake-model' },
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
  if (result.authFailed) throw result.authError;
  await owner.initializeTools();
  const clients = ownerClients(owner);
  const client = clients[clients.length - 1];
  await client.startChat();
  return client;
}

/**
 * The domain-level stack of `openClientOwner` with the two inputs that helper
 * does not expose: the `skillOperations` the foreground assembly passes the
 * MCP runtime from the host (`AgentForegroundHost.skillPolicy` and
 * `registerSkillTools`), and the `McpRuntimeOwner` whose workspace skills the
 * test reloads. `client` is the last client the owner's factory returned, with
 * its chat started; `Config` is built over `workspace`.
 */
export async function openSkillPublicationOwner(
  authority: CredentialAuthority,
  workspace: string,
  skillOperations: WorkspaceSkillAssemblyOperations,
): Promise<OpenedSkillPublicationOwner> {
  const stack = await acquireProviderStack(
    authority,
    workspace,
    skillOperations,
  );
  const { config, settings, mcp } = stack;
  const media = new SessionMediaOwner(config.projectTempDir, 1024 * 1024);
  const owner = await createCapturedSessionOwner(
    config,
    assembleTaskSchemaPolicy(settings),
    stack.manager,
    buildAgentClientFactory(),
    media.store,
    mcp.readInstructions,
    mcp.workspacePaths,
    stack.settingsOwner,
    createRuntimeContentGeneratorFactory(),
    stack.tokenizer,
  );
  owner.bindMcpRuntime(mcp);
  owner.clients.bindProviderFiles(stack.files, (provider) =>
    stack.oauth.composeRetryOperations(provider),
  );
  owner.bindHooks();
  const close = (): Promise<void> =>
    runCleanupSteps([
      () => owner.dispose(),
      () => stack.release.close(),
      () => media.dispose(),
      () => mcp.dispose(),
      () => stack.policy.dispose(),
      () => config.dispose(),
    ]);
  try {
    const client = await activateAndStart(stack, owner);
    return { owner, client, mcp, close };
  } catch (primary) {
    return cleanupAfterFailure(primary, close);
  }
}
