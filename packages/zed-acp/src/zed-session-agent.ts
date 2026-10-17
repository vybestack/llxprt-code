/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import {
  createProviderManager,
  NodeFileSystem,
  type ProviderContributionRegistry,
} from '@vybestack/llxprt-code-providers/composition.js';
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import type { WorkspaceTrustControlPort } from '@vybestack/llxprt-code-core';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';

import { createZedWorkspace } from './zed-workspace.js';
import { Session } from './zed-session.js';
import { enableZedSessionRecording } from './zed-agent-setup.js';
import {
  resumeAgentHistory,
  type ChatSessionFileLister,
} from './zed-session-loader.js';
import type { IContent } from '@vybestack/llxprt-code-core';
import type { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type * as acp from '@agentclientprotocol/sdk';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import {
  Config,
  type ConfigParameters,
  DebugLogger,
} from '@vybestack/llxprt-code-core';
import { MCP_SESSION_APPROVAL_SOURCE } from '@vybestack/llxprt-code-core/policy/mcp-approval.js';
import { MCP_TRUSTED_POLICY_SOURCE } from '@vybestack/llxprt-code-core/policy/config.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { ShellTool } from '@vybestack/llxprt-code-tools';

import { buildZedTerminalSetup } from './zed-terminal-setup.js';
import type { TerminalManager } from './zed-terminal-manager.js';
import type { ClientCapabilitiesWithSession } from './acp-types.js';

export type ZedHostInputs = Readonly<
  { storageRoot: string } & Pick<
    ConfigParameters,
    | 'debugMode'
    | 'outputFormat'
    | 'quiet'
    | 'sandbox'
    | 'embeddingModel'
    | 'includeDirectories'
    | 'fileFiltering'
    | 'checkpointing'
    | 'useRipgrep'
    | 'skillsSupport'
    | 'enableHooks'
    | 'enableHooksUI'
    | 'ideMode'
    | 'noBrowser'
    | 'shellReplacement'
    | 'interactive'
    | 'telemetry'
    | 'usageStatisticsEnabled'
    | 'maxSessionTurns'
    | 'jitContextEnabled'
    | 'disableYoloMode'
  >
>;

export function captureZedHostInputs(host: Config): ZedHostInputs {
  return {
    debugMode: host.getDebugMode(),
    storageRoot: host.storageRoot,
    outputFormat: host.getOutputFormat(),
    quiet: host.getQuiet(),
    sandbox: host.getSandbox(),
    embeddingModel: host.getEmbeddingModel(),
    includeDirectories: [...host.getConfiguredIncludeDirectories()],
    fileFiltering: {
      respectGitIgnore: host.getFileFilteringRespectGitIgnore(),
      respectLlxprtIgnore: host.getFileFilteringRespectLlxprtIgnore(),
      enableRecursiveFileSearch: host.getEnableRecursiveFileSearch(),
      disableFuzzySearch: host.getFileFilteringDisableFuzzySearch(),
    },
    checkpointing: host.getCheckpointingEnabled(),
    useRipgrep: host.getUseRipgrep(),
    skillsSupport: host.isSkillsSupportEnabled(),
    enableHooks: host.getEnableHooks(),
    enableHooksUI: host.getEnableHooksUI(),
    ideMode: host.getIdeMode(),
    noBrowser: host.getNoBrowser(),
    shellReplacement: host.getShellReplacement(),
    interactive: host.isInteractive(),
    telemetry: { ...host.getTelemetrySettings() },
    usageStatisticsEnabled: host.getUsageStatisticsEnabled(),
    maxSessionTurns: host.getMaxSessionTurns(),
    jitContextEnabled: host.isJitContextEnabled(),
    disableYoloMode: host.getDisableYoloMode(),
  };
}

/**
 * Provider assembly inputs owned by the ACP connection. Omitting them yields a
 * built-ins-only provider set and an OAuth manager without a settings surface.
 */
export interface ZedSessionProviderInputs {
  readonly credentialAuthority?: CredentialAuthority;
  readonly providerContributions?: ProviderContributionRegistry;
  readonly oauthSettings?: NonNullable<
    Parameters<typeof createProviderManager>[9]
  >;
}

/** The provider/model the connection currently has selected. */
export interface ZedSessionSelection {
  readonly provider: string | undefined;
  readonly model: string;
}

export function readZedSessionSelection(
  settings: SettingsService,
  host: Config,
): ZedSessionSelection {
  const active = settings.get('activeProvider');
  if (typeof active !== 'string' || active.length === 0)
    return { provider: host.getProvider(), model: host.getModel() };
  const model = settings.getProviderSettings(active).model;
  return {
    provider: active,
    model:
      typeof model === 'string' && model.length > 0 ? model : host.getModel(),
  };
}

export function createZedSessionConfig(
  host: Config,
  sessionId: string,
  targetDir: string,
  hostInputs: ZedHostInputs = captureZedHostInputs(host),
  selection: ZedSessionSelection = {
    provider: host.getProvider(),
    model: host.getModel(),
  },
): Config {
  const policy = host.getPolicyEngineConfig();
  const mcpServers = host.getMcpServers();
  const hooks = host.getHooks();
  const projectHooks = host.getProjectHooks();
  const sanitizationConfig = host.getSanitizationConfig();
  const sessionConfig = new Config({
    ...hostInputs,
    sessionId,
    targetDir,
    cwd: targetDir,
    initialSettings: host.getInitialSettings(),
    model: selection.model,
    provider: selection.provider,
    hooks: hooks === undefined ? undefined : structuredClone(hooks),
    projectHooks:
      projectHooks === undefined ? undefined : structuredClone(projectHooks),
    disabledHooks: host.getDisabledHooks(),
    sanitizationConfig:
      sanitizationConfig === undefined
        ? undefined
        : structuredClone(sanitizationConfig),
    disabledSkills: host.getDisabledSkills(),
    adminSkillsEnabled: host.isAdminSkillsEnabled(),
    approvalMode: host.getApprovalMode(),
    trustedFolder: host.initialWorkspaceTrust,
    coreTools: host.getCoreTools()?.slice(),
    allowedTools: host.getAllowedTools()?.slice(),
    excludeTools: host.getExcludeTools()?.slice(),
    mcpServers: mcpServers
      ? Object.fromEntries(
          Object.entries(mcpServers).map(([name, server]) => [
            name,
            { ...server },
          ]),
        )
      : undefined,
    blockedMcpServers: host.getBlockedMcpServers()?.map((entry) => ({
      ...entry,
    })),
    extensions: host.getExtensions().map((extension) => ({ ...extension })),
    activeExtensions: host.getActiveExtensions().map((extension) => ({
      ...extension,
    })),
    policyEngineConfig: {
      rules: (policy.rules ?? []).filter(
        (rule) =>
          rule.source !== MCP_SESSION_APPROVAL_SOURCE &&
          rule.source !== MCP_TRUSTED_POLICY_SOURCE,
      ),
      defaultDecision: policy.defaultDecision,
      nonInteractive: policy.nonInteractive,
    },
  });
  return sessionConfig;
}

/**
 * Uses the host's trust port when supplied, otherwise creates (and returns, so
 * the caller can dispose) a lifecycle seeded from the Config's initial trust.
 */
export function resolveZedHostTrust(
  config: Config,
  hostTrust: WorkspaceTrustControlPort | undefined,
): {
  trust: WorkspaceTrustControlPort;
  owned: WorkspaceTrustLifecycle | undefined;
} {
  if (hostTrust !== undefined) return { trust: hostTrust, owned: undefined };
  const owned = new WorkspaceTrustLifecycle({
    localTrust: config.initialWorkspaceTrust,
  });
  return { trust: owned, owned };
}

export async function acquireZedSession(
  hostConfig: Config,
  hostInputs: ZedHostInputs,
  connection: acp.AgentSideConnection,
  capabilities: ClientCapabilitiesWithSession | undefined,
  sessionId: string,
  cwd: string | undefined,
  logger: DebugLogger,
  settingsService: SettingsService,
  settingsOwner: SessionSettingsOwner,
  hostTrust: WorkspaceTrustControlPort,
  providerInputs: ZedSessionProviderInputs,
  resume: boolean,
  fileLister: ChatSessionFileLister,
): Promise<{ session: Session; history: readonly IContent[] }> {
  return new AcquiredZedSession(
    hostConfig,
    hostInputs,
    connection,
    capabilities,
    sessionId,
    cwd,
    logger,
    settingsService,
    settingsOwner,
    hostTrust,
    providerInputs,
  ).acquire(resume, fileLister);
}

class AcquiredZedSession {
  readonly #trust: WorkspaceTrustLifecycle;
  readonly #config: Config;
  readonly #filesystem: WorkspaceFilesystemOwner;
  readonly #policy: RuntimePolicyOwner;
  readonly #disposeConfig: () => Promise<void>;
  #disposeManager: () => void | Promise<void> = () => {};
  #terminalSetup: ReturnType<typeof buildZedTerminalSetup> | undefined;
  #agent!: Agent;
  #retireAgent: (() => Promise<void>) | undefined;
  constructor(
    hostConfig: Config,
    hostInputs: ZedHostInputs,
    private readonly connection: acp.AgentSideConnection,
    private readonly capabilities: ClientCapabilitiesWithSession | undefined,
    private readonly sessionId: string,
    cwd: string | undefined,
    private readonly logger: DebugLogger,
    private readonly settingsService: SettingsService,
    private readonly settingsOwner: SessionSettingsOwner,
    hostTrust: WorkspaceTrustControlPort,
    private readonly providerInputs: ZedSessionProviderInputs,
  ) {
    this.#trust = createSessionTrust(hostTrust);
    const { sessionConfig, filesystem } = createZedWorkspace(
      hostConfig,
      hostInputs,
      connection,
      capabilities,
      sessionId,
      cwd,
      this.#trust,
      readZedSessionSelection(settingsService, hostConfig),
    );
    this.#config = sessionConfig;
    this.#filesystem = filesystem;
    this.#policy = new RuntimePolicyOwner(sessionConfig, this.#trust);
    this.#disposeConfig = sessionWorkspaceDisposer(
      settingsOwner,
      bindSessionTrust(hostTrust, this.#trust),
      joinProviderPolicy(() => this.#disposeManager(), this.#policy),
      () => sessionConfig.dispose(),
      filesystem,
      this.#trust,
    );
  }
  async acquire(
    resume: boolean,
    fileLister: ChatSessionFileLister,
  ): Promise<{ session: Session; history: readonly IContent[] }> {
    try {
      await this.initialize();
      return await this.publish(resume, fileLister);
    } catch (error) {
      await settleFailedSession(
        error,
        this.#retireAgent,
        this.#terminalSetup,
        this.#disposeConfig,
      );
      throw error;
    }
  }
  private async initialize(): Promise<void> {
    if (this.providerInputs.credentialAuthority === undefined)
      throw new Error('ACP session requires explicit credential authority');
    const { manager, oauthManager } = createProviderManager(
      this.settingsService,
      { runtimeId: this.sessionId },
      this.#config,
      this.providerInputs.credentialAuthority,
      new NodeFileSystem(),
      undefined,
      undefined,
      undefined,
      undefined,
      this.providerInputs.oauthSettings,
      this.#policy.session.messageBus,
      undefined,
      undefined,
      undefined,
      this.providerInputs.providerContributions,
    );
    this.#disposeManager = () => manager.dispose();
    this.#agent = await fromConfig({
      settingsService: this.settingsService,
      settingsOwner: this.settingsOwner,
      policyOwner: this.#policy,
      messageBus: this.#policy.session.messageBus,
      trustPort: this.#trust,
      config: this.#config,
      filesystemOwner: this.#filesystem,
      filesystemOwnership: 'agent',
      providerManager: manager,
      oauthManager,
      sessionId: this.sessionId,
      credentialAuthority: this.providerInputs.credentialAuthority,
      prepareSessionTools: (config, messageBus, tools) => {
        if (this.capabilities?.terminal !== true) return;
        this.#terminalSetup = buildZedTerminalSetup(
          this.sessionId,
          config,
          tools,
          this.connection,
          this.logger,
          messageBus,
          this.#filesystem.paths,
          this.settingsOwner,
          this.#trust,
        );
        const shell = this.#terminalSetup.registry.getTool(ShellTool.Name);
        if (shell) tools.registerTool(shell);
      },
    });
    this.#retireAgent = () => this.#agent.dispose();
  }
  private async publish(
    resume: boolean,
    fileLister: ChatSessionFileLister,
  ): Promise<{ session: Session; history: readonly IContent[] }> {
    const config = this.#config;
    const history = resume
      ? await resumeAgentHistory(
          (id) => this.#agent.session.resume(id),
          this.sessionId,
          config,
          fileLister,
        )
      : [];
    if (!resume)
      await enableZedSessionRecording(
        () => this.#agent.session.setRecording({ enabled: true }),
        (error) =>
          this.logger.debug(
            () => `Recording failed for ${this.sessionId}: ${error}`,
          ),
      );
    const session = new Session(
      this.sessionId,
      (input, options) => this.#agent.stream(input, options),
      () => this.#agent.getModel(),
      (model) => this.#agent.setModel(model),
      () => this.#agent.listAvailableModels(),
      () => this.#agent.getProviderContextLimit(),
      () => this.#agent.getApprovalMode(),
      (mode) => this.#agent.setApprovalMode(mode),
      () => this.#agent.getHistory(),
      (options) => this.#agent.compress(options),
      () => this.#agent.dispose(),
      (name) => this.#agent.tools.get(name),
      () => this.#agent.tools.list(),
      this.#agent.tools.respondToConfirmation.bind(this.#agent.tools),
      () => this.#agent.session.getRecordingTitle(),
      (title) => this.#agent.session.recordRecordingTitle(title),
      () => this.#agent.memory.getFilePaths(),
      () => this.#agent.profiles.list(),
      () => this.#agent.tasks.list(),
      config.getProjectRoot.bind(config),
      config.getMaxSessionTurns.bind(config),
      config.getDebugMode.bind(config),
      config.getFileFilteringOptions.bind(config),
      config.getTargetDir.bind(config),
      config.getEnableRecursiveFileSearch.bind(config),
      this.#filesystem.files.readTextFile.bind(this.#filesystem.files),
      this.#filesystem.ignore.shouldIgnoreFile.bind(this.#filesystem.ignore),
      this.#filesystem.ignore.getCoreIgnorePatterns.bind(
        this.#filesystem.ignore,
      ),
      (key) => this.#agent.getEphemeralSetting(key),
      (key, value) => this.#agent.setEphemeralSetting(key, value),
      this.settingsOwner.subscribeModelChanges.bind(this.settingsOwner),
      this.connection,
      this.capabilities?.session?.configOptions === true,
      this.#terminalSetup?.terminals ?? null,
      this.#disposeConfig,
    );
    return { session, history };
  }
}

