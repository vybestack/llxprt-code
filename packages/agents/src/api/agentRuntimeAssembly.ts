import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import type { SettingsStateSnapshot } from '@vybestack/llxprt-code-settings';
import { runCleanupSteps } from '../core/subagent-cleanup.js';
import type { SchedulerConstruction } from '../session/assembleSchedulerOwner.js';
import { withChildToolDisplay } from '../session/childToolAssembly.js';
import { ChildToolDisplay } from '../session/childToolDisplay.js';
import {
  assembleTaskOwner,
  cleanupFailedShellBootstrap,
} from './agent-shell-assembly.js';
import {
  createStableDisplayCallbacks,
  recordOwnership,
  wrapApprovalHandler,
  type StableDisplayCallbacksHolder,
} from './agentBootstrap.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProviderManager } from '@vybestack/llxprt-code-providers';
import { SettingsService } from '@vybestack/llxprt-code-settings';

import type { AgentConfig } from './config-types.js';
import {
  acquirePreferredFiles,
  acquirePreferredProviderRuntime,
  acquirePreferredSettings,
  preparePreferredProviderCompletion,
} from './preferred-provider-acquisition.js';
import type { AgentRetainedProviderFile } from './provider-file-domain.js';

import type { SessionClientOwner } from '../session/session-client-owner.js';

/**
 * @plan:ISSUE-3222
 * @requirement:REQ-3222-AC2
 *
 * Agent-owned runtime assembly. The public Agent API (createAgent/fromConfig)
 * builds complete shipped runtimes itself: the agent client and task-tool registration factories, the runtime
 * managers, and the isolated-runtime Config for subagent runtimes. Defaults
 * are installed per-field ONLY where the Config reports absence — caller
 * supplied factories and managers always win. Nothing here registers into
 * module-global state.
 */

import type {
  ContentGenerator,
  RuntimeContentGeneratorFactory,
  RuntimeTokenizerFactory,
} from '@vybestack/llxprt-code-core';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import type { RuntimeKind } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import type {
  CredentialAuthority,
  OAuthManager,
} from '@vybestack/llxprt-code-providers/auth.js';
import { HostCredentialOwner } from '@vybestack/llxprt-code-providers/auth.js';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import {
  agentMcpAssemblyOptions,
  parseAgentConstruction,
} from './agent-construction-input.js';
import type { Agent } from './agent.js';
import type { AgentSchedulerHandle } from './config-types.js';
import { injectConfirmationForcingPolicy } from './confirmationForcing.js';
import type { CreatedAgentMcpOptions } from './createAgent.js';
import {
  activateCreatedSession,
  cleanupFailedCreatedAgent,
  initializeCreatedClient,
  prepareAgentConfig,
  startAgentSession,
} from './createAgent.js';
import { resolveSchedulerFactory } from '../session/assembleSchedulerOwner.js';
import {
  assembleHostGitHubBroker,
  type HostGitHubBrokerOwner,
} from './host-github-broker-owner.js';
import {
  assembleShellOwner,
  publishLeafFacade,
  type FacadeParsedConfig,
  type LeafFacadeValues,
} from './agent-facade.js';
import type {
  AgentRuntimeMcpPort,
  McpTeardownPort,
} from './mcpRuntimePorts.js';
import {
  assembleOwnedMcpRuntime,
  bindCreatedSessionClient,
} from './policyComposition.js';
import { prepareImageConstruction } from './session-image-assembly.js';
import { prepareTransferredWorkspaceOwners } from './transferred-workspace-owners.js';

export async function disposeIsolatedMediaRuntime(
  closeRuntime: () => void | Promise<void>,
  closeMedia: () => Promise<void>,
  closeClient: (() => Promise<void>) | undefined,
): Promise<void> {
  const clients = await Promise.allSettled([closeClient?.()]);
  const results = await Promise.allSettled([closeRuntime()]);
  const mediaResults = await Promise.allSettled([closeMedia()]);
  const failures = [...clients, ...results, ...mediaResults].flatMap(
    (result) => (result.status === 'rejected' ? [result.reason] : []),
  );
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, 'Isolated media runtime cleanup failed');
}

interface PreferredWorkspace {
  readonly raw: AgentConfig;
  readonly authority: CredentialAuthority;
  readonly construction: ReturnType<typeof parseAgentConstruction>;
  readonly config: Config;
  readonly policyOwner: RuntimePolicyOwner;
  readonly media: SessionMediaOwner;
  readonly schedulerFactory: SchedulerConstruction;
  readonly mcpOptions: CreatedAgentMcpOptions;
}

interface PreferredSettings {
  readonly settings: SettingsService;
  readonly settingsOwner: SessionSettingsOwner;
}

