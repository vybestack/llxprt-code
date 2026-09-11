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

// Legacy policy spellings mapped to canonical registry names, compared
// lowercased. Mirrors LEGACY_TOOL_NAME_ALIASES in @vybestack/llxprt-code-tools.
const LEGACY_TOOL_NAME_ALIASES: ReadonlyMap<string, string> = new Map([
  ['shelltool', 'run_shell_command'],
]);

function isValidPolicyToolName(name: string): boolean {
  return (
    name.length > 0 && name.length <= 100 && /^[a-zA-Z0-9_.-]+$/.test(name)
  );
}

function toSnakeCaseToolName(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}

function hasMultipleWordsInName(name: string): boolean {
  return (
    /[A-Z]/.test(name.slice(1)) || name.includes('_') || name.includes('-')
  );
}

// Strip a trailing 'Tool' suffix from the last dotted segment when the
// remainder is still multi-word ('ReadFileTool' -> 'ReadFile').
function stripToolSuffixFromLastSegment(name: string): string {
  const dot = name.lastIndexOf('.');
  const last = name.slice(dot + 1);
  if (!last.endsWith('Tool') || last.length <= 4) {
    return name;
  }
  const withoutTool = last.slice(0, -4);
  if (!hasMultipleWordsInName(withoutTool)) {
    return name;
  }
  return name.slice(0, dot + 1) + withoutTool;
}

// Mirror of tools' canonicalizeToolName for policy entries (zero-dep).
function canonicalizeEntryName(base: string): string {
  if (base.split('.').some((segment) => segment === '')) {
    return '';
  }
  const stripped = stripToolSuffixFromLastSegment(base);
  if (isValidPolicyToolName(stripped) && stripped === stripped.toLowerCase()) {
    return stripped;
  }
  return toSnakeCaseToolName(stripped);
}

/**
 * Decode one user-authored policy entry to its canonical registry name.
 *
 * Boundary duplicate of tools canonicalizePolicyToolEntry (policy has zero
 * workspace deps); removal condition: policy gains a tools dependency or the
 * decoder moves to a zero-dep shared module. Must stay behavior-identical —
 * guarded by the tools drift test (core toolEntryDecoderDrift.test.ts).
 */
export function normalizeToolName(toolName: string): string {
  const trimmed = toolName.trim();
  if (!trimmed || trimmed.includes('*')) {
    return trimmed;
  }
  const openParen = trimmed.indexOf('(');
  const base = (
    openParen === -1 ? trimmed : trimmed.slice(0, openParen)
  ).trim();
  if (!base) {
    return '';
  }
  const alias = LEGACY_TOOL_NAME_ALIASES.get(base.toLowerCase());
  if (alias) {
    return alias;
  }
  return canonicalizeEntryName(base);
}

export const AUTO_EDIT_TOOLS = [
  'replace',
  'write_file',
  'insert_at_line',
  'delete_line_range',
  'apply_patch',
  'ast_edit',
] as const;

export function migrateLegacyApprovalMode(
  config: PolicyConfigSource,
): PolicyRule[] {
  const rules: PolicyRule[] = [];

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
