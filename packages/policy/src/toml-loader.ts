/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type PolicyRule, PolicyDecision, type ApprovalMode } from './types.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import toml from '@iarna/toml';
import { z, type ZodError } from 'zod';
import { buildArgsPatterns } from './utils.js';

/**
 * Schema for a single policy rule in the TOML file (before transformation).
 */
const PolicyRuleSchema = z.object({
  toolName: z.union([z.string(), z.array(z.string())]).optional(),
  mcpName: z.string().optional(),
  argsPattern: z.string().optional(),
  commandPrefix: z.union([z.string(), z.array(z.string())]).optional(),
  commandRegex: z.string().optional(),
  decision: z.nativeEnum(PolicyDecision),
  // Priority must be in range [0, 999] to prevent tier overflow.
  // With tier transformation (tier + priority/1000), this ensures:
  // - Tier 1 (default): range [1.000, 1.999]
  // - Tier 2 (user): range [2.000, 2.999]
  // - Tier 3 (admin): range [3.000, 3.999]
  priority: z
    .number({
      required_error: 'priority is required',
      invalid_type_error: 'priority must be a number',
    })
    .int({ message: 'priority must be an integer' })
    .min(0, { message: 'priority must be >= 0' })
    .max(999, {
      message:
        'priority must be <= 999 to prevent tier overflow. Priorities >= 1000 would jump to the next tier.',
    }),
  modes: z.array(z.string()).optional(),
  allowRedirection: z.boolean().optional(),
});

/**
 * Schema for the entire policy TOML file.
 */
const PolicyFileSchema = z.object({
  rule: z.array(PolicyRuleSchema),
});

/**
 * Type for a raw policy rule from TOML (before transformation).
 */
type PolicyRuleToml = z.infer<typeof PolicyRuleSchema>;

/**
 * Types of errors that can occur while loading policy files.
 */
export type PolicyFileErrorType =
  | 'file_read'
  | 'toml_parse'
  | 'schema_validation'
  | 'rule_validation'
  | 'regex_compilation';

/**
 * Detailed error information for policy file loading failures.
 */
export interface PolicyFileError {
  filePath: string;
  fileName: string;
  tier: 'default' | 'user' | 'admin';
  ruleIndex?: number;
  errorType: PolicyFileErrorType;
  message: string;
  details?: string;
  suggestion?: string;
}

/**
 * Result of loading policies from TOML files.
 */
export interface PolicyLoadResult {
  rules: PolicyRule[];
  errors: PolicyFileError[];
}

/**
 * Escapes special regex characters in a string for use in a regex pattern.
 * This is used for commandPrefix to ensure literal string matching.
 *
 * @param str The string to escape
 * @returns The escaped string safe for use in a regex
 */
