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

export async function resolveIntermediateConfig(
  argv: CliArgs,
  settings: Settings,
  profileMergedSettings: Settings,
  context: ContextResolutionResult,
  approvalMode: ApprovalMode,
): Promise<IntermediateConfig> {
  const screenReader =
    argv.screenReader ??
    profileMergedSettings.accessibility?.screenReader ??
    false;

  const allowedTools = resolveAllowedTools(
    argv,
    profileMergedSettings,
    settings,
  );

  const allowedToolsSet = buildNormalizedToolSet(allowedTools);

  let profileSettingsWithTools = profileMergedSettings;
  if (allowedTools.length > 0) {
    profileSettingsWithTools = {
      ...profileMergedSettings,
      tools: { ...profileMergedSettings.tools, allowed: allowedTools },
    };
  }

  const policyEngineConfig = await createPolicyEngineConfig(
    profileSettingsWithTools,
    approvalMode,
  );

  const outputFormat =
    argv.outputFormat === OutputFormat.JSON
      ? OutputFormat.JSON
      : OutputFormat.TEXT;

  let useRipgrepSetting = profileMergedSettings.useRipgrep;
  if (useRipgrepSetting === undefined) {
    const ripgrepAvailable = await isRipgrepAvailable();
    useRipgrepSetting = ripgrepAvailable;
    logger.debug(() =>
      ripgrepAvailable
        ? 'Ripgrep detected, auto-enabling for faster searches'
        : 'Ripgrep not detected, using default grep implementation',
    );
  }

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
