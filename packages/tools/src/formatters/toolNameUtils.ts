/**
 * @plan:PLAN-20260608-ISSUE1585.P05
 * @requirement:REQ-API-001, REQ-TEMPORARY-INTERFACES
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Package-local tool name validation and normalization utilities.
 *
 * Pure utility functions with zero core/cli/providers dependencies.
 */

/**
 * Normalize tool name using proven logic.
 * Returns null if the name cannot be normalized.
 */
export function normalizeToolName(rawName: string): string | null {
  if (!rawName) {
    return null;
  }

  const trimmed = rawName.trim();
  if (!trimmed) {
    return null;
  }

  // Early return: if already normalized
  if (isValidToolName(trimmed) && trimmed === trimmed.toLowerCase()) {
    return trimmed;
  }

  const lowerTrimmed = trimmed.toLowerCase();

  // Phase 1: Check snake_case conversion first (handles camelCase)
  const snakeCase = toSnakeCase(trimmed);
  if (isValidToolName(snakeCase)) {
    return snakeCase;
  }

  // Phase 2: Check lowercase version
  if (isValidToolName(lowerTrimmed)) {
    return lowerTrimmed;
  }

  // Phase 3: Check original trimmed version
  if (isValidToolName(trimmed)) {
    return trimmed;
  }

  // Phase 4: Handle Tool suffix (only when necessary)
  if (trimmed.endsWith('Tool')) {
    const withoutSuffix = trimmed.slice(0, -4);
    if (withoutSuffix) {
      const lowerWithoutSuffix = withoutSuffix.toLowerCase();
      if (isValidToolName(lowerWithoutSuffix)) {
        return lowerWithoutSuffix;
      }

      const snakeWithoutSuffix = toSnakeCase(withoutSuffix);
      if (isValidToolName(snakeWithoutSuffix)) {
        return snakeWithoutSuffix;
      }
    }
  }

  return null;
}

/**
 * Sentinel returned by {@link canonicalizeToolName} when the input name is
 * blank or whitespace-only.
 */
export const INVALID_TOOL_NAME = '__invalid_tool_name__';

function hasMultipleWords(name: string): boolean {
  const withoutFirst = name.slice(1);
  return /[A-Z]/.test(withoutFirst) || name.includes('_') || name.includes('-');
}

/**
 * Canonicalize a tool name to its normalized snake_case identifier.
 *
 * Returns {@link INVALID_TOOL_NAME} for blank/whitespace-only input so callers
 * can treat unusable names deterministically.
 */
export function canonicalizeToolName(rawName: string): string {
  const trimmed = rawName.trim();
  if (!trimmed) {
    return INVALID_TOOL_NAME;
  }

  // Issue #2184: strip API namespace prefixes (e.g. functions.run_shell_command)
  // before suffix stripping and normalization. Unambiguous qualified names
  // resolve to the registry tool name.
  let afterNamespace = trimmed;
  const segments = trimmed.split('.');
  if (segments.length > 1) {
    if (segments.some((segment) => segment.length === 0)) {
      return INVALID_TOOL_NAME;
    }

    afterNamespace = segments[segments.length - 1];
  }

  let nameToProcess = afterNamespace;

  if (afterNamespace.endsWith('Tool') && afterNamespace.length > 4) {
    const withoutTool = afterNamespace.slice(0, -4);
    if (hasMultipleWords(withoutTool)) {
      nameToProcess = withoutTool;
    }
  }

  const normalized = normalizeToolName(nameToProcess);
  if (normalized !== null) {
    return normalized;
  }

  return toSnakeCase(nameToProcess).toLowerCase();
}

/**
 * Convert string to snake_case.
 */
export function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}

/**
 * Validate if a tool name follows proper naming conventions.
 */
export function isValidToolName(name: string): boolean {
  if (!name || name.length === 0) {
    return false;
  }

  if (name.length > 100) {
    return false;
  }

  const validPattern = /^[a-zA-Z0-9_.-]+$/;
  return validPattern.test(name);
}

/**
 * Find matching tool from available tools with fuzzy matching.
 */
export function findMatchingTool(
  normalizedName: string,
  availableTools: string[],
): string | null {
  // Direct match
  if (availableTools.includes(normalizedName)) {
    return normalizedName;
  }

  // Case-insensitive match
  const lowerMatch = availableTools.find(
    (tool) => tool.toLowerCase() === normalizedName.toLowerCase(),
  );
  if (lowerMatch) {
    return lowerMatch;
  }

  // Snake case match
  const snakeCaseName = toSnakeCase(normalizedName);
  const snakeMatch = availableTools.find(
    (tool) => tool.toLowerCase() === snakeCaseName.toLowerCase(),
  );
  if (snakeMatch) {
    return snakeMatch;
  }

  // Partial match
  const partialMatch = availableTools.find((tool) => {
    const toolLower = tool.toLowerCase();
    const nameLower = normalizedName.toLowerCase();
    return toolLower.includes(nameLower) || nameLower.includes(toolLower);
  });

  return partialMatch ?? null;
}
