/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Escapes special regex characters in a string.
 */
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Maximum source length for admin-supplied policy regex patterns. */
const MAX_POLICY_REGEX_SOURCE_LENGTH = 1024;

/**
 * Validates that a policy-supplied regex pattern is within safe bounds.
 * Policy regex comes from admin-controlled TOML files, but we still enforce
 * a source length limit as defence-in-depth against ReDoS.
 */
function validatePolicyRegex(source: string): void {
  if (source.length > MAX_POLICY_REGEX_SOURCE_LENGTH) {
    throw new Error(
      `Policy regex pattern exceeds maximum allowed length of ${MAX_POLICY_REGEX_SOURCE_LENGTH}`,
    );
  }
}

/**
 * Builds regex patterns for policy matching from command prefixes or regex.
 * Handles both string and array inputs for commandPrefix.
 */
export function buildArgsPatterns(
  argsPattern?: RegExp,
  commandPrefix?: string | string[],
  commandRegex?: string,
): RegExp[] {
  const patterns: RegExp[] = [];

  if (commandPrefix) {
    const prefixes = Array.isArray(commandPrefix)
      ? commandPrefix
      : [commandPrefix];
    for (const prefix of prefixes) {
      // Escape backslashes first, then quotes, for JSON matching
      const escaped = prefix.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const escapedRegex = escapeRegex(escaped);
      // Use word boundary to prevent partial matches
      patterns.push(new RegExp(`"command":"${escapedRegex}(?:[\\s"]|$)`));
    }
  }

  if (commandRegex) {
    validatePolicyRegex(commandRegex);
    patterns.push(new RegExp(`"command":"${commandRegex}`));
  }

  if (argsPattern) {
    validatePolicyRegex(argsPattern.source);
    patterns.push(argsPattern);
  }

  return patterns;
}
