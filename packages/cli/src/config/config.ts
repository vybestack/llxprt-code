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
  type MCPServerConfig,
  type PolicyEngineConfig,
} from '@vybestack/llxprt-code-core';

import type { ContextResolutionResult } from './interactiveContext.js';

const logger = new DebugLogger('llxprt:config');

// ─── Sub-functions ────────────────────────────────────────────────────────────

async function resolveMemoryContent(
  cwd: string,
  context: ContextResolutionResult,
  effectiveSettings: Settings,
): Promise<{ memoryContent: string; fileCount: number; filePaths: string[] }> {
  if (context.jitContextEnabled) {
    return { memoryContent: '', fileCount: 0, filePaths: [] };
  }
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
  return {
    memoryContent: memoryResult.memoryContent,
    fileCount: memoryResult.fileCount,
    filePaths: memoryResult.filePaths,
  };
}

function resolveMcpServers(
  effectiveSettings: Settings,
  context: ContextResolutionResult,
  allowedMcpServerNames: string[] | undefined,
): {
  mcpServers: Record<string, MCPServerConfig>;
  blockedMcpServers: Array<{ name: string; extensionName: string }>;
} {
  let mcpServers = mergeMcpServers(effectiveSettings, context.activeExtensions);
  const blockedMcpServers: Array<{ name: string; extensionName: string }> = [];

  if (!allowedMcpServerNames) {
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
  if (allowedMcpServerNames) {
    mcpServers = allowedMcpServers(
      mcpServers,
      allowedMcpServerNames,
      blockedMcpServers,
    );
  }

  return { mcpServers, blockedMcpServers };
}

interface IntermediateConfig {
  screenReader: boolean;
  allowedTools: string[];
  allowedToolsSet: Set<string>;
  effectiveSettingsWithTools: Settings;
  policyEngineConfig: PolicyEngineConfig;
  outputFormat: OutputFormat;
  useRipgrepSetting: boolean | undefined;
  mcpEnabled: boolean;
  extensionsEnabled: boolean;
  adminSkillsEnabled: boolean;
  excludeTools: readonly string[];
  question: string;
}

function resolveNonInteractiveExcludes(
  argv: CliArgs,
  context: ContextResolutionResult,
  effectiveSettings: Settings,
  approvalMode: ApprovalMode,
  allowedTools: string[],
  allowedToolsSet: Set<string>,
): readonly string[] {
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
  return mergeExcludeTools(
    effectiveSettings,
    context.activeExtensions,
    extraExcludes.length > 0 ? extraExcludes : undefined,
  );
}

async function resolveIntermediateConfig(
  argv: CliArgs,
  settings: Settings,
  effectiveSettings: Settings,
  context: ContextResolutionResult,
  approvalMode: ApprovalMode,
): Promise<IntermediateConfig> {
  const screenReader =
    argv.screenReader !== undefined
      ? argv.screenReader
      : (effectiveSettings.accessibility?.screenReader ?? false);

  const allowedTools = argv.allowedTools || settings.allowedTools || [];
  const allowedToolsSet = new Set(allowedTools);

  let effectiveSettingsWithTools = effectiveSettings;
  if (allowedTools.length > 0) {
    effectiveSettingsWithTools = {
      ...effectiveSettings,
      tools: { ...effectiveSettings.tools, allowed: allowedTools },
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

  const excludeTools = resolveNonInteractiveExcludes(
    argv,
    context,
    effectiveSettings,
    approvalMode,
    allowedTools,
    allowedToolsSet,
  );

  const question =
    argv.promptInteractive || argv.prompt || (argv.promptWords || []).join(' ');

  return {
    screenReader,
    allowedTools,
    allowedToolsSet,
    effectiveSettingsWithTools,
    policyEngineConfig,
    outputFormat,
    useRipgrepSetting,
    mcpEnabled,
    extensionsEnabled,
    adminSkillsEnabled,
    excludeTools,
    question,
  };
}

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
  effectiveSettings: Settings,
  context: ReturnType<typeof resolveContextAndEnvironment>,
  profileResult: Awaited<ReturnType<typeof loadAndPrepareProfile>>,
  runtimeState: Awaited<ReturnType<typeof prepareRuntimeForProfile>>,
) {
  const approvalMode = resolveApprovalMode({
    cliApprovalMode: argv.approvalMode,
    cliYolo: argv.yolo,
    disableYoloMode: effectiveSettings.security?.disableYoloMode,
    secureModeEnabled: effectiveSettings.admin?.secureModeEnabled,
    trustedFolder: context.trustedFolder,
  });
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
  if (providerModel.model && providerModel.model.trim() !== '') {
    runtimeState.runtime.settingsService.setProviderSetting(
      providerModel.provider,
      'model',
      providerModel.model,
    );
  }
  return { approvalMode, providerModel };
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
  extensions: GeminiCLIExtension[],
  extensionEnablementManager: ExtensionEnablementManager,
  sessionId: string,
  argv: CliArgs,
  cwd: string = process.cwd(),
  runtimeOverrides: { settingsService?: SettingsService } = {},
): Promise<Config> {
  const { bootstrapArgs, runtimeState, profileResult } =
    await bootstrapAndLoadProfile(settings, argv, runtimeOverrides);
  const effectiveSettings = profileResult.effectiveSettings;

  const context = resolveContextAndEnvironment({
    argv,
    effectiveSettings,
    originalSettings: settings,
    cwd,
    extensions,
    extensionEnablementManager,
  });
  const { memoryContent, fileCount, filePaths } = await resolveMemoryContent(
    cwd,
    context,
    effectiveSettings,
  );
  const { mcpServers } = resolveMcpServers(
    effectiveSettings,
    context,
    argv.allowedMcpServerNames,
  );

  const { approvalMode, providerModel } = resolveApprovalAndProvider(
    argv,
    effectiveSettings,
    context,
    profileResult,
    runtimeState,
  );
  const intermediate = await resolveIntermediateConfig(
    argv,
    settings,
    effectiveSettings,
    context,
    approvalMode,
  );
  const sandboxConfig = await loadSandboxConfig(effectiveSettings, argv);

  const config = buildConfig({
    sessionId,
    cwd,
    argv,
    effectiveSettings: intermediate.effectiveSettingsWithTools,
    context,
    approvalMode,
    providerModel,
    sandboxConfig,
    mcpServers,
    excludeTools: intermediate.excludeTools,
    memoryContent,
    fileCount,
    filePaths,
    policyEngineConfig: intermediate.policyEngineConfig,
    question: intermediate.question,
    screenReader: intermediate.screenReader,
    useRipgrepSetting: intermediate.useRipgrepSetting,
    mcpEnabled: intermediate.mcpEnabled,
    extensionsEnabled: intermediate.extensionsEnabled,
    adminSkillsEnabled: intermediate.adminSkillsEnabled,
    outputFormat: intermediate.outputFormat,
    allowedTools: intermediate.allowedTools,
  });

  return finalizeConfig({
    config,
    runtimeState,
    bootstrapArgs,
    argv,
    effectiveSettings: intermediate.effectiveSettingsWithTools,
    profileLoadResult: profileResult,
    providerModelResult: providerModel,
    defaultDisabledTools: effectiveSettings.defaultDisabledTools ?? [],
    runtimeOverrides,
    approvalMode,
    interactive: context.interactive,
  });
}
