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
      // Escape quotes in command for JSON matching
      const escaped = prefix.replace(/"/g, '\\"');
      const escapedRegex = escapeRegex(escaped);
      // Use word boundary to prevent partial matches
      patterns.push(new RegExp(`"command":"${escapedRegex}(?:[\\s"]|$)`));
    }
  }

  if (commandRegex) {
    patterns.push(new RegExp(`"command":"${commandRegex}`));
  }

  if (argsPattern) {
    patterns.push(argsPattern);
  }

  return patterns;
}
