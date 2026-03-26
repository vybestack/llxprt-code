/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20260214-SESSIONBROWSER.P29
 */

import process from 'node:process';
import {
  Config,
  OutputFormat,
  isRipgrepAvailable,
  type GeminiCLIExtension,
  SettingsService,
  DebugLogger,
} from '@vybestack/llxprt-code-core';

import { Settings } from './settings.js';
import { createPolicyEngineConfig } from './policy.js';
import { loadSandboxConfig } from './sandboxConfig.js';
import { allowedMcpServers, mergeMcpServers } from './mcpServerConfig.js';
import { type CliArgs } from './cliArgParser.js';
import type { ExtensionEnablementManager } from './extensions/extensionEnablement.js';

// @plan:PLAN-20251020-STATELESSPROVIDER3.P04
import {
  parseBootstrapArgs,
  prepareRuntimeForProfile,
} from './profileBootstrap.js';

import {
  resolveProfileToLoad,
  loadAndPrepareProfile,
} from './profileResolution.js';
import { resolveContextAndEnvironment } from './interactiveContext.js';
import { loadHierarchicalLlxprtMemory } from './environmentLoader.js';
import { resolveApprovalMode } from './approvalModeResolver.js';
import { resolveProviderAndModel } from './providerModelResolver.js';
import { buildConfig } from './configBuilder.js';
import { finalizeConfig } from './postConfigRuntime.js';
import {
  mergeExcludeTools,
  createToolExclusionFilter,
} from './toolGovernance.js';

import {
  ShellTool,
  EditTool,
  WriteFileTool,
  ApprovalMode,
} from '@vybestack/llxprt-code-core';

const logger = new DebugLogger('llxprt:config');