interface PreferredProvider {
  readonly files: ProviderFileLifecycle;
  readonly manager: ProviderManager;
  readonly tokenizerFactory: RuntimeTokenizerFactory;
  readonly contentGeneratorFactory: RuntimeContentGeneratorFactory<ContentGenerator>;
  readonly release: AcquisitionRelease;
  readonly inheritedTrustRelease: AcquisitionRelease;
  readonly handles: AgentSchedulerHandle[];
}

interface PreferredAuth {
  readonly oauth: OAuthManager;
}

interface ActivatedPreferredClient {
  readonly client: SessionClientOwner;
  readonly parsed: FacadeParsedConfig;
}

export class PreferredAgentAssembly {
  private readonly schedulerHandles: AgentSchedulerHandle[] = [];
  private readonly inheritedTrustRelease = new AcquisitionRelease();
  private readonly workspaceRelease = new AcquisitionRelease();

  constructor(
    private readonly rawConfig: AgentConfig,
    private readonly retainedFiles: readonly AgentRetainedProviderFile[],
    private readonly settingsSnapshot: SettingsStateSnapshot | undefined,
  ) {}

  async assemble(): Promise<Agent> {
    const fakeResponses = process.env.LLXPRT_FAKE_RESPONSES;
    // Everything the caller transferred is owned from here on, so host
    // credential acquisition sits inside the same rollback as the rest.
    const images = prepareImageConstruction(this.rawConfig.imageOperation);
    const owners = prepareTransferredWorkspaceOwners(this.rawConfig);
    let github: HostGitHubBrokerOwner | undefined;
    let agent: Agent;
    try {
      github = assembleHostGitHubBroker(this.rawConfig);
      const authority =
        this.rawConfig.credentialAuthority ??
        new HostCredentialOwner(process.env).authority;
      const input = {
        ...this.rawConfig,
        credentialAuthority: authority,
        imageOperation: images.selection,
      };
      const workspace = await this.initializeWorkspace(input, authority);
      const providers = await this.acquireProviders(workspace, fakeResponses);
      agent = await providers.finish({ github, transferred: owners });
    } catch (primary) {
      const failures: unknown[] = [];
      for (const cleanup of [
        () => github?.cleanupFailedConstruction(),
        () => images.cleanupFailedConstruction(),
        () => owners.cleanupFailedConstruction(),
      ]) {
        try {
          await cleanup();
        } catch (failure) {
          failures.push(failure);
        }
      }
      if (failures.length > 0)
        throw new AggregateError(
          [primary, ...failures],
          'createAgent GitHub cleanup failed',
        );
      throw primary;
    }
    return startAgentSession(agent);
  }

  private async initializeWorkspace(
    raw: AgentConfig,
    authority: CredentialAuthority,
  ): Promise<PreferredWorkspace> {
    try {
      const construction = parseAgentConstruction(raw);
      const workspace = this.constructWorkspace(raw, construction);
      return { raw, authority, construction, ...workspace };
    } catch (primary) {
      return rejectPreferredAcquisition(
        primary,
        () => this.workspaceRelease.rollback(),
        async () => {},
      );
    }
  }

  private constructWorkspace(
    raw: AgentConfig,
    construction: ReturnType<typeof parseAgentConstruction>,
  ): Pick<
    PreferredWorkspace,
    'config' | 'policyOwner' | 'media' | 'schedulerFactory' | 'mcpOptions'
  > {
    const { parsed, runtimeId, suppliedMediaOwner } = construction;
    const { params, forceConfirmations } = prepareAgentConfig(
      parsed,
      runtimeId,
    );
    const schedulerFactory = resolveSchedulerFactory(
      forceConfirmations,
      raw.toolSchedulerFactory,
      this.schedulerHandles,
    );
    const config = new Config({
      ...params,
      includeDirectories: [
        ...(params.includeDirectories ?? []),
        ...((parsed.harness?.includeProcessCwd ?? true) ? [process.cwd()] : []),
      ],
    });
    const trustPort = this.acquireWorkspaceTrust(raw);
    const policyOwner = new RuntimePolicyOwner(config, trustPort);
    this.workspaceRelease.acquire('policy', () => policyOwner.dispose());
    if (forceConfirmations)
      injectConfirmationForcingPolicy(policyOwner.session.confirmation);
    const media =
      suppliedMediaOwner ??
      new SessionMediaOwner(
        config.projectTempDir,
        config.getMediaStoreQuotaByteLimit(),
      );
    this.workspaceRelease.acquire('policy', () => media.dispose());
    const mcpOptions = agentMcpAssemblyOptions(raw, construction, trustPort);
    return { config, policyOwner, media, schedulerFactory, mcpOptions };
  }

