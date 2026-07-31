/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import fs from 'node:fs/promises';
import toml from '@iarna/toml';
import { Storage } from '@vybestack/llxprt-code-settings';
import {
  USER_POLICY_TIER,
  loadPoliciesFromToml,
  type ApprovalMode,
  PolicyDecision,
  type PolicyEngine,
  type PolicyRule,
} from '@vybestack/llxprt-code-policy';

/**
 * The managed overrides file the /policies dialog writes to. Reuses the
 * canonical user-scoped directory and file name that the existing
 * createPolicyUpdater persistence path already targets, so edits are applied
 * to the same policy source the engine re-reads on startup.
 */
export const MANAGED_POLICY_FILE = 'auto-saved.toml';

/** Minimum/maximum raw priority values within the user tier (0–999). */
export const MIN_USER_PRIORITY = 0;
export const MAX_USER_PRIORITY = 999;
const DEFAULT_USER_PRIORITY = 100;

/**
 * A flat, dialog-friendly representation of a rule in the managed overrides
 * file. `toolName` is the empty string for a wildcard rule.
 */
export interface EditablePolicyRule {
  toolName: string;
  decision: PolicyDecision;
  priority: number;
  argsPattern?: string;
}

interface TomlRule {
  toolName?: string;
  decision?: string;
  priority?: number;
  argsPattern?: string;
  commandPrefix?: string | string[];
  mcpName?: string;
  [key: string]: unknown;
}

interface TomlPolicyFile {
  rule?: TomlRule[];
}

/** Prefix used for rules loaded from user-tier TOML files (see toml-loader). */
const USER_SOURCE_PREFIX = 'User:';

function getManagedFilePath(): string {
  return path.join(Storage.getUserPoliciesDir(), MANAGED_POLICY_FILE);
}

function toEditableRule(rule: TomlRule): EditablePolicyRule {
  return {
    toolName: typeof rule.toolName === 'string' ? rule.toolName : '',
    decision: parseDecision(rule.decision),
    priority:
      typeof rule.priority === 'number' ? rule.priority : DEFAULT_USER_PRIORITY,
    ...(rule.argsPattern !== undefined
      ? { argsPattern: rule.argsPattern }
      : {}),
  };
}

function assertValidEditableRule(rule: EditablePolicyRule): void {
  if (
    !Number.isInteger(rule.priority) ||
    rule.priority < MIN_USER_PRIORITY ||
    rule.priority > MAX_USER_PRIORITY
  ) {
    throw new RangeError(
      `priority must be an integer in [${MIN_USER_PRIORITY}, ${MAX_USER_PRIORITY}], got ${rule.priority}`,
    );
  }
}

function toTomlRule(rule: EditablePolicyRule): TomlRule {
  assertValidEditableRule(rule);
  const out: TomlRule = {
    decision: rule.decision,
    priority: rule.priority,
  };
  if (rule.toolName) {
    out.toolName = rule.toolName;
  }
  if (rule.argsPattern) {
    out.argsPattern = rule.argsPattern;
  }
  return out;
}

function parseDecision(value: string | undefined): PolicyDecision {
  switch (value) {
    case 'allow':
      return PolicyDecision.ALLOW;
    case 'deny':
      return PolicyDecision.DENY;
    case 'ask_user':
      return PolicyDecision.ASK_USER;
    default:
      return PolicyDecision.ASK_USER;
  }
}

async function readPolicyFile(filePath: string): Promise<TomlPolicyFile> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return toml.parse(content) as TomlPolicyFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { rule: [] };
    }
    throw error;
  }
}

async function writePolicyFile(
  filePath: string,
  data: TomlPolicyFile,
): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const content = toml.stringify(data as toml.JsonMap);
  const tmpFile = `${filePath}.tmp`;
  try {
    await fs.writeFile(tmpFile, content, 'utf-8');
    await fs.rename(tmpFile, filePath);
  } catch (error) {
    await fs.unlink(tmpFile).catch(() => {});
    throw error;
  }
}

