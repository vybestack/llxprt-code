/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, sonarjs/cognitive-complexity -- Legacy core orchestration boundary retained while policy implementation lives in packages/policy. */

import * as path from 'node:path';
import fs from 'node:fs/promises';
import toml from '@iarna/toml';
import { Storage } from '@vybestack/llxprt-code-settings';
import {
  ADMIN_POLICY_TIER,
  DEFAULT_CORE_POLICIES_DIR,
  DEFAULT_POLICY_TIER,
  USER_POLICY_TIER,
  buildArgsPatterns,
  escapeRegex,
  formatPolicyError,
  getPolicyDirectories as getPolicyDirectoriesFromPolicy,
  getPolicyTier as getPolicyTierFromPolicy,
  loadPoliciesFromToml,
  loadPolicyFromToml,
  type MessageBus,
  MessageBusType,
  migrateLegacyApprovalMode,
  type PolicyConfigSource,
  type PolicyEngine,
  type PolicyEngineConfig,
  type PolicyPathResolver,
  type ApprovalMode,
  PolicyDecision,
  type PolicyRule,
  type PolicySettings,
  type UpdatePolicy,
} from '@vybestack/llxprt-code-policy';
import { coreEvents } from '../utils/events.js';
import { debugLogger } from '../utils/debugLogger.js';

export {
  ADMIN_POLICY_TIER,
  DEFAULT_CORE_POLICIES_DIR,
  DEFAULT_POLICY_TIER,
  USER_POLICY_TIER,
  formatPolicyError,
  migrateLegacyApprovalMode,
};
export type { PolicyConfigSource, PolicyPathResolver };

const storagePolicyPathResolver: PolicyPathResolver = {
  getUserPoliciesDir: () => Storage.getUserPoliciesDir(),
  getSystemPoliciesDir: () => Storage.getSystemPoliciesDir(),
};

export function getPolicyDirectories(defaultPoliciesDir?: string): string[] {
  return getPolicyDirectoriesFromPolicy(
    defaultPoliciesDir,
    storagePolicyPathResolver,
  );
}

export function getPolicyTier(
  dir: string,
  defaultPoliciesDir?: string,
): number {
  return getPolicyTierFromPolicy(
    dir,
    defaultPoliciesDir,
    storagePolicyPathResolver,
  );
}

export async function createPolicyEngineConfig(
  config: PolicyConfigSource,
): Promise<PolicyEngineConfig>;

export async function createPolicyEngineConfig(
  settings: PolicySettings,
  approvalMode: ApprovalMode,
  defaultPoliciesDir?: string,
): Promise<PolicyEngineConfig>;

export async function createPolicyEngineConfig(
  configOrSettings: PolicyConfigSource | PolicySettings,
  approvalModeParam?: ApprovalMode,
  defaultPoliciesDir?: string,
): Promise<PolicyEngineConfig> {
  const isPolicyConfigSource =
    typeof (configOrSettings as PolicyConfigSource).getApprovalMode ===
    'function';

  if (isPolicyConfigSource) {
    return buildConfigSourceRules(configOrSettings as PolicyConfigSource);
  }
  return buildSettingsRules(
    configOrSettings as PolicySettings,
    approvalModeParam!,
    defaultPoliciesDir,
  );
}

async function buildConfigSourceRules(
  config: PolicyConfigSource,
): Promise<PolicyEngineConfig> {
  const approvalMode = config.getApprovalMode();
  const nonInteractive = config.getNonInteractive();

  const policyDirs = getPolicyDirectories();
  const { rules: tomlRules, errors } = await loadPoliciesFromToml(
    approvalMode,
    policyDirs,
    (dir) => getPolicyTier(dir),
  );

  emitPolicyErrors(errors);

  const legacyRules = migrateLegacyApprovalMode(config);
  const userPolicyRules = await loadUserPolicyRules(config);
  const rules = [...tomlRules, ...legacyRules, ...userPolicyRules];

  return {
    rules,
    defaultDecision: PolicyDecision.ASK_USER,
    nonInteractive,
  };
}

