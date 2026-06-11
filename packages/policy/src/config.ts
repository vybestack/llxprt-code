/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ApprovalMode, type PolicyRule, PolicyDecision } from './types.js';
import type { PolicyFileError } from './toml-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const DEFAULT_CORE_POLICIES_DIR = path.join(__dirname, 'policies');

export const DEFAULT_POLICY_TIER = 1;
export const USER_POLICY_TIER = 2;
export const ADMIN_POLICY_TIER = 3;

export interface PolicyPathResolver {
  getUserPoliciesDir: () => string;
  getSystemPoliciesDir: () => string;
}

export interface PolicyConfigSource {
  getApprovalMode: () => ApprovalMode;
  getAllowedTools: () => string[] | undefined;
  getNonInteractive: () => boolean;
  getUserPolicyPath?: () => string | undefined;
}

const DEFAULT_POLICY_PATH_RESOLVER: PolicyPathResolver = {
  getUserPoliciesDir: () => '',
  getSystemPoliciesDir: () => '',
};

export function getPolicyDirectories(
  defaultPoliciesDir?: string,
  pathResolver: PolicyPathResolver = DEFAULT_POLICY_PATH_RESOLVER,
): string[] {
  const dirs = [];

  if (defaultPoliciesDir) {
    dirs.push(defaultPoliciesDir);
  } else {
    dirs.push(DEFAULT_CORE_POLICIES_DIR);
  }

  const userPoliciesDir = pathResolver.getUserPoliciesDir();
  if (userPoliciesDir) {
    dirs.push(userPoliciesDir);
  }

  const systemPoliciesDir = pathResolver.getSystemPoliciesDir();
  if (systemPoliciesDir) {
    dirs.push(systemPoliciesDir);
  }

  return dirs.reverse();
}

export function getPolicyTier(
  dir: string,
  defaultPoliciesDir?: string,
  pathResolver: PolicyPathResolver = DEFAULT_POLICY_PATH_RESOLVER,
): number {
  const normalizedDir = path.resolve(dir);
  const userPoliciesDir = pathResolver.getUserPoliciesDir();
  const systemPoliciesDir = pathResolver.getSystemPoliciesDir();

  if (
    defaultPoliciesDir &&
    normalizedDir === path.resolve(defaultPoliciesDir)
  ) {
    return DEFAULT_POLICY_TIER;
  }
  if (normalizedDir === path.resolve(DEFAULT_CORE_POLICIES_DIR)) {
    return DEFAULT_POLICY_TIER;
  }
  if (userPoliciesDir && normalizedDir === path.resolve(userPoliciesDir)) {
    return USER_POLICY_TIER;
  }
  if (systemPoliciesDir && normalizedDir === path.resolve(systemPoliciesDir)) {
    return ADMIN_POLICY_TIER;
  }

  return DEFAULT_POLICY_TIER;
}

export function formatPolicyError(error: PolicyFileError): string {
  const tierLabel = error.tier.toUpperCase();
  let message = `[${tierLabel}] Policy file error in ${error.fileName}:
`;
  message += `  ${error.message}`;
  if (error.details) {
    message += `
${error.details}`;
  }
  if (error.suggestion) {
    message += `
  Suggestion: ${error.suggestion}`;
  }
  return message;
}

function normalizeToolName(toolName: string): string {
  if (
    toolName === 'ShellTool' ||
    toolName.startsWith('ShellTool(') ||
    toolName.startsWith('run_shell_command(')
  ) {
    return 'run_shell_command';
  }
  return toolName;
}

const AUTO_EDIT_TOOLS = [
  'replace',
  'write_file',
  'insert_at_line',
  'delete_line_range',
  'apply_patch',
] as const;

export function migrateLegacyApprovalMode(
  config: PolicyConfigSource,
): PolicyRule[] {
  const rules: PolicyRule[] = [];
  const approvalMode = config.getApprovalMode();

  if (approvalMode === 'yolo') {
    rules.push({
      decision: PolicyDecision.ALLOW,
      priority: 1.999,
      source: 'Legacy (YOLO)',
    });
  }

  if (approvalMode === 'autoEdit') {
    for (const tool of AUTO_EDIT_TOOLS) {
      rules.push({
        toolName: tool,
        decision: PolicyDecision.ALLOW,
        priority: 1.015,
        source: 'Legacy (AUTO_EDIT)',
      });
    }
  }

  const allowedTools = config.getAllowedTools();
  if (allowedTools && allowedTools.length > 0) {
    for (const tool of allowedTools) {
      rules.push({
        toolName: normalizeToolName(tool),
        decision: PolicyDecision.ALLOW,
        priority: 2.3,
        source: 'Legacy (--allowed-tools)',
      });
    }
  }

  return rules;
}
