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
import { resolveNonInteractiveExcludes } from './toolGovernance.js';
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
    argv.screenReader !== undefined
      ? argv.screenReader
      : (profileMergedSettings.accessibility?.screenReader ?? false);

  const allowedTools = argv.allowedTools || settings.allowedTools || [];
  const allowedToolsSet = new Set(allowedTools);

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

  const question =
    argv.promptInteractive || argv.prompt || (argv.promptWords || []).join(' ');

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
