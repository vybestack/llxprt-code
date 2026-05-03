/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  OutputFormat,
  isRipgrepAvailable,
  type ApprovalMode,
  type PolicyEngineConfig,
  DebugLogger,
} from '@vybestack/llxprt-code-core';
import { createPolicyEngineConfig } from './policy.js';
import {
  resolveNonInteractiveExcludes,
  buildNormalizedToolSet,
} from './toolGovernance.js';
import type { Settings } from './settings.js';
import type { CliArgs } from './cliArgParser.js';
import type { ContextResolutionResult } from './interactiveContext.js';

const logger = new DebugLogger('llxprt:config:intermediateConfig');

export interface IntermediateConfig {
  readonly screenReader: boolean;
  readonly allowedTools: string[];
  readonly allowedToolsSet: Set<string>;
  readonly profileSettingsWithTools: Settings;
  readonly policyEngineConfig: PolicyEngineConfig;
  readonly outputFormat: OutputFormat;
  readonly useRipgrepSetting: boolean | undefined;
  readonly mcpEnabled: boolean;
  readonly extensionsEnabled: boolean;
  readonly adminSkillsEnabled: boolean;
  readonly excludeTools: readonly string[];
  readonly question: string;
}

function resolveScreenReaderSetting(
  argv: CliArgs,
  profileMergedSettings: Settings,
): boolean {
  return (
    argv.screenReader ??
    profileMergedSettings.accessibility?.screenReader ??
    false
  );
}

function resolveOutputFormat(argv: CliArgs): OutputFormat {
  return argv.outputFormat === OutputFormat.JSON
    ? OutputFormat.JSON
    : OutputFormat.TEXT;
}

export async function resolveIntermediateConfig(
  argv: CliArgs,
  settings: Settings,
  profileMergedSettings: Settings,
  context: ContextResolutionResult,
  approvalMode: ApprovalMode,
): Promise<IntermediateConfig> {
  const screenReader = resolveScreenReaderSetting(argv, profileMergedSettings);

  const allowedTools = resolveAllowedTools(
    argv,
    profileMergedSettings,
    settings,
  );

  const allowedToolsSet = buildNormalizedToolSet(allowedTools);
  const profileSettingsWithTools = applyAllowedToolsToSettings(
    profileMergedSettings,
    allowedTools,
  );

  const policyEngineConfig = await createPolicyEngineConfig(
    profileSettingsWithTools,
    approvalMode,
  );

  const outputFormat = resolveOutputFormat(argv);

  const useRipgrepSetting = await resolveRipgrepSetting(profileMergedSettings);

  const mcpEnabled = profileMergedSettings.admin?.mcp?.enabled ?? true;
  const extensionsEnabled =
    profileMergedSettings.admin?.extensions?.enabled ?? true;
  const adminSkillsEnabled =
    profileMergedSettings.admin?.skills?.enabled ?? true;

  const excludeTools = resolveNonInteractiveExcludes(
    argv,
    context,
    profileMergedSettings,
    approvalMode,
    allowedTools,
    allowedToolsSet,
  );

  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string should fall back to next source, empty array should join to empty string */
  const question =
    argv.promptInteractive || argv.prompt || (argv.promptWords || []).join(' ');
  /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

  return {
    screenReader,
    allowedTools,
    allowedToolsSet,
    profileSettingsWithTools,
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

/**
 * Resolves allowed tools from CLI args, profile settings, and global settings.
 * Priority: CLI > profile.tools.allowed > profile.allowedTools > settings.tools.allowed > settings.allowedTools
 * Intentionally uses falsy coalescing to preserve the existing precedence chain.
 */
function applyAllowedToolsToSettings(
  profileMergedSettings: Settings,
  allowedTools: string[],
): Settings {
  if (allowedTools.length === 0) {
    return profileMergedSettings;
  }
  return {
    ...profileMergedSettings,
    tools: { ...profileMergedSettings.tools, allowed: allowedTools },
  };
}

async function resolveRipgrepSetting(
  profileMergedSettings: Settings,
): Promise<boolean | undefined> {
  const configured = profileMergedSettings.useRipgrep;
  if (configured !== undefined) {
    return configured;
  }
  const ripgrepAvailable = await isRipgrepAvailable();
  logger.debug(() =>
    ripgrepAvailable
      ? 'Ripgrep detected, auto-enabling for faster searches'
      : 'Ripgrep not detected, using default grep implementation',
  );
  return ripgrepAvailable;
}

function resolveAllowedTools(
  argv: CliArgs,
  profileMergedSettings: Settings,
  settings: Settings,
): string[] {
  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing preserves existing precedence for legacy settings */
  const profileTools =
    profileMergedSettings.tools?.allowed || profileMergedSettings.allowedTools;

  const globalTools = settings.tools?.allowed || settings.allowedTools;
  const tools = argv.allowedTools || profileTools || globalTools;
  return [...(tools ?? [])];
  /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
}