  private acquireWorkspaceTrust(raw: AgentConfig): AgentConfig['trustPort'] {
    const parent = raw.parentTrustPort;
    if (parent === undefined) return raw.trustPort;
    const trust = new WorkspaceTrustLifecycle({
      localTrust: parent.isTrustedFolder(),
    });
    this.inheritedTrustRelease.acquire('policy', () => trust.dispose());
    this.workspaceRelease.acquire('policy', () =>
      this.inheritedTrustRelease.rollback(),
    );
    const stop = parent.subscribeTrustChange((transition) => {
      void trust.setTrustedFolderLive(transition.trusted);
    });
    this.inheritedTrustRelease.acquire('policy', stop);
    return trust;
  }

  private async acquireProviders(
    workspace: PreferredWorkspace,
    fakeResponses: string | undefined,
  ): Promise<PreferredProviderAssembly> {
    const { config, raw, construction, authority, policyOwner } = workspace;
    const { parsed, runtimeId, tokenStore: suppliedStore } = construction;
    const release = new AcquisitionRelease();
    try {
      const settings =
        raw.sessionOverrides === undefined
          ? new SettingsService()
          : SettingsService.withReadOnlySessionOverrides(raw.sessionOverrides);
      if (this.settingsSnapshot !== undefined)
        settings.restoreFromStateSnapshot(this.settingsSnapshot);
      const settingsOwner = acquirePreferredSettings(
        config,
        settings,
        parsed,
        release,
      );
      const files = await acquirePreferredFiles(
        config,
        runtimeId,
        this.retainedFiles,
        release,
      );
      return await acquirePreferredProviderRuntime(
        release,
        { config, settings, settingsOwner, files, runtimeId, authority },
        {
          suppliedStore,
          messageBus: policyOwner.session.messageBus,
          profileReads: raw.definitionOwner?.profileReads,
          oauthSettings: raw.oauthSettings,
        },
        async (manager, oauth) => {
          const tokenizerFactory = configureProviderTokenizer(
            manager,
            raw.tokenizerFactory,
          );
          const contentGeneratorFactory =
            raw.contentGeneratorFactory ??
            createRuntimeContentGeneratorFactory();
          await preparePreferredProviderCompletion(
            config,
            settings,
            settingsOwner,
            manager,
            oauth,
            runtimeId,
            tokenizerFactory,
            raw.providerContributions,
            fakeResponses,
          );
          return new PreferredProviderAssembly(
            workspace,
            { settings, settingsOwner },
            {
              files,
              manager,
              tokenizerFactory,
              contentGeneratorFactory,
              release,
              inheritedTrustRelease: this.inheritedTrustRelease,
              handles: this.schedulerHandles,
            },
            { oauth },
          );
        },
      );
    } catch (primary) {
      return rejectPreferredAcquisition(
        primary,
        () => release.close(),
        () => this.workspaceRelease.rollback(),
      );
    }
  }
}

class PreferredProviderAssembly {
  constructor(
    private readonly workspace: PreferredWorkspace,
    private readonly settings: PreferredSettings,
    private readonly provider: PreferredProvider,
    private readonly auth: PreferredAuth,
  ) {}

  async finish({
    github,
    transferred,
  }: {
    readonly github: HostGitHubBrokerOwner | undefined;
    readonly transferred: ReturnType<typeof prepareTransferredWorkspaceOwners>;
  }): Promise<Agent> {
    const { config, policyOwner, mcpOptions, media, construction, raw } =
      this.workspace;
    const { settings, settingsOwner } = this.settings;
    const { manager, contentGeneratorFactory, tokenizerFactory, files } =
      this.provider;
    const { oauth } = this.auth;
    let client: SessionClientOwner | undefined;
    let disposeMcpRuntime = async (): Promise<void> => policyOwner.dispose();
    try {
      const mcpRuntime = await assembleOwnedMcpRuntime(
        config,
        {
          ...mcpOptions,
          onTransferAccepted: () => transferred.handOffToMcp(),
        },
        policyOwner,
        settingsOwner,
      );
      disposeMcpRuntime = () => mcpRuntime.dispose();
      client = await bindCreatedSessionClient(
        config,
        settings,
        settingsOwner,
        manager,
        oauth,
        contentGeneratorFactory,
        tokenizerFactory,
        files,
        media,
        mcpRuntime,
        (construction.parsed.harness?.forceConfirmations ?? true) &&
          config.isInteractive(),
        mcpOptions.imageOperation,
        this.workspace.authority,
      );
      if (raw.executeShellCommand !== undefined)
        client.toolCatalog.bindShellExecution(raw.executeShellCommand);
      const activated = await this.initializeCreatedAgent(
        mcpRuntime,
        client,
        github,
      );
      return await this.#acquireFacade(mcpRuntime, activated);
    } catch (primaryError) {
      return cleanupFailedCreatedAgent(
        primaryError,
        () =>
          releasePreferredProviders(
            this.provider.release,
            this.provider.inheritedTrustRelease,
          ),
        media,
        client,
        disposeMcpRuntime,
      );
    }
  }

