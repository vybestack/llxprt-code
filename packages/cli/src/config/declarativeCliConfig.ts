/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ApprovalMode,
  LlxprtExtension,
  MCPServerConfig,
} from '@vybestack/llxprt-code-core';
import type { CliArgs } from './cliArgParser.js';
import type { ExtensionEnablementManager } from './extensions/extensionEnablement.js';
import type { MergedSettings, Settings } from './settings.js';
import { resolveApprovalMode } from './approvalModeResolver.js';
import { resolveProxy } from './configBuilder.js';
import { loadEnvironment } from './environmentLoader.js';
import {
  resolveContextAndEnvironment,
  type ContextResolutionResult,
} from './interactiveContext.js';
import {
  resolveIntermediateConfig,
  type IntermediateConfig,
} from './intermediateConfig.js';
import { resolveMcpServers } from './mcpServerConfig.js';
import { parseBootstrapArgs } from './profileBootstrap.js';
import type { ParsedBootstrapArgs } from './profileBootstrap.js';
import {
  loadAndPrepareProfile,
  resolveProfileToLoad,
  type ProfileLoadResult,
} from './profileResolution.js';

export interface DeclarativeCliConfigInput {
  readonly settings: Settings;
  readonly argv: CliArgs;
  readonly cwd: string;
  readonly extensions: LlxprtExtension[];
  readonly extensionEnablementManager: ExtensionEnablementManager;
}

/**
 * Everything the CLI can decide from settings, argv, the loaded profile and
 * the workspace alone. Nothing here touches a provider, a credential
 * authority or a preflight, so commands that only read configuration (such
 * as `skills list`) can use it without starting a provider runtime.
 */
export interface DeclarativeCliConfig {
  readonly bootstrap: ParsedBootstrapArgs;
  readonly profileResult: ProfileLoadResult;
  readonly context: ContextResolutionResult;
  readonly mcpServers: Record<string, MCPServerConfig>;
  readonly blockedMcpServers: Array<{ name: string; extensionName: string }>;
  readonly approvalMode: ApprovalMode;
  readonly intermediate: IntermediateConfig;
}

export async function resolveDeclarativeCliConfig(
  input: DeclarativeCliConfigInput,
): Promise<DeclarativeCliConfig> {
  const { settings, argv, cwd, extensions, extensionEnablementManager } = input;
  loadEnvironment();

  const parsed = parseBootstrapArgs();
  const bootstrap: ParsedBootstrapArgs = {
    bootstrapArgs: parsed.bootstrapArgs,
    runtimeMetadata: {
      ...parsed.runtimeMetadata,
      proxy: resolveProxy(argv.proxy),
    },
  };

  const { profileToLoad, profileExplicitlySpecified } = resolveProfileToLoad({
    bootstrapArgs: bootstrap.bootstrapArgs,
    settings,
    cliProvider: argv.provider,
  });
  const profileResult = await loadAndPrepareProfile({
    bootstrapArgs: bootstrap.bootstrapArgs,
    settings,
    argv,
    profileToLoad,
    profileExplicitlySpecified,
  });
  const profileMergedSettings = profileResult.profileMergedSettings;

  const context = resolveContextAndEnvironment({
    argv,
    profileMergedSettings,
    originalSettings: settings,
    cwd,
    extensions,
    extensionEnablementManager,
  });
  const { mcpServers, blockedMcpServers } = resolveMcpServers(
    profileMergedSettings,
    context,
    argv.allowedMcpServerNames,
  );
  const securitySettings = (profileMergedSettings as Partial<MergedSettings>)
    .security;
  const approvalMode = resolveApprovalMode({
    cliApprovalMode: argv.approvalMode,
    cliYolo: argv.yolo,
    disableYoloMode: securitySettings?.disableYoloMode,
    secureModeEnabled: profileMergedSettings.admin?.secureModeEnabled,
    trustedFolder: context.trustedFolder,
  });
  const intermediate = await resolveIntermediateConfig(
    argv,
    settings,
    profileMergedSettings,
    context,
    approvalMode,
  );

  return {
    bootstrap,
    profileResult,
    context,
    mcpServers,
    blockedMcpServers,
    approvalMode,
    intermediate,
  };
}
