/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20260214-SESSIONBROWSER.P29
 */

import type {
  AgentProfilePreflight,
  AgentActivationOperation,
  AgentProfileApplication,
} from '@vybestack/llxprt-code-agents';
import type {
  ApprovalMode,
  Config,
  LlxprtExtension,
  MCPServerConfig,
  PolicyEngineConfig,
  SandboxConfig,
  SessionSettingsOwner,
  ProviderSwitcher,
} from '@vybestack/llxprt-code-core';
import process from 'node:process';

import { type CliArgs } from './cliArgParser.js';
import type { ExtensionEnablementManager } from './extensions/extensionEnablement.js';
import { resolveMcpServers } from './mcpServerConfig.js';
import {
  resolveDeclarativeCliConfig,
  type DeclarativeCliConfig,
} from './declarativeCliConfig.js';
import { loadSandboxConfig } from './sandboxConfig.js';
import {
  loadSettings,
  type MergedSettings,
  type Settings,
} from './settings.js';

import { buildConfig } from './configBuilder.js';
import { finalizeConfig } from './postConfigRuntime.js';
import type { ProfileLoadResult } from './profileResolution.js';
import { resolveProviderAndModel } from './providerModelResolver.js';

type ConfigBuildPieces = {
  context: ContextResolutionResult;
  memoryContent: string;
  fileCount: number;
  filePaths: string[];
  mcpServers: Record<string, MCPServerConfig>;
  blockedMcpServers: ReadonlyArray<{ name: string; extensionName: string }>;
  reloadMcpServers: () => Promise<{
    mcpServers: Record<string, MCPServerConfig>;
    blockedMcpServers: Array<{ name: string; extensionName: string }>;
    settingsMcpServers: Record<string, MCPServerConfig>;
  }>;
  approvalMode: ApprovalMode;
  providerModel: ReturnType<typeof resolveProviderAndModel>;
  sandboxConfig: SandboxConfig | undefined;
  profileSettingsWithTools: Settings;
  excludeTools: readonly string[];
  policyEngineConfig: PolicyEngineConfig;
  question: string;
  screenReader: boolean;
  useRipgrepSetting: boolean | undefined;
  mcpEnabled: boolean;
  extensionsEnabled: boolean;
  adminSkillsEnabled: boolean;
  outputFormat: Parameters<typeof buildConfig>[0]['outputFormat'];
  quiet: boolean;
  allowedTools: readonly string[];
};

import type { ContextResolutionResult } from './interactiveContext.js';

/** Values `loadCliConfig` reads once while it builds the Config. */
export interface CliConfigLoadInput {
  readonly settings: Settings;
  readonly extensions: LlxprtExtension[];
  readonly extensionEnablementManager: ExtensionEnablementManager;
  readonly sessionId: string;
  readonly argv: CliArgs;
  readonly cwd: string;
  readonly preflight: AgentProfilePreflight;
  /** An externally owned settings owner the preflight prepares its workspace over. */
  readonly settingsOwner?: SessionSettingsOwner;
}

/**
 * Hand-offs `loadCliConfig` makes while the Config is being finalized.
 * `activationBootstrap` is the only one that changes what happens: when present
 * the preflight's post-config activation is transferred to it, and when absent
 * the preflight keeps the activation for the caller to transfer or finish.
 */
export interface CliConfigReadyCallbacks {
  readonly activationBootstrap?: (operation: AgentActivationOperation) => void;
  readonly profileApplication: (application: AgentProfileApplication) => void;
  readonly providerSwitch: (switchProvider: ProviderSwitcher) => void;
  readonly preflight: (operation: AgentProfilePreflight) => void;
}

const ignore = (): void => undefined;

export const ignoreReady: CliConfigReadyCallbacks = {
  profileApplication: ignore,
  providerSwitch: ignore,
  preflight: ignore,
};

// ─── Orchestrator ────────────────────────────────────────────────────────────

/** Step 8: Resolve provider/model, sync to SettingsService */
function resolveProviderModelSelection(
  argv: CliArgs,
  profileMergedSettings: MergedSettings,
  profileResult: ProfileLoadResult,
  runtimeState: AgentProfilePreflight,
) {
  const providerModel = resolveProviderAndModel({
    cliProvider: argv.provider,
    profileProvider: profileResult.profileProvider,
    envDefaultProvider: process.env.LLXPRT_DEFAULT_PROVIDER,
    cliModel: argv.model,
    profileModel: profileResult.profileModel,
    settingsModel: profileMergedSettings.model,
    envDefaultModel: process.env.LLXPRT_DEFAULT_MODEL,
    envProviderModel: process.env.GEMINI_MODEL,
    providerDefaultModel: runtimeState.readProviderDefaultModel('gemini'),
  });
  if (
    providerModel.provider !== undefined &&
    providerModel.model &&
    providerModel.model.trim() !== ''
  ) {
    runtimeState.chooseProviderModel(
      providerModel.provider,
      providerModel.model,
    );
  }
  return providerModel;
}

function applyStartupMcpProfileOverrides(
  refreshedSettings: Settings,
  startupSettings: Settings,
  profileMergedSettings: Settings,
): Settings {
  return {
    ...refreshedSettings,
    mcpServers:
      profileMergedSettings.mcpServers === startupSettings.mcpServers
        ? refreshedSettings.mcpServers
        : profileMergedSettings.mcpServers,
    allowMCPServers:
      profileMergedSettings.allowMCPServers === startupSettings.allowMCPServers
        ? refreshedSettings.allowMCPServers
        : profileMergedSettings.allowMCPServers,
    excludeMCPServers:
      profileMergedSettings.excludeMCPServers ===
      startupSettings.excludeMCPServers
        ? refreshedSettings.excludeMCPServers
        : profileMergedSettings.excludeMCPServers,
  };
}

