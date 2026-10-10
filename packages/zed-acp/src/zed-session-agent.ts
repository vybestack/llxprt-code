/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type {
  createProviderManager,
  ProviderContributionRegistry,
} from '@vybestack/llxprt-code-providers/composition.js';
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import type { WorkspaceTrustControlPort } from '@vybestack/llxprt-code-core';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';

import { createZedWorkspace } from './zed-workspace.js';
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
  readonly providerContributions?: ProviderContributionRegistry;
  readonly oauthSettings?: NonNullable<
    Parameters<typeof createProviderManager>[1]['oauthSettings']
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

export interface ZedSessionAgent {
  agent: Agent;
  config: Config;
  files: WorkspaceFilesystemOwner['files'];
  ignore: WorkspaceFilesystemOwner['ignore'];
  terminals: TerminalManager | null;
  disposeConfig: () => Promise<void>;
  settingsOwner: SessionSettingsOwner;
}

export async function buildZedSessionAgent(
  hostConfig: Config,
  hostInputs: ZedHostInputs,
  connection: acp.AgentSideConnection,
  capabilities: ClientCapabilitiesWithSession | undefined,
  sessionId: string,
  cwd: string | undefined,
  logger: DebugLogger,
  settingsService: SettingsService,
  hostTrust: WorkspaceTrustControlPort,
  providerInputs: ZedSessionProviderInputs = {},
): Promise<ZedSessionAgent> {
  const trust = createSessionTrust(hostTrust);
  const { sessionConfig, filesystem } = createZedWorkspace(
    hostConfig,
    hostInputs,
    connection,
    capabilities,
    sessionId,
    cwd,
    trust,
    readZedSessionSelection(settingsService, hostConfig),
  );
  const settingsOwner = new SessionSettingsOwner(settingsService);
  const policy = new RuntimePolicyOwner(sessionConfig, trust);
  let disposeManager: () => void | Promise<void> = () => {};
  const disposeConfig = sessionWorkspaceDisposer(
    settingsOwner,
    bindSessionTrust(hostTrust, trust),
    joinProviderPolicy(() => disposeManager(), policy),
    sessionConfig,
    filesystem,
    trust,
  );
  let terminalSetup: ReturnType<typeof buildZedTerminalSetup> | undefined;
  let agent: Agent | undefined;
  try {
    const { manager, oauthManager } = await composeSessionProviderManager(
      { sessionConfig, sessionId, settingsService, policy },
      providerInputs,
    );
    disposeManager = () => manager.dispose();
    agent = await fromConfig({
      ...sessionPolicyInput(settingsService, settingsOwner, policy, trust),
      config: sessionConfig,
      filesystemOwner: filesystem,
      filesystemOwnership: 'agent',
      providerManager: manager,
      ...sessionProviderInput(oauthManager, sessionId),
      prepareSessionTools: (config, messageBus, tools) => {
        if (capabilities?.terminal !== true) return;
        terminalSetup = buildZedTerminalSetup(
          sessionId,
          config,
          tools,
          connection,
          logger,
          messageBus,
          filesystem.paths,
          settingsOwner,
          trust,
        );
        const shell = terminalSetup.registry.getTool(ShellTool.Name);
        if (shell) tools.registerTool(shell);
      },
    });
  } catch (error) {
    await settleFailedSession(error, agent, terminalSetup, disposeConfig);
    throw error;
  }
  return {
    agent,
    config: sessionConfig,
    files: filesystem.files,
    ignore: filesystem.ignore,
    terminals: terminalSetup?.terminals ?? null,
    disposeConfig,
    settingsOwner,
  };
}

function sessionProviderInput(oauthManager: OAuthManager, sessionId: string) {
  return { oauthManager, sessionId };
}

async function composeSessionProviderManager(
  session: {
    sessionConfig: Config;
    sessionId: string;
    settingsService: SettingsService;
    policy: RuntimePolicyOwner;
  },
  providerInputs: ZedSessionProviderInputs,
) {
  const { sessionConfig: config, sessionId, settingsService, policy } = session;
  const { createProviderManager, NodeFileSystem } = await import(
    '@vybestack/llxprt-code-providers/composition.js'
  );
  const { manager, oauthManager } = createProviderManager(
    {
      config,
      settingsService,
      runtimeId: sessionId,
    },
    {
      config,
      fileSystem: new NodeFileSystem(),
      runtimeMessageBus: policy.session.messageBus,
      ...(providerInputs.oauthSettings === undefined
        ? {}
        : { oauthSettings: providerInputs.oauthSettings }),
      ...(providerInputs.providerContributions === undefined
        ? {}
        : { providerContributions: providerInputs.providerContributions }),
    },
  );
  return { manager, oauthManager };
}

async function disposeSessionInfrastructure(
  disposeManager: () => void | Promise<void>,
  config: Config,
): Promise<void> {
  const managers = await Promise.allSettled([
    Promise.resolve().then(disposeManager),
  ]);
  const configs = await Promise.allSettled([config.dispose()]);
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
  agent: Agent | undefined,
  terminalSetup: ReturnType<typeof buildZedTerminalSetup> | undefined,
  disposeConfig: () => Promise<void>,
): Promise<void> {
  const clients = await Promise.allSettled([
    agent?.dispose(),
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
  agent: Pick<Agent, 'dispose'>,
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
      await agent.dispose();
    } finally {
      await disposeConfig();
    }
  }
}

function sessionWorkspaceDisposer(
  settingsOwner: SessionSettingsOwner,
  stopTrustUpdates: () => void,
  disposeManager: () => void | Promise<void>,
  sessionConfig: Config,
  filesystem: WorkspaceFilesystemOwner,
  trust: WorkspaceTrustLifecycle,
): () => Promise<void> {
  let disposal: Promise<void> | undefined;
  const disposeConfig = (): Promise<void> => {
    disposal ??= retireSessionWorkspace([
      () => settingsOwner.closeAdmission(),
      stopTrustUpdates,
      () => disposeSessionInfrastructure(disposeManager, sessionConfig),
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

function sessionPolicyInput(
  settingsService: SettingsService,
  settingsOwner: SessionSettingsOwner,
  policyOwner: RuntimePolicyOwner,
  trustPort: WorkspaceTrustControlPort,
) {
  return {
    settingsService,
    settingsOwner,
    policyOwner,
    messageBus: policyOwner.session.messageBus,
    trustPort,
  };
}
