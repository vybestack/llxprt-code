/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type * as acp from '@agentclientprotocol/sdk';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import type { IOAuthSettingsProvider } from '@vybestack/llxprt-code-auth';
import type { ProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition.js';
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import {
  createAgentFromSettingsSnapshot,
  type Agent,
  type AgentConfig,
} from '@vybestack/llxprt-code-agents';
import {
  type Config,
  type ConfigParameters,
  type DebugLogger,
  type WorkspaceTrustControlPort,
  StandardFileSystemService,
  normalizeShellReplacement,
} from '@vybestack/llxprt-code-core';
import { UNCONFIGURED_PROVIDER } from '@vybestack/llxprt-code-core/config/models.js';
import { MCP_SESSION_APPROVAL_SOURCE } from '@vybestack/llxprt-code-core/policy/mcp-approval.js';
import { MCP_TRUSTED_POLICY_SOURCE } from '@vybestack/llxprt-code-core/policy/config.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IShellToolHost } from '@vybestack/llxprt-code-tools';
import { Session } from './zed-session.js';
import { enableZedSessionRecording } from './zed-agent-setup.js';
import {
  resumeAgentHistory,
  toLoadRequestError,
  type ChatSessionFileLister,
} from './zed-session-loader.js';
import { createZedTerminalTransport } from './zed-terminal-setup.js';
import { rethrowZedSessionFailure } from './zed-session-errors.js';
import type { IContent } from '@vybestack/llxprt-code-core';
import type { TerminalManager } from './zed-terminal-manager.js';
import type { ClientCapabilitiesWithSession } from './acp-types.js';
import { AcpFileSystemService } from './fileSystemService.js';
import { resolveSessionTargetDir } from './zed-session-config.js';

export type ZedHostInputs = Readonly<
  {
    storageRoot: string;
    fileFiltering: {
      respectGitIgnore: boolean;
      respectLlxprtIgnore: boolean;
      enableRecursiveFileSearch: boolean;
      disableFuzzySearch: boolean;
    };
  } & Pick<
    ConfigParameters,
    | 'debugMode'
    | 'outputFormat'
    | 'quiet'
    | 'sandbox'
    | 'embeddingModel'
    | 'includeDirectories'
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

export interface ZedSessionProviderInputs {
  readonly credentialAuthority?: CredentialAuthority;
  readonly providerContributions?: ProviderContributionRegistry;
  readonly oauthSettings?: IOAuthSettingsProvider | null;
}

export interface ZedSessionSelection {
  readonly provider: string | undefined;
  readonly model: string;
}

export function captureZedSessionParameters(
  host: Config,
  sessionId: string,
  targetDir: string,
  hostInputs: ZedHostInputs = captureZedHostInputs(host),
  selection: ZedSessionSelection = {
    provider: host.getProvider(),
    model: host.getModel(),
  },
): ConfigParameters {
  const policy = host.getPolicyEngineConfig();
  const mcpServers = host.getMcpServers();
  const hooks = host.getHooks();
  const projectHooks = host.getProjectHooks();
  const sanitizationConfig = host.getSanitizationConfig();
  return {
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
  };
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

export function captureZedAgentDeclaration(
  params: ConfigParameters,
): AgentConfig {
  return {
    provider: params.provider ?? UNCONFIGURED_PROVIDER,
    model: params.model,
    sessionId: params.sessionId,
    workingDir: params.targetDir,
    includeDirectories: params.includeDirectories,
    outputFormat: params.outputFormat,
    sandbox: params.sandbox,
    embeddingModel: params.embeddingModel,
    fileFiltering: params.fileFiltering,
    checkpointing: params.checkpointing,
    skillsSupport: params.skillsSupport,
    ide: { mode: params.ideMode },
    shell: normalizeShellReplacement(params.shellReplacement),
    interactive: params.interactive,
    telemetry: params.telemetry,
    maxSessionTurns: params.maxSessionTurns,
    hooks: params.hooks,
    projectHooks: params.projectHooks,
    disabledHooks: params.disabledHooks,
    disabledSkills: params.disabledSkills,
    adminSkillsEnabled: params.adminSkillsEnabled,
    approvalMode: params.approvalMode,
    folderTrust: params.trustedFolder,
    coreTools: params.coreTools,
    allowedTools: params.allowedTools,
    excludeTools: params.excludeTools,
    mcpServers: params.mcpServers,
    blockedMcpServers: params.blockedMcpServers,
    extensions: params.extensions,
    policy: params.policyEngineConfig,
    debugMode: params.debugMode,
    settings: {
      storageRoot: params.storageRoot,
      quiet: params.quiet,
      initialSettings: params.initialSettings,
      useRipgrep: params.useRipgrep,
      enableHooks: params.enableHooks,
      enableHooksUI: params.enableHooksUI,
      noBrowser: params.noBrowser,
      usageStatisticsEnabled: params.usageStatisticsEnabled,
      jitContextEnabled: params.jitContextEnabled,
      disableYoloMode: params.disableYoloMode,
      sanitizationConfig: params.sanitizationConfig,
      activeExtensions: params.activeExtensions,
    },
    harness: { includeProcessCwd: false, forceConfirmations: false },
  };
}

export async function buildZedSessionAgent(
  hostConfig: Config,
  hostInputs: ZedHostInputs,
  connection: acp.AgentSideConnection,
  capabilities: ClientCapabilitiesWithSession | undefined,
  sessionId: string,
  cwd: string | undefined,
  settingsSource: SettingsService,
  hostTrust: WorkspaceTrustControlPort,
  providerInputs: ZedSessionProviderInputs = {},
  executeShellCommand?: IShellToolHost['executeShellCommand'],
): Promise<Agent> {
  if (providerInputs.credentialAuthority === undefined)
    throw new Error(
      'ACP provider construction requires a credential authority',
    );
  const params = captureZedSessionParameters(
    hostConfig,
    sessionId,
    resolveSessionTargetDir(hostConfig, cwd),
    hostInputs,
  );
  const filesystemService = capabilities?.fs
    ? new AcpFileSystemService(
        connection,
        sessionId,
        capabilities.fs,
        new StandardFileSystemService(),
      )
    : undefined;
  return createAgentFromSettingsSnapshot(
    {
      ...captureZedAgentDeclaration(params),
      credentialAuthority: providerInputs.credentialAuthority,
      providerContributions: providerInputs.providerContributions,
      oauthSettings: providerInputs.oauthSettings,
      sessionOverrides: settingsSource.readSessionOverrides(),
      parentTrustPort: hostTrust,
      filesystemService,
      executeShellCommand,
    },
    settingsSource.exportForStateSnapshot(),
  );
}

export async function acquireZedSession(
  hostConfig: Config,
  hostInputs: ZedHostInputs,
  connection: acp.AgentSideConnection,
  capabilities: ClientCapabilitiesWithSession | undefined,
  sessionId: string,
  cwd: string | undefined,
  logger: DebugLogger,
  settingsSource: SettingsService,
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
    settingsSource,
    hostTrust,
    providerInputs,
  ).acquire(resume, fileLister);
}

class AcquiredZedSession {
  #agent!: Agent;
  readonly #terminals: TerminalManager | null;
  constructor(
    private readonly hostConfig: Config,
    private readonly hostInputs: ZedHostInputs,
    private readonly connection: acp.AgentSideConnection,
    private readonly capabilities: ClientCapabilitiesWithSession | undefined,
    private readonly sessionId: string,
    private readonly cwd: string | undefined,
    private readonly logger: DebugLogger,
    private readonly settingsSource: SettingsService,
    private readonly hostTrust: WorkspaceTrustControlPort,
    private readonly providerInputs: ZedSessionProviderInputs,
  ) {
    this.#terminals =
      capabilities?.terminal === true
        ? createZedTerminalTransport(
            sessionId,
            connection,
            resolveSessionTargetDir(hostConfig, cwd),
            logger,
            hostConfig.getInitialSettings()[
              'shell-output-retention-max-bytes'
            ] ?? settingsSource.get('shell-output-retention-max-bytes'),
          )
        : null;
  }
  private async initialize(): Promise<void> {
    const terminals = this.#terminals;
    const execute: IShellToolHost['executeShellCommand'] | undefined =
      terminals === null
        ? undefined
        : (command, directory, output, signal) =>
            terminals.executeShellCommand(command, directory, output, signal);
    try {
      this.#agent = await buildZedSessionAgent(
        this.hostConfig,
        this.hostInputs,
        this.connection,
        this.capabilities,
        this.sessionId,
        this.cwd,
        this.settingsSource,
        this.hostTrust,
        this.providerInputs,
        execute,
      );
    } catch (primary) {
      try {
        await terminals?.dispose();
      } catch (cleanup) {
        throw new AggregateError(
          [primary, cleanup],
          'ACP session startup and terminal cleanup failed',
        );
      }
      throw primary;
    }
  }
  async acquire(
    resume: boolean,
    fileLister: ChatSessionFileLister,
  ): Promise<{ session: Session; history: readonly IContent[] }> {
    await this.initialize();
    try {
      const history = resume
        ? await resumeAgentHistory(
            (id) => this.#agent.session.resume(id),
            this.sessionId,
            this.hostConfig.projectChatsDir,
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
      return { session: this.createSession(), history };
    } catch (primary) {
      const results = await Promise.allSettled([
        Promise.resolve().then(() => this.#agent.dispose()),
        Promise.resolve().then(() => this.#terminals?.dispose()),
      ]);
      rethrowZedSessionFailure(
        resume ? toLoadRequestError(this.sessionId, primary) : primary,
        results.flatMap((result) =>
          result.status === 'rejected' ? [result.reason] : [],
        ),
      );
    }
  }
  private createSession(): Session {
    const agent = this.#agent;
    const hostInputs = this.hostInputs;
    return new Session({
      id: this.sessionId,
      streamTurn: (input, options) => agent.stream(input, options),
      readModel: () => agent.getModel(),
      selectModel: (model) => agent.setModel(model),
      listModels: () => agent.listAvailableModels(),
      readContextLimit: () => agent.getProviderContextLimit(),
      readApprovalMode: () => agent.getApprovalMode(),
      writeApprovalMode: (mode) => agent.setApprovalMode(mode),
      readHistory: () => agent.getHistory(),
      compressHistory: (options) => agent.compress(options),
      retireAgent: () => agent.dispose(),
      lookupTool: (name) => agent.tools.get(name),
      listTools: () => agent.tools.list(),
      replyConfirmation: agent.tools.respondToConfirmation.bind(agent.tools),
      readTitle: () => agent.session.getRecordingTitle(),
      writeTitle: (title) => agent.session.recordRecordingTitle(title),
      readMemoryFiles: () => agent.memory.getFilePaths(),
      listProfiles: () => agent.profiles.list(),
      listTasks: () => agent.tasks.list(),
      readProjectRoot: () => agent.workspace.getProjectRoot(),
      readMaxTurns: () => hostInputs.maxSessionTurns ?? -1,
      readDebugMode: () => hostInputs.debugMode,
      readFiltering: () => ({
        respectGitIgnore: hostInputs.fileFiltering.respectGitIgnore,
        respectLlxprtIgnore: hostInputs.fileFiltering.respectLlxprtIgnore,
      }),
      readTargetDir: () => agent.workspace.getWorkingDirectory(),
      readRecursiveSearch: () =>
        hostInputs.fileFiltering.enableRecursiveFileSearch,
      readTextFile: (path) => agent.workspace.readTextFile(path),
      shouldIgnoreFile: (path, options) =>
        agent.workspace.shouldIgnoreFile(path, options),
      readIgnorePatterns: () => agent.workspace.getCoreIgnorePatterns(),
      readSetting: (key) => agent.getEphemeralSetting(key),
      writeSetting: (key, value) => agent.setEphemeralSetting(key, value),
      subscribeModelChanges: (listener) =>
        agent.settings.subscribeModelChanges(listener),
      connection: this.connection,
      configOptionsEnabled: this.capabilities?.session?.configOptions === true,
      terminals: this.#terminals,
    });
  }
}

export async function disposeZedSession(
  detach: () => void,
  terminals: TerminalManager | null,
  _logger: DebugLogger,
  abortPrompt: () => void,
  retireAgent: Agent['dispose'],
): Promise<void> {
  const failures: unknown[] = [];
  try {
    detach();
  } catch (error) {
    failures.push(error);
  }
  const terminalRelease = terminals?.dispose();
  try {
    abortPrompt();
  } catch (error) {
    failures.push(error);
  }
  try {
    await terminalRelease;
  } catch (error) {
    failures.push(error);
  }
  try {
    await retireAgent();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, 'ACP session release failed');
}