async function loadUserPolicyRules(
  config: PolicyConfigSource,
): Promise<PolicyRule[]> {
  const userPolicyRules: PolicyRule[] = [];
  const userPolicyPath = config.getUserPolicyPath?.();
  if (userPolicyPath) {
    try {
      await fs.access(userPolicyPath);
      const userRules = await loadPolicyFromToml(
        userPolicyPath,
        USER_POLICY_TIER,
      );
      userPolicyRules.push(...userRules);
    } catch {
      // File doesn't exist or is invalid, just skip it (already warned about).
    }
  }
  return userPolicyRules;
}

async function buildSettingsRules(
  settings: PolicySettings,
  approvalMode: ApprovalMode,
  defaultPoliciesDir?: string,
): Promise<PolicyEngineConfig> {
  const policyDirs = getPolicyDirectories(defaultPoliciesDir);

  const { rules: tomlRules, errors } = await loadPoliciesFromToml(
    approvalMode,
    policyDirs,
    (dir) => getPolicyTier(dir, defaultPoliciesDir),
  );

  emitPolicyErrors(errors);

  const rules: PolicyRule[] = [...tomlRules];

  addMcpExcludedRules(settings, rules);
  addToolsExcludedRules(settings, rules);
  addToolsAllowedRules(settings, rules);
  addMcpTrustedRules(settings, rules);
  addMcpAllowedRules(settings, rules);

  return {
    rules,
    defaultDecision: PolicyDecision.ASK_USER,
  };
}

function emitPolicyErrors(
  errors: Array<Parameters<typeof formatPolicyError>[0]>,
): void {
  if (errors.length > 0) {
    for (const error of errors) {
      coreEvents.emitFeedback('error', formatPolicyError(error));
    }
  }
}

function addMcpExcludedRules(
  settings: PolicySettings,
  rules: PolicyRule[],
): void {
  if (settings.mcp?.excluded) {
    for (const serverName of settings.mcp.excluded) {
      rules.push({
        toolName: `${serverName}__*`,
        decision: PolicyDecision.DENY,
        priority: 2.9,
        source: 'Settings (MCP Excluded)',
      });
    }
  }
}

function addToolsExcludedRules(
  settings: PolicySettings,
  rules: PolicyRule[],
): void {
  if (settings.tools?.exclude) {
    for (const tool of settings.tools.exclude) {
      rules.push({
        toolName: tool,
        decision: PolicyDecision.DENY,
        priority: 2.4,
        source: 'Settings (Tools Excluded)',
      });
    }
  }
}

function addToolsAllowedRules(
  settings: PolicySettings,
  rules: PolicyRule[],
): void {
  if (settings.tools?.allowed) {
    for (const tool of settings.tools.allowed) {
      addSingleAllowedToolRule(tool, rules);
    }
  }
}