async function resolveConfigBuildPieces(
  argv: CliArgs,
  settings: Settings,
  declarative: DeclarativeCliConfig,
  runtimeState: AgentProfilePreflight,
  cwd: string,
): Promise<ConfigBuildPieces> {
  const {
    context,
    profileResult,
    mcpServers,
    blockedMcpServers,
    approvalMode,
    intermediate,
  } = declarative;
  const profileMergedSettings = profileResult.profileMergedSettings;
  const memoryContent = '';
  const fileCount = 0;
  const filePaths: string[] = [];
  const providerModel = resolveProviderModelSelection(
    argv,
    profileMergedSettings,
    profileResult,
    runtimeState,
  );
  const sandboxConfig = await loadSandboxConfig(profileMergedSettings, argv);
  const reloadMcpServers = async () => {
    if (!intermediate.mcpEnabled) {
      return {
        mcpServers: {},
        blockedMcpServers: [],
        settingsMcpServers: {},
      };
    }
    const refreshedSettings = loadSettings(cwd).merged;
    const reloadedSettings = applyStartupMcpProfileOverrides(
      refreshedSettings,
      settings,
      profileMergedSettings,
    );
    return {
      ...resolveMcpServers(
        reloadedSettings,
        context,
        argv.allowedMcpServerNames,
      ),
      settingsMcpServers: reloadedSettings.mcpServers ?? {},
    };
  };

  return {
    context,
    memoryContent,
    fileCount,
    filePaths,
    mcpServers,
    blockedMcpServers,
    reloadMcpServers,
    approvalMode,
    providerModel,
    sandboxConfig,
    ...intermediate,
  };
}

function buildLoadedConfig(
  sessionId: string,
  cwd: string,
  argv: CliArgs,
  pieces: ConfigBuildPieces,
  initialSettings: Record<string, unknown>,
): Config {
  return buildConfig({
    sessionId,
    cwd,
    initialSettings,
    argv,
    profileSettingsWithTools: pieces.profileSettingsWithTools,
    context: pieces.context,
    approvalMode: pieces.approvalMode,
    providerModel: pieces.providerModel,
    sandboxConfig: pieces.sandboxConfig,
    mcpServers: pieces.mcpServers,
    blockedMcpServers: pieces.blockedMcpServers,
    excludeTools: pieces.excludeTools,
    memoryContent: pieces.memoryContent,
    fileCount: pieces.fileCount,
    filePaths: pieces.filePaths,
    policyEngineConfig: pieces.policyEngineConfig,
    question: pieces.question,
    screenReader: pieces.screenReader,
    useRipgrepSetting: pieces.useRipgrepSetting,
    mcpEnabled: pieces.mcpEnabled,
    extensionsEnabled: pieces.extensionsEnabled,
    adminSkillsEnabled: pieces.adminSkillsEnabled,
    outputFormat: pieces.outputFormat,
    quiet: pieces.quiet,
    allowedTools: pieces.allowedTools,
  });
}

/**
 * @plan PLAN-20251020-STATELESSPROVIDER3.P06
 * @requirement REQ-SP3-001
 *
 * Orchestrates the full CLI config loading pipeline (17-step ordering).
 * Each step delegates to a focused module — see 00-overview.md.
 */
export async function loadCliConfig(
  input: CliConfigLoadInput,
  onReady: CliConfigReadyCallbacks,
): Promise<Config> {
  const {
    settings,
    extensions,
    extensionEnablementManager,
    sessionId,
    argv,
    cwd,
    preflight: runtimeState,
    settingsOwner,
  } = input;
  const declarative = await resolveDeclarativeCliConfig({
    settings,
    argv,
    cwd,
    extensions,
    extensionEnablementManager,
  });
  const { bootstrap, profileResult } = declarative;
  const bootstrapArgs = bootstrap.bootstrapArgs;
  const profileMergedSettings = profileResult.profileMergedSettings;
  onReady.preflight(runtimeState);

  const pieces = await resolveConfigBuildPieces(
    argv,
    settings,
    declarative,
    runtimeState,
    cwd,
  );
  // The Config must bind to the SAME SettingsService the bootstrap runtime
  // registered — Config construction never adopts ambient state (issue #2300).
  const config = buildLoadedConfig(
    sessionId,
    cwd,
    argv,
    pieces,
    runtimeState.captureSettings(),
  );

  return finalizeConfig(
    {
      bindMcpSettings: () =>
        bindSelectedMcpSettings(settingsOwner ?? runtimeState, pieces),
      config,
      runtimeState,
      bootstrapArgs,
      argv,
      settings,
      profileSettingsWithTools: pieces.profileSettingsWithTools,
      profileLoadResult: profileResult,
      providerModelResult: pieces.providerModel,
      defaultDisabledTools: profileMergedSettings.defaultDisabledTools ?? [],
      approvalMode: pieces.approvalMode,
      interactive: pieces.context.interactive,
    },
    settingsOwner,
    onReady.activationBootstrap,
    onReady.profileApplication,
    onReady.providerSwitch,
    false,
  );
}

function bindSelectedMcpSettings(
  owner: Pick<AgentProfilePreflight, 'bindMcpSettings'>,
  pieces: ConfigBuildPieces,
): void {
  owner.bindMcpSettings(
    {
      mcpServers: pieces.mcpServers,
      blockedMcpServers: [...pieces.blockedMcpServers],
      settingsMcpServers: pieces.profileSettingsWithTools.mcpServers ?? {},
    },
    pieces.reloadMcpServers,
  );
}