export function escapeRegex(str: string): string {
  // eslint-disable-next-line sonarjs/regular-expr -- Static regex reviewed for lint hardening; behavior preserved.
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Converts a tier number to a human-readable tier name.
 */
function getTierName(tier: number): 'default' | 'user' | 'admin' {
  if (tier === 1) return 'default';
  if (tier === 2) return 'user';
  if (tier === 3) return 'admin';
  return 'default';
}

/**
 * Formats a Zod validation error into a readable error message.
 */
function formatSchemaError(error: ZodError, ruleIndex: number): string {
  const issues = error.issues
    .map((issue) => {
      const path = issue.path.join('.');
      return `  - Field "${path}": ${issue.message}`;
    })
    .join('\n');
  return `Invalid policy rule (rule #${ruleIndex + 1}):\n${issues}`;
}

/**
 * Validates shell command convenience syntax rules.
 * Returns an error message if invalid, or null if valid.
 */
function validateShellCommandSyntax(
  rule: PolicyRuleToml,
  ruleIndex: number,
): string | null {
  const hasCommandPrefix = rule.commandPrefix !== undefined;
  const hasCommandRegex = rule.commandRegex !== undefined;
  const hasArgsPattern = rule.argsPattern !== undefined;

  if (hasCommandPrefix || hasCommandRegex) {
    // Must have exactly toolName = "run_shell_command"
    if (rule.toolName !== 'run_shell_command' || Array.isArray(rule.toolName)) {
      return (
        `Rule #${ruleIndex + 1}: commandPrefix and commandRegex can only be used with toolName = "run_shell_command"\n` +
        `  Found: toolName = ${JSON.stringify(rule.toolName)}\n` +
        `  Fix: Set toolName = "run_shell_command" (not an array)`
      );
    }

    // Can't combine with argsPattern
    if (hasArgsPattern) {
      return (
        `Rule #${ruleIndex + 1}: cannot use both commandPrefix/commandRegex and argsPattern\n` +
        `  These fields are mutually exclusive\n` +
        `  Fix: Use either commandPrefix/commandRegex OR argsPattern, not both`
      );
    }

    // Can't use both commandPrefix and commandRegex
    if (hasCommandPrefix && hasCommandRegex) {
      return (
        `Rule #${ruleIndex + 1}: cannot use both commandPrefix and commandRegex\n` +
        `  These fields are mutually exclusive\n` +
        `  Fix: Use either commandPrefix OR commandRegex, not both`
      );
    }
  }

  return null;
}

/**
 * Transforms a priority number based on the policy tier.
 * Formula: tier + priority/1000
 *
 * @param priority The priority value from the TOML file
 * @param tier The tier (1=default, 2=user, 3=admin)
 * @returns The transformed priority
 */
function transformPriority(priority: number, tier: number): number {
  return tier + priority / 1000;
}

/**
 * Loads and parses policies from TOML files in the specified directories.
 *
 * This function:
 * 1. Scans directories for .toml files
 * 2. Parses and validates each file
 * 3. Transforms rules (commandPrefix, arrays, mcpName, priorities)
 * 4. Filters rules by approval mode
 * 5. Collects detailed error information for any failures
 *
 * @param approvalMode The current approval mode (for filtering rules by mode)
 * @param policyDirs Array of directory paths to scan for policy files
 * @param getPolicyTier Function to determine tier (1-3) for a directory
 * @returns Object containing successfully parsed rules and any errors encountered
 */
/** Parses a single TOML file, validates, and returns parsed data or pushes errors. */
async function parseAndValidateTomlFile(
  filePath: string,
  file: string,
  tierName: 'default' | 'user' | 'admin',
  errors: PolicyFileError[],
): Promise<z.infer<typeof PolicyFileSchema> | null> {
  // Read file
  const fileContent = await fs.readFile(filePath, 'utf-8');

  // Parse TOML
  let parsed: unknown;
  try {
    parsed = toml.parse(fileContent);
  } catch (e) {
    const error = e as Error;
    errors.push({
      filePath,
      fileName: file,
      tier: tierName,
      errorType: 'toml_parse',
      message: 'TOML parsing failed',
      details: error.message,
      suggestion:
        'Check for syntax errors like missing quotes, brackets, or commas',
    });
    return null;
  }

  // Validate schema
  const validationResult = PolicyFileSchema.safeParse(parsed);
  if (!validationResult.success) {
    errors.push({
      filePath,
      fileName: file,
      tier: tierName,
      errorType: 'schema_validation',
      message: 'Schema validation failed',
      details: formatSchemaError(validationResult.error, 0),
      suggestion:
        'Ensure all required fields (decision, priority) are present with correct types',
    });
    return null;
  }

  // Validate shell command convenience syntax
  for (let i = 0; i < validationResult.data.rule.length; i++) {
    const rule = validationResult.data.rule[i];
    const validationError = validateShellCommandSyntax(rule, i);
    if (validationError) {
      errors.push({
        filePath,
        fileName: file,
        tier: tierName,
        ruleIndex: i,
        errorType: 'rule_validation',
        message: 'Invalid shell command syntax',
        details: validationError,
      });
    }
  }

  return validationResult.data;
}

/** Builds a regex-compilation error entry for push into the errors array. */
function buildRegexError(
  filePath: string,
  file: string,
  tierName: 'default' | 'user' | 'admin',
  patternDesc: string,
  errorMessage: string,
): PolicyFileError {
  return {
    filePath,
    fileName: file,
    tier: tierName,
    errorType: 'regex_compilation',
    message: 'Invalid regex pattern',
    details: `Pattern: ${patternDesc}\nError: ${errorMessage}`,
    suggestion:
      'Check regex syntax for errors like unmatched brackets or invalid escape sequences',
  };
}

/** Resolves argsPattern regex and built patterns for a single rule, returning [] on error. */
function resolveRulePatterns(
  rule: PolicyRuleToml,
  filePath: string,
  file: string,
  tierName: 'default' | 'user' | 'admin',
  errors: PolicyFileError[],
): RegExp[] | null {
  let argsPatternRegex: RegExp | undefined;
  if (rule.argsPattern) {
    try {
      argsPatternRegex = new RegExp(rule.argsPattern);
    } catch (e) {
      const error = e as Error;
      errors.push(
        buildRegexError(
          filePath,
          file,
          tierName,
          rule.argsPattern,
          error.message,
        ),
      );
      return null;
    }
  }

  try {
    return buildArgsPatterns(
      argsPatternRegex,
      rule.commandPrefix,
      rule.commandRegex,
    );
  } catch (e) {
    const error = e as Error;
    const patternStr =
      // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      (typeof rule.commandRegex === 'string' && rule.commandRegex !== ''
        ? rule.commandRegex
        : '') ||
      (typeof rule.commandPrefix === 'string' && rule.commandPrefix !== ''
        ? rule.commandPrefix
        : '') ||
      'unknown';
    errors.push(
      buildRegexError(filePath, file, tierName, patternStr, error.message),
    );
    return null;
  }
}

