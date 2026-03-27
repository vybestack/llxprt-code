/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import process from 'node:process';
import {
  Config,
  normalizeShellReplacement,
  type ApprovalMode,
  type OutputFormat,
  type TelemetryTarget,
  type SandboxConfig,
  type PolicyEngineConfig,
  type MCPServerConfig,
} from '@vybestack/llxprt-code-core';
import { getEnableHooks, getEnableHooksUI } from './settingsSchema.js';
import { loadSettings } from './settings.js';
import { appEvents } from '../utils/events.js';
import type { Settings } from './settings.js';
import type { CliArgs } from './cliArgParser.js';
import type { ContextResolutionResult } from './interactiveContext.js';
import type { ProviderModelResult } from './providerModelResolver.js';

// ─── DTOs ───────────────────────────────────────────────────────────────────

export interface ConfigBuildInput {
  readonly sessionId: string;
  readonly cwd: string;
  readonly argv: CliArgs;
  readonly effectiveSettings: Settings;
  readonly context: ContextResolutionResult;
  readonly approvalMode: ApprovalMode;
  readonly providerModel: ProviderModelResult;
  readonly sandboxConfig: SandboxConfig | undefined;
  readonly mcpServers: Record<string, MCPServerConfig>;
  readonly excludeTools: readonly string[];
  readonly memoryContent: string;
  readonly fileCount: number;
  readonly filePaths: readonly string[];
  readonly policyEngineConfig: PolicyEngineConfig;
  readonly question: string;
  readonly screenReader: boolean;
  readonly useRipgrepSetting: boolean | undefined;
  readonly mcpEnabled: boolean;
  readonly extensionsEnabled: boolean;
  readonly adminSkillsEnabled: boolean;
  readonly outputFormat: OutputFormat;
  readonly allowedTools: readonly string[];
}

// ─── Sub-builders ────────────────────────────────────────────────────────────

function buildTelemetryConfig(argv: CliArgs, settings: Settings) {
  return {
    enabled: argv.telemetry ?? settings.telemetry?.enabled,
    target: (argv.telemetryTarget ??
      settings.telemetry?.target) as TelemetryTarget,
    otlpEndpoint:
      argv.telemetryOtlpEndpoint ??
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
      settings.telemetry?.otlpEndpoint,
    logPrompts: argv.telemetryLogPrompts ?? settings.telemetry?.logPrompts,
    outfile: argv.telemetryOutfile ?? settings.telemetry?.outfile,
    logConversations: settings.telemetry?.logConversations,
    logResponses: settings.telemetry?.logResponses,
    redactSensitiveData: settings.telemetry?.redactSensitiveData,
    redactFilePaths: settings.telemetry?.redactFilePaths,
    redactUrls: settings.telemetry?.redactUrls,
    redactEmails: settings.telemetry?.redactEmails,
    redactPersonalInfo: settings.telemetry?.redactPersonalInfo,
  };
}

function buildSanitizationConfig(settings: Settings) {
  return {
    allowedEnvironmentVariables: [
      ...(settings.security?.environmentVariableRedaction?.allowed ?? []),
    ],
    blockedEnvironmentVariables: [
      ...(settings.security?.environmentVariableRedaction?.blocked ?? []),
    ],
    enableEnvironmentVariableRedaction:
      settings.security?.environmentVariableRedaction?.enabled ?? false,
  };
}

function buildHooksConfig(
  settings: Settings,
  adminSkillsEnabled: boolean,
  cwd: string,
) {
  const hooksConfig = settings.hooks || {};
  const { disabled: _disabled, ...eventHooks } = hooksConfig as {
    disabled?: string[];
    [key: string]: unknown;
  };

  return {
    enableHooks: getEnableHooks(settings),
    enableHooksUI: getEnableHooksUI(settings),
    hooks: eventHooks,
    onReload: async () => {
      const refreshedSettings = loadSettings(cwd);
      return {
        disabledSkills: refreshedSettings.merged.skills?.disabled,
        adminSkillsEnabled:
          refreshedSettings.merged.admin?.skills?.enabled ?? adminSkillsEnabled,
      };
    },
  };
}

function buildToolConfig(
  argv: CliArgs,
  effectiveSettings: Settings,
  mcpEnabled: boolean,
  mcpServers: Record<string, MCPServerConfig>,
  excludeTools: readonly string[],
  allowedTools: readonly string[],
  policyEngineConfig: PolicyEngineConfig,
) {
  return {
    coreTools: effectiveSettings.coreTools || undefined,
    allowedTools: allowedTools.length > 0 ? [...allowedTools] : undefined,
    policyEngineConfig,
    excludeTools: [...excludeTools],
    toolDiscoveryCommand: effectiveSettings.toolDiscoveryCommand,
    toolCallCommand: effectiveSettings.toolCallCommand,
    mcpServerCommand: mcpEnabled
      ? effectiveSettings.mcpServerCommand
      : undefined,
    mcpServers: mcpEnabled ? mcpServers : {},
    mcpEnabled,
    allowedMcpServers: mcpEnabled
      ? (argv.allowedMcpServerNames ?? effectiveSettings.mcp?.allowed)
      : undefined,
  };
}