async function disposeSessionInfrastructure(
  disposeManager: () => void | Promise<void>,
  retireConfig: () => Promise<void>,
): Promise<void> {
  const managers = await Promise.allSettled([
    Promise.resolve().then(disposeManager),
  ]);
  const configs = await Promise.allSettled([retireConfig()]);
  const failures = [...managers, ...configs].flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      'ACP session infrastructure cleanup failed',
    );
}
async function settleFailedSession(
  error: unknown,
  retireAgent: (() => Promise<void>) | undefined,
  terminalSetup: ReturnType<typeof buildZedTerminalSetup> | undefined,
  disposeConfig: () => Promise<void>,
): Promise<void> {
  const clients = await Promise.allSettled([
    retireAgent?.(),
    terminalSetup?.terminals.settleAll(),
  ]);
  const infrastructure = await Promise.allSettled([disposeConfig()]);
  const failures = [...clients, ...infrastructure].flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length > 0)
    throw new AggregateError(
      [error, ...failures],
      'ACP session startup and cleanup failed',
    );
}

async function retireSessionWorkspace(
  releases: ReadonlyArray<() => void | Promise<void>>,
): Promise<void> {
  const failures: unknown[] = [];
  for (const release of releases) {
    try {
      await release();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      'ACP session infrastructure cleanup failed',
    );
}

export async function disposeZedSession(
  detach: () => void,
  terminals: TerminalManager | null,
  logger: DebugLogger,
  abortPrompt: () => void,
  retireAgent: Agent['dispose'],
  disposeConfig: () => Promise<void>,
): Promise<void> {
  try {
    detach();
    await terminals
      ?.settleAll()
      .catch((error) =>
        logger.debug(() => `Terminal cleanup failed: ${error}`),
      );
    abortPrompt();
  } finally {
    try {
      await retireAgent();
    } finally {
      await disposeConfig();
    }
  }
}

function sessionWorkspaceDisposer(
  settingsOwner: SessionSettingsOwner,
  stopTrustUpdates: () => void,
  disposeManager: () => void | Promise<void>,
  retireConfig: () => Promise<void>,
  filesystem: WorkspaceFilesystemOwner,
  trust: WorkspaceTrustLifecycle,
): () => Promise<void> {
  let disposal: Promise<void> | undefined;
  const disposeConfig = (): Promise<void> => {
    disposal ??= retireSessionWorkspace([
      () => settingsOwner.closeAdmission(),
      stopTrustUpdates,
      () => disposeSessionInfrastructure(disposeManager, retireConfig),
      () => settingsOwner.dispose(),
      () => filesystem.dispose(),
      () => trust.dispose(),
    ]);
    return disposal;
  };
  return disposeConfig;
}

function bindSessionTrust(
  host: WorkspaceTrustControlPort,
  session: WorkspaceTrustLifecycle,
): () => void {
  return host.subscribeTrustChange((transition) => {
    session.setTrustedFolderLive(transition.trusted).catch((error: unknown) => {
      new DebugLogger('llxprt:zed-integration:trust').error(() =>
        String(error),
      );
    });
  });
}

function createSessionTrust(
  host: WorkspaceTrustControlPort,
): WorkspaceTrustLifecycle {
  return new WorkspaceTrustLifecycle({ localTrust: host.isTrustedFolder() });
}

function joinProviderPolicy(
  disposeManager: () => void | Promise<void>,
  policy: RuntimePolicyOwner,
): () => Promise<void> {
  return async () => {
    try {
      await disposeManager();
    } finally {
      await policy.dispose();
    }
  };
}
