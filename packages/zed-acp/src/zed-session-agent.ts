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