  private async initializeCreatedAgent(
    mcpRuntime: AgentRuntimeMcpPort,
    client: SessionClientOwner,
    github: HostGitHubBrokerOwner | undefined,
  ): Promise<ActivatedPreferredClient> {
    const { construction, config, policyOwner } = this.workspace;
    const { settings, settingsOwner } = this.settings;
    const { manager } = this.provider;
    const { oauth } = this.auth;
    await initializeCreatedClient(client, github);
    const activationOutcome = await activateCreatedSession(
      construction.parsed,
      construction.resolvedAuth,
      config,
      settings,
      settingsOwner,
      manager,
      oauth,
      (): RuntimeKind => 'agent',
      policyOwner.session.messageBus,
      mcpRuntime,
      client,
    );
    return {
      client,
      parsed: { ...construction.parsed, ...activationOutcome },
    };
  }

  async #acquireFacade(
    mcpRuntime: AgentRuntimeMcpPort,
    { client, parsed }: ActivatedPreferredClient,
  ): Promise<Agent> {
    const { construction, config, media, schedulerFactory } = this.workspace;
    const { handles, manager, release, inheritedTrustRelease } = this.provider;
    const { settings, settingsOwner } = this.settings;
    const { oauth } = this.auth;
    const tasks = assembleTaskOwner(settings, undefined);
    const shell = assembleShellOwner(settings);
    const child = new ChildToolDisplay();
    const display: StableDisplayCallbacksHolder = {};
    try {
      const editors = { editorCallbacks: construction.editorCallbacks ?? {} };
      client.toolCatalog.bindChildExecution(child, tasks, shell);
      client.clients.initializeExecution(
        withChildToolDisplay(schedulerFactory, child, tasks, shell),
        construction.onApproval
          ? wrapApprovalHandler(construction.onApproval)
          : undefined,
        createStableDisplayCallbacks(editors, display),
      );
      client.clients.conversationBinding.initializeConversation();
      const facadeConstruction = {
        parsed,
        baseUrl: construction.resolvedAuth.baseUrl,
        handles,
        tasks,
        shell,
        child,
        editors,
        display,
      };
      return publishLeafFacade(
        mcpRuntime,
        config,
        client,
        settingsOwner,
        media,
        settings,
        manager,
        oauth,
        facadeConstruction,
        facadeInputsForPreferred(
          mcpRuntime,
          release,
          inheritedTrustRelease,
          construction.runtimeId,
          construction.onOAuthPrompt,
          handles,
        ),
      );
    } catch (primary) {
      return cleanupFailedShellBootstrap(primary, tasks, shell);
    }
  }
}

async function releasePreferredProviders(
  release: AcquisitionRelease,
  inheritedTrustRelease: AcquisitionRelease,
): Promise<void> {
  await runCleanupSteps([
    () => release.close(),
    () => inheritedTrustRelease.rollback(),
  ]);
}

function facadeInputsForPreferred(
  runtime: McpTeardownPort,
  release: AcquisitionRelease,
  inheritedTrustRelease: AcquisitionRelease,
  runtimeId: string,
  onOAuthPrompt: AgentConfig['onOAuthPrompt'],
  handles: AgentSchedulerHandle[],
): LeafFacadeValues {
  const closeRuntime = (): Promise<void> =>
    releasePreferredProviders(release, inheritedTrustRelease);
  return {
    runtimeId,
    readRuntimeKind: () => 'agent',
    ownership: recordOwnership({
      injectedSchedulerHandles: handles,
      disposeMcpRuntime: () => runtime.dispose(),
    }),
    sessionIdentityOwnership: 'config',
    onOAuthPrompt,
    closeRuntime,
    awaitMcpDiscovery: () => runtime.awaitDiscovery(),
    closeMcpAdmission: () => runtime.closeAdmission(),
  };
}

async function rejectPreferredAcquisition(
  primary: unknown,
  closeProviderResources: () => Promise<void>,
  closeSessionResources: () => Promise<void>,
): Promise<never> {
  const results = await Promise.allSettled([
    closeProviderResources(),
    Promise.resolve().then(closeSessionResources),
  ]);
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length > 0)
    throw new AggregateError(
      [primary, ...failures],
      'Preferred Agent acquisition cleanup failed',
    );
  throw primary;
}
