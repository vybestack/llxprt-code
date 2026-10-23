/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20260214-SESSIONBROWSER.P29
 */

import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type {
  AgentProfilePreflight,
  AgentActivationOperation,
  AgentProfileApplication,
} from '@vybestack/llxprt-code-agents';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import type { ProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition.js';
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
import { loadSandboxConfig } from './sandboxConfig.js';
import {
  loadSettings,
  type MergedSettings,
  type Settings,
} from './settings.js';

// @plan:PLAN-20251020-STATELESSPROVIDER3.P04
import {
  parseBootstrapArgs,
  prepareRuntimeForProfile,
} from './profileBootstrap.js';

import { resolveApprovalMode } from './approvalModeResolver.js';
import { buildConfig, resolveProxy } from './configBuilder.js';
import { loadEnvironment } from './environmentLoader.js';
import { resolveContextAndEnvironment } from './interactiveContext.js';
import { resolveIntermediateConfig } from './intermediateConfig.js';
import { finalizeConfig } from './postConfigRuntime.js';
import {
  loadAndPrepareProfile,
  resolveProfileToLoad,
  type ProfileLoadResult,
} from './profileResolution.js';
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

// ─── Orchestrator ────────────────────────────────────────────────────────────

/** Steps 1-3: Bootstrap runtime and resolve profile */
async function bootstrapAndLoadProfile(
  settings: Settings,
  argv: CliArgs,
  preflight: AgentProfilePreflight | undefined,
  settingsService: SettingsService | undefined,
  authority: CredentialAuthority | undefined,
  contributions: ProviderContributionRegistry | undefined,
  onPreflightReady: ((operation: AgentProfilePreflight) => void) | undefined,
) {
  const bootstrapParsed = parseBootstrapArgs();
  const parsedWithOverrides = {
    bootstrapArgs: bootstrapParsed.bootstrapArgs,
    runtimeMetadata: {
      ...bootstrapParsed.runtimeMetadata,
      proxy: resolveProxy(argv.proxy),
    },
  };
  const bootstrapArgs = parsedWithOverrides.bootstrapArgs;
  const runtimeState =
    preflight ??
    (await prepareRuntimeForProfile(
      parsedWithOverrides,
      authority,
      settingsService,
      undefined,
      contributions,
    ));
  onPreflightReady?.(runtimeState);

  const { profileToLoad, profileExplicitlySpecified } = resolveProfileToLoad({
    bootstrapArgs,
    settings,
    cliProvider: argv.provider,
  });
  const profileResult = await loadAndPrepareProfile({
    bootstrapArgs,
    settings,
    argv,
    profileToLoad,
    profileExplicitlySpecified,
  });
  return { bootstrapArgs, runtimeState, profileResult };
}

/** Steps 7-8: Resolve approval mode and provider/model, sync to SettingsService */
function resolveApprovalAndProvider(
  argv: CliArgs,
  profileMergedSettings: MergedSettings,
  context: ContextResolutionResult,
  profileResult: ProfileLoadResult,
  runtimeState: AgentProfilePreflight,
) {
  const securitySettings = (profileMergedSettings as Partial<MergedSettings>)
    .security;
  const approvalMode = resolveApprovalMode({
    cliApprovalMode: argv.approvalMode,
    cliYolo: argv.yolo,
    disableYoloMode: securitySettings?.disableYoloMode,
    secureModeEnabled: profileMergedSettings.admin?.secureModeEnabled,
    trustedFolder: context.trustedFolder,
  });
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
  return { approvalMode, providerModel };
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
  profileMergedSettings: MergedSettings,
  profileResult: ProfileLoadResult,
  runtimeState: AgentProfilePreflight,
  cwd: string,
  extensions: LlxprtExtension[],
  extensionEnablementManager: ExtensionEnablementManager,
): Promise<ConfigBuildPieces> {
  const context = resolveContextAndEnvironment({
    argv,
    profileMergedSettings,
    originalSettings: settings,
    cwd,
    extensions,
    extensionEnablementManager,
  });
  const memoryContent = '';
  const fileCount = 0;
  const filePaths: string[] = [];
  const { mcpServers, blockedMcpServers } = resolveMcpServers(
    profileMergedSettings,
    context,
    argv.allowedMcpServerNames,
  );
  const { approvalMode, providerModel } = resolveApprovalAndProvider(
    argv,
    profileMergedSettings,
    context,
    profileResult,
    runtimeState,
  );
  const intermediate = await resolveIntermediateConfig(
    argv,
    settings,
    profileMergedSettings,
    context,
    approvalMode,
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
  settings: Settings,
  extensions: LlxprtExtension[],
  extensionEnablementManager: ExtensionEnablementManager,
  sessionId: string,
  argv: CliArgs,
  cwd: string = process.cwd(),
  preflight?: AgentProfilePreflight,
  settingsService?: SettingsService,
  settingsOwner?: SessionSettingsOwner,
  authority?: CredentialAuthority,
  contributions?: ProviderContributionRegistry,
  onActivationBootstrapReady?: (operation: AgentActivationOperation) => void,
  onProfileApplicationReady?: (application: AgentProfileApplication) => void,
  onProviderSwitchReady?: (switchProvider: ProviderSwitcher) => void,
  onPreflightReady?: (operation: AgentProfilePreflight) => void,
): Promise<Config> {
  loadEnvironment();
  const { bootstrapArgs, runtimeState, profileResult } =
    await bootstrapAndLoadProfile(
      settings,
      argv,
      preflight,
      settingsService,
      authority,
      contributions,
      onPreflightReady,
    );
  const profileMergedSettings = profileResult.profileMergedSettings;

  const pieces = await resolveConfigBuildPieces(
    argv,
    settings,
    profileMergedSettings,
    profileResult,
    runtimeState,
    cwd,
    extensions,
    extensionEnablementManager,
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
    onActivationBootstrapReady,
    onProfileApplicationReady,
    onProviderSwitchReady,
    preflight === undefined,
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