/** Expands a single validated rule into PolicyRule objects, handling toolName/mcpName arrays. */
function expandRuleToPolicyRules(
  rule: PolicyRuleToml,
  tier: number,
  tierName: 'default' | 'user' | 'admin',
  file: string,
  patterns: RegExp[],
): PolicyRule[] {
  const argsPatterns: Array<RegExp | undefined> =
    patterns.length > 0 ? patterns : [undefined];

  return argsPatterns.flatMap((argsPattern) => {
    const toolNames: Array<string | undefined> =
      rule.toolName !== undefined
        ? // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          Array.isArray(rule.toolName)
          ? rule.toolName
          : [rule.toolName]
        : [undefined];

    return toolNames.map((toolName) => {
      const hasMcpName = rule.mcpName !== undefined && rule.mcpName !== '';
      const hasToolName = toolName !== undefined && toolName !== '';
      let effectiveToolName: string | undefined;
      if (hasMcpName && hasToolName) {
        effectiveToolName = `${rule.mcpName}__${toolName}`;
      } else if (hasMcpName) {
        effectiveToolName = `${rule.mcpName}__*`;
      } else {
        effectiveToolName = toolName;
      }

      return {
        toolName: effectiveToolName,
        decision: rule.decision,
        priority: transformPriority(rule.priority, tier),
        argsPattern,
        allowRedirection: rule.allowRedirection,
        source: `${tierName.charAt(0).toUpperCase() + tierName.slice(1)}: ${file}`,
      };
    });
  });
}

/** Transforms validated TOML rules into PolicyRule[], filtering by approval mode and handling errors. */
function transformTomlRules(
  data: z.infer<typeof PolicyFileSchema>,
  approvalMode: ApprovalMode,
  tier: number,
  tierName: 'default' | 'user' | 'admin',
  filePath: string,
  file: string,
  errors: PolicyFileError[],
): PolicyRule[] {
  return data.rule
    .filter((rule) => {
      if (!rule.modes || rule.modes.length === 0) {
        return true;
      }
      return rule.modes.includes(approvalMode);
    })
    .flatMap((rule) => {
      const patterns = resolveRulePatterns(
        rule,
        filePath,
        file,
        tierName,
        errors,
      );
      if (!patterns) {
        return [];
      }
      return expandRuleToPolicyRules(rule, tier, tierName, file, patterns);
    });
}

