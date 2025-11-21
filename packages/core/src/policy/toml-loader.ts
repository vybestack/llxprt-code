/**
 * TOML Policy Loader
 *
 * Loads and parses TOML policy files into PolicyRule objects.
 * Handles:
 * - TOML parsing with @iarna/toml
 * - Schema validation with zod
 * - argsPattern string → RegExp conversion
 * - Priority band enforcement
 * - Comprehensive error handling
 */

import * as toml from '@iarna/toml';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { PolicyDecision, type PolicyRule } from './types.js';

/**
 * Zod schema for a single policy rule in TOML
 */
const TomlRuleSchema = z.object({
  toolName: z.string().optional(),
  argsPattern: z.string().optional(),
  decision: z.nativeEnum(PolicyDecision),
  priority: z.number().optional(),
});

/**
 * Zod schema for the entire policy TOML file
 */
const PolicyFileSchema = z.object({
  rule: z.array(TomlRuleSchema),
});

/**
 * Error thrown when policy loading or validation fails
 */
export class PolicyLoadError extends Error {
  readonly path?: string;
  readonly cause?: unknown;

  constructor(message: string, path?: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'PolicyLoadError';
    this.path = path;
    this.cause = options?.cause;
  }
}

/**
 * Validates priority band according to specification:
 * - Tier 3 (Admin): 3.xxx
 * - Tier 2 (User): 2.xxx
 * - Tier 1 (Default): 1.xxx
 *
 * Throws if priority is outside valid range.
 */
function validatePriorityBand(
  priority: number | undefined,
  path: string,
): void {
  if (priority === undefined) {
    return; // Priority 0 is default and valid
  }

  // Valid range: 1.0 to 3.999
  if (priority < 1.0 || priority >= 4.0) {
    throw new PolicyLoadError(
      `Invalid priority ${priority} in ${path}. Priority must be in range [1.0, 4.0).`,
      path,
    );
  }
}

/**
 * Converts argsPattern string to RegExp with proper error handling
 */
function parseArgsPattern(pattern: string, path: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch (error) {
    throw new PolicyLoadError(
      `Invalid regular expression in argsPattern: ${pattern}`,
      path,
      { cause: error },
    );
  }
}

/**
 * Transforms a parsed TOML rule into a PolicyRule object
 */
function transformRule(
  rule: z.infer<typeof TomlRuleSchema>,
  path: string,
): PolicyRule {
  validatePriorityBand(rule.priority, path);

  const policyRule: PolicyRule = {
    decision: rule.decision,
    priority: rule.priority ?? 0,
  };

  // toolName is optional - undefined means wildcard (matches all tools)
  if (rule.toolName !== undefined) {
    policyRule.toolName = rule.toolName;
  }

  // argsPattern is optional - converts string to RegExp
  if (rule.argsPattern !== undefined) {
    policyRule.argsPattern = parseArgsPattern(rule.argsPattern, path);
  }

  return policyRule;
}

/**
 * Loads and parses a TOML policy file
 *
 * @param path - Absolute path to the TOML policy file
 * @returns Array of PolicyRule objects
 * @throws PolicyLoadError if file cannot be read, parsed, or validated
 */
export async function loadPolicyFromToml(path: string): Promise<PolicyRule[]> {
  let content: string;

  try {
    content = await readFile(path, 'utf-8');
  } catch (error) {
    throw new PolicyLoadError(`Failed to read policy file: ${path}`, path, {
      cause: error,
    });
  }

  let parsed: unknown;
  try {
    parsed = toml.parse(content);
  } catch (error) {
    const tomlError = error as Error;
    throw new PolicyLoadError(
      `Invalid TOML syntax in ${path}: ${tomlError.message}`,
      path,
      { cause: error },
    );
  }

  let validated: z.infer<typeof PolicyFileSchema>;
  try {
    validated = PolicyFileSchema.parse(parsed);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.errors.map((e) => e.message).join(', ');
      throw new PolicyLoadError(
        `Invalid policy schema in ${path}: ${errorMessages}`,
        path,
        { cause: error },
      );
    }
    throw error;
  }

  // Transform each rule
  const rules: PolicyRule[] = [];
  for (const tomlRule of validated.rule) {
    try {
      const rule = transformRule(tomlRule, path);
      rules.push(rule);
    } catch (error) {
      if (error instanceof PolicyLoadError) {
        throw error;
      }
      throw new PolicyLoadError(`Failed to transform rule in ${path}`, path, {
        cause: error,
      });
    }
  }

  return rules;
}

/**
 * Loads all default policy files from the policies directory
 *
 * @returns Array of PolicyRule objects from all default policies
 * @throws PolicyLoadError if any default policy file fails to load
 */
export async function loadDefaultPolicies(): Promise<PolicyRule[]> {
  const policyFiles = [
    'read-only.toml',
    'write.toml',
    // Note: yolo.toml and discovered.toml are loaded conditionally
  ];

  const policiesDir = new URL('../policy/policies/', import.meta.url).pathname;
  const rules: PolicyRule[] = [];

  for (const file of policyFiles) {
    const path = `${policiesDir}${file}`;
    try {
      const fileRules = await loadPolicyFromToml(path);
      rules.push(...fileRules);
    } catch (error) {
      // Re-throw with context about which default file failed
      if (error instanceof PolicyLoadError) {
        throw new PolicyLoadError(
          `Failed to load default policy ${file}: ${error.message}`,
          path,
          { cause: error },
        );
      }
      throw error;
    }
  }

  return rules;
}
