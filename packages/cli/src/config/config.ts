/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20260214-SESSIONBROWSER.P29
 */

import process from 'node:process';
import type {
  ApprovalMode,
  PolicyEngineConfig,
  Config,
  LlxprtExtension,
  SandboxConfig,
  MCPServerConfig,
} from '@vybestack/llxprt-code-core';
import type { SettingsService } from '@vybestack/llxprt-code-settings';

import { type MergedSettings, type Settings } from './settings.js';
import { loadSandboxConfig } from './sandboxConfig.js';
import { resolveMcpServers } from './mcpServerConfig.js';
import { type CliArgs } from './cliArgParser.js';
import type { ExtensionEnablementManager } from './extensions/extensionEnablement.js';

// @plan:PLAN-20251020-STATELESSPROVIDER3.P04
import {
  parseBootstrapArgs,
  prepareRuntimeForProfile,
  type BootstrapRuntimeState,
} from './profileBootstrap.js';

import {
  resolveProfileToLoad,
  loadAndPrepareProfile,
  type ProfileLoadResult,
} from './profileResolution.js';
import { resolveContextAndEnvironment } from './interactiveContext.js';
import { loadEnvironment, resolveMemoryContent } from './environmentLoader.js';
import { resolveApprovalMode } from './approvalModeResolver.js';
import { resolveProviderAndModel } from './providerModelResolver.js';
import { buildConfig } from './configBuilder.js';
import { finalizeConfig } from './postConfigRuntime.js';
import { resolveIntermediateConfig } from './intermediateConfig.js';

type ConfigBuildPieces = {
  context: ContextResolutionResult;
  memoryContent: string;
  fileCount: number;
  filePaths: string[];
  mcpServers: Record<string, MCPServerConfig>;
  blockedMcpServers: ReadonlyArray<{ name: string; extensionName: string }>;
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
  allowedTools: readonly string[];
};

import type { ContextResolutionResult } from './interactiveContext.js';

// ─── Orchestrator ────────────────────────────────────────────────────────────

/** Steps 1-3: Bootstrap runtime and resolve profile */
async function bootstrapAndLoadProfile(
  settings: Settings,
  argv: CliArgs,
  runtimeOverrides: { settingsService?: SettingsService },
) {
  const bootstrapParsed = parseBootstrapArgs();
  const parsedWithOverrides = {
    bootstrapArgs: bootstrapParsed.bootstrapArgs,
    runtimeMetadata: {
      ...bootstrapParsed.runtimeMetadata,
      settingsService:
        runtimeOverrides.settingsService ??
        bootstrapParsed.runtimeMetadata.settingsService,
    },
  };
  const bootstrapArgs = parsedWithOverrides.bootstrapArgs;
  const runtimeState = await prepareRuntimeForProfile(parsedWithOverrides);

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
  runtimeState: BootstrapRuntimeState,
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
    envGeminiModel: process.env.GEMINI_MODEL,
  });
  if (providerModel.model && providerModel.model.trim() !== '') {
    runtimeState.runtime.settingsService.setProviderSetting(
      providerModel.provider,
      'model',
      providerModel.model,
    );
  }
  return { approvalMode, providerModel };
}

async function resolveConfigBuildPieces(
  argv: CliArgs,
  settings: Settings,
  profileMergedSettings: MergedSettings,
  profileResult: ProfileLoadResult,
  runtimeState: BootstrapRuntimeState,
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
  const { memoryContent, fileCount, filePaths } = await resolveMemoryContent(
    cwd,
    context,
    profileMergedSettings,
  );
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

  return {
    context,
    memoryContent,
    fileCount,
    filePaths,
    mcpServers,
    blockedMcpServers,
    approvalMode,
    providerModel,
    sandboxConfig,
    ...intermediate,
  };
}

/**
 * Narrow the bootstrap runtime's structural settings state to the
 * SettingsService surface Config consumes (profileBootstrap resolves it via
 * resolveRuntimeSettingsService). Fails fast with a clear message instead of
 * letting a malformed runtime surface as an opaque error inside buildConfig.
 */
function isSettingsServiceLike(
  value: unknown,
): value is { get: unknown; set: unknown } {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as { get?: unknown; set?: unknown };
  return (
    typeof candidate.get === 'function' && typeof candidate.set === 'function'
  );
}

function requireBootstrapSettingsService(
  runtimeState: BootstrapRuntimeState,
): SettingsService {
  // The runtime is assembled upstream via type assertions, so the static type
  // cannot be trusted here — validate the value structurally as unknown.
  const settingsService: unknown = runtimeState.runtime.settingsService;
  if (!isSettingsServiceLike(settingsService)) {
    throw new Error(
      '[config] Bootstrap runtime is missing its SettingsService. ' +
        'prepareRuntimeForProfile() must run before loadCliConfig() (issue #2300).',
    );
  }
  return settingsService as SettingsService;
}

function buildLoadedConfig(
  sessionId: string,
  cwd: string,
  argv: CliArgs,
  pieces: ConfigBuildPieces,
  settingsService: SettingsService,
): Config {
  return buildConfig({
    sessionId,
    cwd,
    settingsService,
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
  runtimeOverrides: { settingsService?: SettingsService } = {},
): Promise<Config> {
  loadEnvironment();
  const { bootstrapArgs, runtimeState, profileResult } =
    await bootstrapAndLoadProfile(settings, argv, runtimeOverrides);
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
    requireBootstrapSettingsService(runtimeState),
  );

  return finalizeConfig({
    config,
    runtimeState,
    bootstrapArgs,
    argv,
    settings,
    profileSettingsWithTools: pieces.profileSettingsWithTools,
    profileLoadResult: profileResult,
    providerModelResult: pieces.providerModel,
    defaultDisabledTools: profileMergedSettings.defaultDisabledTools ?? [],
    runtimeOverrides,
    approvalMode: pieces.approvalMode,
    interactive: pieces.context.interactive,
  });
}
