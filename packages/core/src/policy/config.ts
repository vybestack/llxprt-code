/**
 * Policy Configuration
 *
 * Creates PolicyEngineConfig by merging:
 * 1. Default TOML policy files (read-only, write)
 * 2. Legacy ApprovalMode migration rules
 * 3. User-defined TOML policies (if provided)
 * 4. Runtime rules (e.g., "Always Allow" UI selections)
 *
 * Implements legacy migration from ApprovalMode and --allowed-tools to policy rules.
 */

import {
  PolicyDecision,
  type PolicyRule,
  type PolicyEngineConfig,
} from './types.js';
import { loadDefaultPolicies, loadPolicyFromToml } from './toml-loader.js';
import { ApprovalMode } from '../config/config.js';
import { DebugLogger } from '../debug/DebugLogger.js';

const logger = new DebugLogger('llxprt:policy:config');

function normalizeAllowedToolNameForPolicy(tool: string): string {
  const trimmed = tool.trim();
  if (!trimmed) {
    return trimmed;
  }

  const baseName =
    trimmed.endsWith(')') && trimmed.includes('(')
      ? trimmed.slice(0, trimmed.indexOf('('))
      : trimmed;

  // Treat legacy ShellTool alias as the canonical tool name.
  if (baseName === 'ShellTool') {
    return 'run_shell_command';
  }

  return baseName;
}

/**
 * Minimal Config interface for policy creation
 * Avoids circular dependency by only requiring the methods we need
 */
export interface PolicyConfigSource {
  getApprovalMode(): ApprovalMode;
  getAllowedTools(): string[] | undefined;
  getNonInteractive(): boolean;
  getUserPolicyPath?(): string | undefined;
}

/**
 * Converts legacy ApprovalMode and --allowed-tools to policy rules.
 *
 * Priority bands:
 * - 1.999: YOLO mode allow-all (wildcard)
 * - 1.015: AUTO_EDIT mode write tools
 * - 2.3: --allowed-tools CLI flag
 *
 * @param config - Config object with approval mode and allowed tools
 * @returns Array of PolicyRule objects representing legacy settings
 */
export function migrateLegacyApprovalMode(
  config: PolicyConfigSource,
): PolicyRule[] {
  const rules: PolicyRule[] = [];

  // Map ApprovalMode
  const approvalMode = config.getApprovalMode();

  if (approvalMode === ApprovalMode.YOLO) {
    // YOLO mode: allow all tools with wildcard rule
    rules.push({
      // toolName: undefined means wildcard - matches all tools
      decision: PolicyDecision.ALLOW,
      priority: 1.999,
    });
  } else if (approvalMode === ApprovalMode.AUTO_EDIT) {
    // AUTO_EDIT mode: allow edit tools at priority 1.015
    const editTools = [
      'replace',
      'write_file',
      'insert_at_line',
      'delete_line_range',
    ];
    for (const tool of editTools) {
      rules.push({
        toolName: tool,
        decision: PolicyDecision.ALLOW,
        priority: 1.015,
      });
    }
  }
  // ApprovalMode.DEFAULT doesn't add any rules - standard policy stack applies

  // Map --allowed-tools
  const allowedTools = config.getAllowedTools() ?? [];
  const seenToolNames = new Set<string>();
  for (const tool of allowedTools) {
    const normalizedToolName = normalizeAllowedToolNameForPolicy(tool);
    if (!normalizedToolName || seenToolNames.has(normalizedToolName)) {
      continue;
    }
    seenToolNames.add(normalizedToolName);
    rules.push({
      toolName: normalizedToolName,
      decision: PolicyDecision.ALLOW,
      priority: 2.3,
    });
  }

  return rules;
}

/**
 * Creates the full PolicyEngineConfig by merging:
 * 1. Default TOML policy files (read-only.toml, write.toml)
 * 2. Legacy ApprovalMode migration rules
 * 3. User-defined TOML policies (if userPolicyPath provided)
 * 4. Runtime rules (can be added later via PolicyEngine.addRule)
 *
 * Rules are evaluated by priority (highest wins), so:
 * - User policies (Tier 2: 2.xxx) override defaults (Tier 1: 1.xxx)
 * - Legacy migration rules slot into appropriate priority bands
 * - Admin policies (Tier 3: 3.xxx, if added later) override all
 *
 * @param config - Config object with policy settings
 * @returns PolicyEngineConfig ready for PolicyEngine construction
 */
export async function createPolicyEngineConfig(
  config: PolicyConfigSource,
): Promise<PolicyEngineConfig> {
  const rules: PolicyRule[] = [];

  // 1. Load default policies from TOML
  const defaultRules = await loadDefaultPolicies();
  rules.push(...defaultRules);

  // 2. Migrate legacy settings (ApprovalMode, --allowed-tools)
  const legacyRules = migrateLegacyApprovalMode(config);
  rules.push(...legacyRules);

  // 3. Load user-defined policies (if any)
  const userPolicyPath = config.getUserPolicyPath?.();
  if (userPolicyPath) {
    try {
      const userRules = await loadPolicyFromToml(userPolicyPath);
      rules.push(...userRules);
    } catch (error) {
      // Log warning but don't fail - user policies are optional
      logger.warn(
        () =>
          `Failed to load user policy from ${userPolicyPath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        error,
      );
    }
  }

  return {
    rules,
    defaultDecision: PolicyDecision.ASK_USER,
    nonInteractive: config.getNonInteractive(),
  };
}