/** Scans a directory for .toml files, returning names or pushing a read error. */
async function scanTomlDir(
  dir: string,
  tierName: 'default' | 'user' | 'admin',
  errors: PolicyFileError[],
): Promise<string[] | null> {
  try {
    const dirEntries = await fs.readdir(dir, { withFileTypes: true });
    return dirEntries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.toml'))
      .map((entry) => entry.name);
  } catch (e) {
    const error = e as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      return null;
    }
    errors.push({
      filePath: dir,
      fileName: path.basename(dir),
      tier: tierName,
      errorType: 'file_read',
      message: `Failed to read policy directory`,
      details: error.message,
    });
    return null;
  }
}

/** Processes a single .toml file: parse, validate, transform, and push rules. */
async function processTomlFile(
  file: string,
  dir: string,
  approvalMode: ApprovalMode,
  tier: number,
  tierName: 'default' | 'user' | 'admin',
  rules: PolicyRule[],
  errors: PolicyFileError[],
): Promise<void> {
  const filePath = path.join(dir, file);
  try {
    const data = await parseAndValidateTomlFile(
      filePath,
      file,
      tierName,
      errors,
    );
    if (!data) {
      return;
    }
    const parsedRules = transformTomlRules(
      data,
      approvalMode,
      tier,
      tierName,
      filePath,
      file,
      errors,
    );
    rules.push(...parsedRules);
  } catch (e) {
    const error = e as NodeJS.ErrnoException;
    if (error.code !== 'ENOENT') {
      errors.push({
        filePath,
        fileName: file,
        tier: tierName,
        errorType: 'file_read',
        message: 'Failed to read policy file',
        details: error.message,
      });
    }
  }
}

export async function loadPoliciesFromToml(
  approvalMode: ApprovalMode,
  policyDirs: string[],
  getPolicyTier: (dir: string) => number,
): Promise<PolicyLoadResult> {
  const rules: PolicyRule[] = [];
  const errors: PolicyFileError[] = [];

  for (const dir of policyDirs) {
    const tier = getPolicyTier(dir);
    const tierName = getTierName(tier);

    const filesToLoad = await scanTomlDir(dir, tierName, errors);
    if (!filesToLoad) {
      continue;
    }

    for (const file of filesToLoad) {
      await processTomlFile(
        file,
        dir,
        approvalMode,
        tier,
        tierName,
        rules,
        errors,
      );
    }
  }

  return { rules, errors };
}

