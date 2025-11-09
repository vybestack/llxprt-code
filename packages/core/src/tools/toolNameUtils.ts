/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Shared utility functions for tool name validation and normalization
 *
 * This module provides common tool name handling logic extracted from:
 * - SubAgent's normalizeToolName function (lines 1666-1685)
 * - ToolNameValidator class
 * - Various OpenAI provider implementations
 *
 * Purpose: Eliminate code duplication across turn.ts, OpenAIProvider.ts,
 * and ToolNameValidator.ts while maintaining the proven logic from SubAgent.
 */

/**
 * Normalize tool name using SubAgent's proven logic
 * Based on subagent.ts:1666-1685
 */
export function normalizeToolName(rawName: string): string | null {
  if (!rawName) {
    return null;
  }

  const trimmed = rawName.trim();
  if (!trimmed) {
    return null;
  }

  // Early return optimization: if already normalized, return immediately
  if (isValidToolName(trimmed) && trimmed === trimmed.toLowerCase()) {
    return trimmed;
  }

  // Lazy loading candidates: prioritize snake_case for camelCase inputs
  const lowerTrimmed = trimmed.toLowerCase();

  // Phase 1: Check snake_case conversion first (handles camelCase properly)
  const snakeCase = toSnakeCase(trimmed);
  if (isValidToolName(snakeCase)) {
    return snakeCase;
  }

  // Phase 2: Check lowercase version (for already lowercase inputs)
  if (isValidToolName(lowerTrimmed)) {
    return lowerTrimmed;
  }

  // Phase 3: Check original trimmed version (for already valid formats)
  if (isValidToolName(trimmed)) {
    return trimmed;
  }

  // Phase 4: Handle Tool suffix (only when necessary)
  if (trimmed.endsWith('Tool')) {
    const withoutSuffix = trimmed.slice(0, -4);
    if (withoutSuffix) {
      // Check variants of the name without 'Tool' suffix
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
 * Convert string to snake_case (from SubAgent)
 */
export function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}

/**
 * Validate if a tool name follows proper naming conventions
 */
export function isValidToolName(name: string): boolean {
  if (!name || name.length === 0) {
    return false;
  }

  // Check for reasonable length
  if (name.length > 100) {
    return false;
  }

  // Check for valid characters (alphanumeric, underscores, hyphens, dots)
  const validPattern = /^[a-zA-Z0-9_.-]+$/;
  return validPattern.test(name);
}

/**
 * Find matching tool from available tools with fuzzy matching
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

  // Partial match (for cases like "writeFile" vs "write_file")
  const partialMatch = availableTools.find((tool) => {
    const toolLower = tool.toLowerCase();
    const nameLower = normalizedName.toLowerCase();
    return toolLower.includes(nameLower) || nameLower.includes(toolLower);
  });

  return partialMatch || null;
}