function addSingleAllowedToolRule(tool: string, rules: PolicyRule[]): void {
  // Check for legacy ShellTool(args) format
  // eslint-disable-next-line sonarjs/regular-expr -- Static regex reviewed for lint hardening; behavior preserved.
  const match = /^([a-zA-Z0-9_-]+)\((.*)\)$/.exec(tool);
  if (match) {
    const [, toolName, argsStr] = match;
    const normalizedName =
      toolName === 'ShellTool' ? 'run_shell_command' : toolName;

    if (normalizedName === 'run_shell_command' && argsStr) {
      const patterns = buildArgsPatterns(undefined, argsStr);
      for (const pattern of patterns) {
        rules.push({
          toolName: normalizedName,
          argsPattern: pattern,
          decision: PolicyDecision.ALLOW,
          priority: 2.3,
          source: 'Settings (Tools Allowed)',
        });
      }
    } else {
      rules.push({
        toolName: normalizedName,
        decision: PolicyDecision.ALLOW,
        priority: 2.3,
        source: 'Settings (Tools Allowed)',
      });
    }
  } else {
    rules.push({
      toolName: normalizeToolName(tool),
      decision: PolicyDecision.ALLOW,
      priority: 2.3,
      source: 'Settings (Tools Allowed)',
    });
  }
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

function addMcpTrustedRules(
  settings: PolicySettings,
  rules: PolicyRule[],
): void {
  if (settings.mcpServers) {
    for (const [serverName, serverConfig] of Object.entries(
      settings.mcpServers,
    )) {
      if (serverConfig.trust === true) {
        rules.push({
          toolName: `${serverName}__*`,
          decision: PolicyDecision.ALLOW,
          priority: 2.2,
          source: 'Settings (MCP Trusted)',
        });
      }
    }
  }
}

function addMcpAllowedRules(
  settings: PolicySettings,
  rules: PolicyRule[],
): void {
  if (settings.mcp?.allowed) {
    for (const serverName of settings.mcp.allowed) {
      rules.push({
        toolName: `${serverName}__*`,
        decision: PolicyDecision.ALLOW,
        priority: 2.1,
        source: 'Settings (MCP Allowed)',
      });
    }
  }
}

interface TomlRule {
  toolName?: string;
  mcpName?: string;
  decision?: string;
  priority?: number;
  commandPrefix?: string | string[];
  argsPattern?: string;
  [key: string]: unknown;
}

export function createPolicyUpdater(
  policyEngine: PolicyEngine,
  messageBus: MessageBus,
) {
  messageBus.subscribe(
    MessageBusType.UPDATE_POLICY,
    (message: UpdatePolicy) => {
      void (async () => {
        applyDynamicPolicyRule(policyEngine, message);

        if (message.persist === true) {
          await persistPolicyToToml(message);
        }
      })();
    },
  );
}

function applyDynamicPolicyRule(
  policyEngine: PolicyEngine,
  message: UpdatePolicy,
): void {
  const toolName = message.toolName;

  if (message.commandPrefix !== undefined) {
    const prefixes = Array.isArray(message.commandPrefix)
      ? message.commandPrefix
      : [message.commandPrefix];

    for (const prefix of prefixes) {
      const escapedPrefix = escapeRegex(prefix);
      const argsPattern = new RegExp(`"command":"${escapedPrefix}(?:[\\s"]|$)`);

      policyEngine.addRule({
        toolName,
        decision: PolicyDecision.ALLOW,
        priority: 2.95,
        argsPattern,
        source: 'Dynamic (Confirmed)',
      });
    }
  } else {
    const argsPattern = message.argsPattern
      ? new RegExp(message.argsPattern)
      : undefined;

    policyEngine.addRule({
      toolName,
      decision: PolicyDecision.ALLOW,
      priority: 2.95,
      argsPattern,
      source: 'Dynamic (Confirmed)',
    });
  }
}

async function persistPolicyToToml(message: UpdatePolicy): Promise<void> {
  try {
    const userPoliciesDir = Storage.getUserPoliciesDir();
    await fs.mkdir(userPoliciesDir, { recursive: true });
    const policyFile = path.join(userPoliciesDir, 'auto-saved.toml');

    const existingData = await readExistingTomlPolicy(policyFile);
    existingData.rule ??= [];

    const newRule = buildTomlRule(message, message.toolName);
    existingData.rule.push(newRule);

    const newContent = toml.stringify(existingData as toml.JsonMap);

    const tmpFile = `${policyFile}.tmp`;
    await fs.writeFile(tmpFile, newContent, 'utf-8');
    await fs.rename(tmpFile, policyFile);
  } catch (error) {
    coreEvents.emitFeedback(
      'error',
      `Failed to persist policy for ${message.toolName}`,
      error,
    );
  }
}

async function readExistingTomlPolicy(
  policyFile: string,
): Promise<{ rule?: TomlRule[] }> {
  let existingData: { rule?: TomlRule[] } = {};
  try {
    const fileContent = await fs.readFile(policyFile, 'utf-8');
    existingData = toml.parse(fileContent) as { rule?: TomlRule[] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      debugLogger.warn(
        `Failed to parse ${policyFile}, overwriting with new policy.`,
        error,
      );
    }
  }
  return existingData;
}

function buildTomlRule(message: UpdatePolicy, toolName: string): TomlRule {
  const newRule: TomlRule = {};

  if (message.mcpName) {
    newRule.mcpName = message.mcpName;
    const simpleToolName = toolName.startsWith(`${message.mcpName}__`)
      ? toolName.slice(message.mcpName.length + 2)
      : toolName;
    newRule.toolName = simpleToolName;
    newRule.decision = 'allow';
    newRule.priority = 200;
  } else {
    newRule.toolName = toolName;
    newRule.decision = 'allow';
    newRule.priority = 100;
  }

  if (message.commandPrefix !== undefined) {
    newRule.commandPrefix = message.commandPrefix;
  } else if (message.argsPattern !== undefined) {
    newRule.argsPattern = message.argsPattern;
  }

  return newRule;
}