export async function loadCliConfig(
  settings: Settings,
  extensions: GeminiCLIExtension[],
  extensionEnablementManager: ExtensionEnablementManager,
  sessionId: string,
  argv: CliArgs,
  cwd: string = process.cwd(),
  runtimeOverrides: { settingsService?: SettingsService } = {},
): Promise<Config> {
  /**
   * @plan PLAN-20251020-STATELESSPROVIDER3.P06
   * @requirement REQ-SP3-001
   */

  // Step 1: Parse bootstrap args
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

  // Step 2: Prepare runtime (also calls registerCliProviderInfrastructure internally)
  const runtimeState = await prepareRuntimeForProfile(parsedWithOverrides);

  // Step 3: Profile resolution and loading
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
  const effectiveSettings = profileResult.effectiveSettings;

  // Step 4: Context and environment resolution (uses originalSettings for trust — security critical)
  const context = resolveContextAndEnvironment({
    argv,
    effectiveSettings,
    originalSettings: settings,
    cwd,
    extensions,
    extensionEnablementManager,
  });

  // Step 5: Memory loading
  let memoryContent = '';
  let fileCount = 0;
  let filePaths: string[] = [];

  if (!context.jitContextEnabled) {
    const memoryResult = await loadHierarchicalLlxprtMemory(
      cwd,
      context.resolvedLoadMemoryFromIncludeDirectories
        ? (context.includeDirectories as string[])
        : [],
      context.debugMode,
      context.fileService,
      effectiveSettings,
      context.allExtensions,
      context.trustedFolder,
      context.memoryImportFormat,
      context.memoryFileFiltering,
    );
    memoryContent = memoryResult.memoryContent;
    fileCount = memoryResult.fileCount;
    filePaths = memoryResult.filePaths;
  }

  // Step 6: MCP server resolution
  let mcpServers = mergeMcpServers(effectiveSettings, context.activeExtensions);
  const blockedMcpServers: Array<{ name: string; extensionName: string }> = [];

  if (!argv.allowedMcpServerNames) {
    if (effectiveSettings.allowMCPServers) {
      mcpServers = allowedMcpServers(
        mcpServers,
        effectiveSettings.allowMCPServers,
        blockedMcpServers,
      );
    }
    if (effectiveSettings.excludeMCPServers) {
      const excludedNames = new Set(
        effectiveSettings.excludeMCPServers.filter(Boolean),
      );
      if (excludedNames.size > 0) {
        mcpServers = Object.fromEntries(
          Object.entries(mcpServers).filter(([key]) => !excludedNames.has(key)),
        );
      }
    }
  }
  if (argv.allowedMcpServerNames) {
    mcpServers = allowedMcpServers(
      mcpServers,
      argv.allowedMcpServerNames,
      blockedMcpServers,
    );
  }

  // Step 7: Approval mode resolution
  const approvalMode = resolveApprovalMode({
    cliApprovalMode: argv.approvalMode,
    cliYolo: argv.yolo,
    disableYoloMode: effectiveSettings.security?.disableYoloMode,
    secureModeEnabled: effectiveSettings.admin?.secureModeEnabled,
    trustedFolder: context.trustedFolder,
  });

  // Step 8: Provider and model resolution
  const providerModel = resolveProviderAndModel({
    cliProvider: argv.provider,
    profileProvider: profileResult.profileProvider,
    envDefaultProvider: process.env.LLXPRT_DEFAULT_PROVIDER,
    cliModel: argv.model,
    profileModel: profileResult.profileModel,
    settingsModel: effectiveSettings.model,
    envDefaultModel: process.env.LLXPRT_DEFAULT_MODEL,
    envGeminiModel: process.env.GEMINI_MODEL,
  });

  // Ensure SettingsService reflects the selected model so Config#getModel picks it up
  if (providerModel.model && providerModel.model.trim() !== '') {
    runtimeState.runtime.settingsService.setProviderSetting(
      providerModel.provider,
      'model',
      providerModel.model,
    );
  }

  // Intermediate: compute screen reader, allowed tools, effectiveSettings with tools,
  // policy engine, output format, ripgrep, admin flags, exclude tools, sandbox, question
  const screenReader =
    argv.screenReader !== undefined
      ? argv.screenReader
      : (effectiveSettings.accessibility?.screenReader ?? false);

  const allowedTools = argv.allowedTools || settings.allowedTools || [];
  const allowedToolsSet = new Set(allowedTools);

  // Merge CLI allowed tools into effectiveSettings for policy engine
  let effectiveSettingsWithTools = effectiveSettings;
  if (allowedTools.length > 0) {
    effectiveSettingsWithTools = {
      ...effectiveSettings,
      tools: {
        ...effectiveSettings.tools,
        allowed: allowedTools,
      },
    };
  }

  const policyEngineConfig = await createPolicyEngineConfig(
    effectiveSettingsWithTools,
    approvalMode,
  );

  const outputFormat =
    argv.outputFormat === OutputFormat.JSON
      ? OutputFormat.JSON
      : OutputFormat.TEXT;

  let useRipgrepSetting = effectiveSettings.useRipgrep;
  if (useRipgrepSetting === undefined) {
    const ripgrepAvailable = await isRipgrepAvailable();
    useRipgrepSetting = ripgrepAvailable;
    logger.debug(() =>
      ripgrepAvailable
        ? 'Ripgrep detected, auto-enabling for faster searches'
        : 'Ripgrep not detected, using default grep implementation',
    );
  }

  const mcpEnabled = effectiveSettings.admin?.mcp?.enabled ?? true;
  const extensionsEnabled =
    effectiveSettings.admin?.extensions?.enabled ?? true;
  const adminSkillsEnabled = effectiveSettings.admin?.skills?.enabled ?? true;

  // Non-interactive extra excludes
  const extraExcludes: string[] = [];
  if (!context.interactive && !argv.experimentalAcp) {
    const defaultExcludes = [ShellTool.Name, EditTool.Name, WriteFileTool.Name];
    const autoEditExcludes = [ShellTool.Name];
    const toolExclusionFilter = createToolExclusionFilter(
      allowedTools,
      allowedToolsSet,
    );

    switch (approvalMode) {
      case ApprovalMode.DEFAULT:
        extraExcludes.push(...defaultExcludes.filter(toolExclusionFilter));
        break;
      case ApprovalMode.AUTO_EDIT:
        extraExcludes.push(...autoEditExcludes.filter(toolExclusionFilter));
        break;
      default:
        break;
    }
  }

  const excludeTools = mergeExcludeTools(
    effectiveSettings,
    context.activeExtensions,
    extraExcludes.length > 0 ? extraExcludes : undefined,
  );

  const sandboxConfig = await loadSandboxConfig(effectiveSettings, argv);

  const question =
    argv.promptInteractive || argv.prompt || (argv.promptWords || []).join(' ');

  // Step 9: Build Config object
  const config = buildConfig({
    sessionId,
    cwd,
    argv,
    effectiveSettings: effectiveSettingsWithTools,
    context,
    approvalMode,
    providerModel,
    sandboxConfig,
    mcpServers,
    excludeTools,
    memoryContent,
    fileCount,
    filePaths,
    policyEngineConfig,
    question,
    screenReader,
    useRipgrepSetting,
    mcpEnabled,
    extensionsEnabled,
    adminSkillsEnabled,
    outputFormat,
    allowedTools,
  });

  // Steps 10-17: Post-config runtime finalization
  return finalizeConfig({
    config,
    runtimeState,
    bootstrapArgs,
    argv,
    effectiveSettings: effectiveSettingsWithTools,
    profileLoadResult: profileResult,
    providerModelResult: providerModel,
    defaultDisabledTools: effectiveSettings.defaultDisabledTools ?? [],
    runtimeOverrides,
    approvalMode,
    interactive: context.interactive,
  });
}