/**
 * Reads all editable rules from the managed overrides file.
 * Returns an empty array when the file does not exist yet.
 */
export async function listEditableRules(): Promise<EditablePolicyRule[]> {
  const data = await readPolicyFile(getManagedFilePath());
  return (data.rule ?? []).map(toEditableRule);
}

/**
 * Appends a new rule to the managed overrides file.
 */
export async function addEditableRule(
  rule: EditablePolicyRule,
): Promise<EditablePolicyRule> {
  const filePath = getManagedFilePath();
  const data = await readPolicyFile(filePath);
  data.rule ??= [];
  data.rule.push(toTomlRule(rule));
  await writePolicyFile(filePath, data);
  return rule;
}

/**
 * Replaces the rule at `index` in the managed overrides file.
 * Throws when the index is out of bounds.
 */
export async function updateEditableRule(
  index: number,
  rule: EditablePolicyRule,
): Promise<EditablePolicyRule> {
  const filePath = getManagedFilePath();
  const data = await readPolicyFile(filePath);
  data.rule ??= [];
  if (index < 0 || index >= data.rule.length) {
    throw new Error(
      `Cannot update rule at index ${index}: only ${data.rule.length} rule(s) exist.`,
    );
  }
  const original = data.rule[index];
  const updated: TomlRule = { ...original };
  updated.decision = rule.decision;
  updated.priority = rule.priority;
  if (rule.toolName) {
    updated.toolName = rule.toolName;
  } else {
    delete updated.toolName;
  }
  if (rule.argsPattern) {
    updated.argsPattern = rule.argsPattern;
  } else {
    delete updated.argsPattern;
  }
  data.rule[index] = updated;
  await writePolicyFile(filePath, data);
  return rule;
}

/**
 * Removes the rule at `index` from the managed overrides file.
 * Throws when the index is out of bounds.
 */
export async function deleteEditableRule(index: number): Promise<void> {
  const filePath = getManagedFilePath();
  const data = await readPolicyFile(filePath);
  data.rule ??= [];
  if (index < 0 || index >= data.rule.length) {
    throw new Error(
      `Cannot delete rule at index ${index}: only ${data.rule.length} rule(s) exist.`,
    );
  }
  data.rule.splice(index, 1);
  await writePolicyFile(filePath, data);
}

/**
 * Duplicates the rule at `index`, appending the copy to the end of the file.
 * Throws when the index is out of bounds.
 */
export async function duplicateEditableRule(
  index: number,
): Promise<EditablePolicyRule> {
  const filePath = getManagedFilePath();
  const data = await readPolicyFile(filePath);
  data.rule ??= [];
  if (index < 0 || index >= data.rule.length) {
    throw new Error(
      `Cannot duplicate rule at index ${index}: only ${data.rule.length} rule(s) exist.`,
    );
  }
  const source = data.rule[index];
  data.rule.push({ ...source });
  await writePolicyFile(filePath, data);
  return toEditableRule(source);
}

/**
 * Reloads the engine's user-tier rules from disk while preserving all other
 * rules (defaults, system, settings-derived, dynamic). This lets the /policies
 * dialog apply edits immediately without a process restart.
 */
export async function reloadUserPolicyRules(
  engine: PolicyEngine,
  approvalMode: ApprovalMode,
): Promise<readonly PolicyRule[]> {
  const kept = engine
    .getRules()
    .filter((rule) => !(rule.source?.startsWith(USER_SOURCE_PREFIX) ?? false));

  const userDir = Storage.getUserPoliciesDir();
  const { rules: freshUserRules, errors } = await loadPoliciesFromToml(
    approvalMode,
    [userDir],
    () => USER_POLICY_TIER,
  );

  if (errors.length > 0) {
    throw new Error(
      `Failed to reload user policy rules: ${errors.map((e) => e.message).join('; ')}`,
    );
  }

  const combined = [...kept, ...freshUserRules];
  engine.replaceRules(combined);
  return engine.getRules();
}