/** Expands a single TOML rule into PolicyRule objects (command prefix/regex, toolName arrays, mcpName). */
function expandTomlRule(
  rule: PolicyRuleToml,
  tier: number,
  _tierName: 'default' | 'user' | 'admin',
  filePath: string,
  _file: string,
  _errors: PolicyFileError[],
): PolicyRule[] {
  // Transform commandPrefix/commandRegex to argsPattern
  let effectiveArgsPattern = rule.argsPattern;
  const commandPrefixes: string[] = [];

  const hasCommandPrefix =
    rule.commandPrefix !== undefined &&
    (!Array.isArray(rule.commandPrefix) || rule.commandPrefix.length > 0) &&
    rule.commandPrefix !== '';
  const hasCommandRegex =
    rule.commandRegex !== undefined && rule.commandRegex !== '';
  if (hasCommandPrefix) {
    const prefixes = Array.isArray(rule.commandPrefix)
      ? rule.commandPrefix
      : // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        rule.commandPrefix !== undefined
        ? [rule.commandPrefix]
        : [];
    commandPrefixes.push(...prefixes);
  } else if (hasCommandRegex) {
    effectiveArgsPattern = `"command":"${rule.commandRegex}`;
  }

  // Expand command prefixes to multiple patterns
  const argsPatterns: Array<string | undefined> =
    commandPrefixes.length > 0
      ? commandPrefixes.map(
          (prefix) =>
            '"command":"' + escapeRegex(prefix) + String.raw`(?:[\s"]|$)`,
        )
      : [effectiveArgsPattern];

  // For each argsPattern, expand toolName arrays
  return argsPatterns.flatMap((argsPattern) => {
    const toolNames: Array<string | undefined> =
      rule.toolName !== undefined
        ? // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          Array.isArray(rule.toolName)
          ? rule.toolName
          : [rule.toolName]
        : [undefined];

    // Create a policy rule for each tool name
    return toolNames.map((toolName) => {
      const hasMcpName = rule.mcpName !== undefined && rule.mcpName !== '';
      const hasToolName = toolName !== undefined && toolName !== '';
      let effectiveToolName: string | undefined;
      if (hasMcpName && hasToolName) {
        effectiveToolName = `${rule.mcpName}__${toolName}`;
      } else if (hasMcpName) {
        effectiveToolName = `${rule.mcpName}__*`;
      } else {
        effectiveToolName = toolName;
      }

      const policyRule: PolicyRule = {
        toolName: effectiveToolName,
        decision: rule.decision,
        priority: transformPriority(rule.priority, tier),
        source: `Policy: ${path.basename(filePath)}`,
      };

      // Compile regex pattern
      if (argsPattern) {
        policyRule.argsPattern = new RegExp(argsPattern);
      }

      return policyRule;
    });
  });
}

/**
 * Loads policies from a single TOML file.
 * Simplified loader for test use cases that validates priorities and throws on errors.
 *
 * @param filePath Path to the TOML file
 * @param tier Optional tier (defaults to 1 for default tier)
 * @returns Array of PolicyRule objects
 * @throws Error if TOML parsing fails, schema validation fails, or priority is invalid
 */
export async function loadPolicyFromToml(
  filePath: string,
  tier: number = 1,
): Promise<PolicyRule[]> {
  const fileContent = await fs.readFile(filePath, 'utf-8');

  // Parse TOML
  const parsed = toml.parse(fileContent);

  // Validate schema
  const validationResult = PolicyFileSchema.safeParse(parsed);
  if (!validationResult.success) {
    throw new Error(formatSchemaError(validationResult.error, 0));
  }

  // Validate priorities are within valid range
  for (let i = 0; i < validationResult.data.rule.length; i++) {
    const rule = validationResult.data.rule[i];
    // Since schema already validates 0-999, we only need to check for explicit
    // transformed priorities that are out of range (e.g., 5.0 in raw TOML)
    // The schema enforces priority to be an integer 0-999, so non-integer
    // values like 5.0 or 2.0 in the test need special handling.
    // Check if the rule's priority would result in a value outside its tier band
    const transformedPriority = transformPriority(rule.priority, tier);
    const maxTierPriority = tier + 0.999;
    if (transformedPriority > maxTierPriority) {
      throw new Error(
        `Invalid priority: ${rule.priority} in rule #${i + 1}. ` +
          `Priority must be <= 999 to stay within tier ${tier} (max ${maxTierPriority.toFixed(3)}).`,
      );
    }
  }

  const tierName = getTierName(tier);
  const rules: PolicyRule[] = validationResult.data.rule.flatMap((rule) =>
    expandTomlRule(rule, tier, tierName, filePath, path.basename(filePath), []),
  );

  return rules;
}

/**
 * Loads default policies from the built-in policies directory.
 * Uses the ApprovalMode.DEFAULT mode filter.
 *
 * @returns Array of PolicyRule objects from all default TOML files
 */
export async function loadDefaultPolicies(): Promise<PolicyRule[]> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const policiesDir = path.join(__dirname, 'policies');

  const { rules } = await loadPoliciesFromToml(
    'default' as ApprovalMode,
    [policiesDir],
    () => 1, // Always use tier 1 (default) for built-in policies
  );

  return rules;
}