function buildSessionBaseArgs(
  input: ConfigBuildInput,
  toolConfig: ReturnType<typeof buildToolConfig>,
  telemetry: ReturnType<typeof buildTelemetryConfig>,
  sanitizationConfig: ReturnType<typeof buildSanitizationConfig>,
) {
  const {
    sessionId,
    cwd,
    argv,
    effectiveSettings,
    context,
    approvalMode,
    providerModel,
    sandboxConfig,
    memoryContent,
    fileCount,
    filePaths,
    screenReader,
    outputFormat,
    question,
    extensionsEnabled,
    adminSkillsEnabled,
  } = input;
  return {
    sessionId,
    embeddingModel: undefined,
    sandbox: sandboxConfig,
    targetDir: cwd,
    includeDirectories: context.includeDirectories as string[],
    loadMemoryFromIncludeDirectories:
      context.resolvedLoadMemoryFromIncludeDirectories,
    debugMode: context.debugMode,
    outputFormat,
    question,
    ...toolConfig,
    extensionsEnabled,
    adminSkillsEnabled,
    userMemory: memoryContent,
    llxprtMdFileCount: fileCount,
    llxprtMdFilePaths: [...filePaths],
    approvalMode,
    showMemoryUsage:
      argv.showMemoryUsage || effectiveSettings.ui?.showMemoryUsage || false,
    disableYoloMode:
      effectiveSettings.security?.disableYoloMode ||
      effectiveSettings.admin?.secureModeEnabled,
    accessibility: { ...effectiveSettings.accessibility, screenReader },
    telemetry,
    usageStatisticsEnabled:
      effectiveSettings.ui?.usageStatisticsEnabled ?? true,
    fileFiltering: context.fileFiltering,
    checkpointing:
      argv.checkpointing || effectiveSettings.checkpointing?.enabled,
    dumpOnError: argv.dumponerror || false,
    proxy:
      argv.proxy ||
      process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy,
    cwd,
    fileDiscoveryService: context.fileService,
    bugCommand: effectiveSettings.bugCommand,
    model: providerModel.model,
    provider: providerModel.provider,
    sanitizationConfig,
  };
}

function buildFeatureArgs(
  input: ConfigBuildInput,
  hooksConfig: ReturnType<typeof buildHooksConfig>,
) {
  const { argv, effectiveSettings, context, useRipgrepSetting } = input;
  return {
    extensionContextFilePaths: [...context.extensionContextFilePaths],
    maxSessionTurns: effectiveSettings.ui?.maxSessionTurns ?? -1,
    experimentalZedIntegration: argv.experimentalAcp || false,
    listExtensions: argv.listExtensions || false,
    activeExtensions: context.activeExtensions.map((e) => ({
      name: e.name,
      version: e.version,
    })),
    extensions: context.allExtensions,
    enableExtensionReloading:
      effectiveSettings.experimental?.extensionReloading,
    blockedMcpServers: undefined,
    skillsSupport: effectiveSettings.experimental?.skills,
    disabledSkills: effectiveSettings.skills?.disabled,
    noBrowser: !!process.env.NO_BROWSER,
    summarizeToolOutput: effectiveSettings.summarizeToolOutput,
    ideMode: context.ideMode,
    chatCompression: effectiveSettings.chatCompression,
    interactive: context.interactive,
    folderTrust: context.folderTrust,
    trustedFolder: context.trustedFolder,
    shellReplacement: normalizeShellReplacement(
      effectiveSettings.shellReplacement as
        | 'allowlist'
        | 'all'
        | 'none'
        | boolean
        | undefined,
    ),
    useRipgrep: useRipgrepSetting,
    shouldUseNodePtyShell: effectiveSettings.shouldUseNodePtyShell,
    allowPtyThemeOverride: effectiveSettings.allowPtyThemeOverride,
    ptyScrollbackLimit: effectiveSettings.ptyScrollbackLimit,
    enablePromptCompletion: effectiveSettings.enablePromptCompletion ?? false,
    eventEmitter: appEvents,
    continueSession:
      argv.continue === '' || argv.continue === true
        ? true
        : argv.continue || false,
    jitContextEnabled: context.jitContextEnabled,
    ...hooksConfig,
  };
}

// ─── Main builder ─────────────────────────────────────────────────────────────

/**
 * Constructs the Config object from all resolved values.
 */
export function buildConfig(input: ConfigBuildInput): Config {
  const {
    argv,
    effectiveSettings,
    mcpEnabled,
    mcpServers,
    excludeTools,
    allowedTools,
    policyEngineConfig,
    adminSkillsEnabled,
    cwd,
  } = input;

  const telemetry = buildTelemetryConfig(argv, effectiveSettings);
  const sanitizationConfig = buildSanitizationConfig(effectiveSettings);
  const hooksConfig = buildHooksConfig(
    effectiveSettings,
    adminSkillsEnabled,
    cwd,
  );
  const toolConfig = buildToolConfig(
    argv,
    effectiveSettings,
    mcpEnabled,
    mcpServers,
    excludeTools,
    allowedTools,
    policyEngineConfig,
  );

  return new Config({
    ...buildSessionBaseArgs(input, toolConfig, telemetry, sanitizationConfig),
    ...buildFeatureArgs(input, hooksConfig),
  });
}
