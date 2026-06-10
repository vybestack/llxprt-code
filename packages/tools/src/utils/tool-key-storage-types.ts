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
 * Package-local tool key storage types and pure-utility helpers.
 *
 * Provides the registry metadata types and display helpers needed by
 * tool-key-storage, codesearch, exa-web-search, and google-web-search.
 * The actual ToolKeyStorage class with SecureStore integration remains
 * in core. Self-contained with zero core imports.
 */

/** Metadata about a registered tool key. */
export interface ToolKeyRegistryEntry {
  /** The key used to reference the tool (e.g., 'exa'). */
  toolKeyName: string;
  /** Human-readable display name (e.g., 'Exa Search'). */
  displayName: string;
  /** URL parameter name for API key. */
  urlParamName: string;
  /** Description of the key's purpose. */
  description: string;
}

/**
 * Registry of supported tool keys and their metadata.
 */
export const TOOL_KEY_REGISTRY = new Map<string, ToolKeyRegistryEntry>([
  [
    'exa',
    {
      toolKeyName: 'exa',
      displayName: 'Exa Search',
      urlParamName: 'exaApiKey',
      description: 'API key for Exa web and code search',
    },
  ],
]);

/**
 * Checks if a tool name is a valid key storage name.
 * @param toolName - The tool name to check.
 * @returns true if the tool name has a registered entry.
 */
export function isValidToolKeyName(toolName: string): boolean {
  return TOOL_KEY_REGISTRY.has(toolName);
}

/**
 * Gets the registry entry for a tool key name.
 * @param toolName - The tool name to look up.
 * @returns The registry entry, or undefined if not found.
 */
export function getToolKeyEntry(
  toolName: string,
): ToolKeyRegistryEntry | undefined {
  return TOOL_KEY_REGISTRY.get(toolName);
}

/**
 * Returns the list of all supported tool key names.
 * @returns Array of supported tool key name strings.
 */
export function getSupportedToolNames(): string[] {
  return Array.from(TOOL_KEY_REGISTRY.keys());
}

/**
 * Masks an API key for safe display, showing only first 2 and last 2 characters.
 * Keys of 8 characters or fewer are fully masked.
 * @param key - The API key to mask.
 * @returns The masked key string.
 */
export function maskKeyForDisplay(key: string): string {
  if (key.length <= 8) return '*'.repeat(key.length);
  const first2 = key.substring(0, 2);
  const last2 = key.substring(key.length - 2);
  const middle = '*'.repeat(key.length - 4);
  return `${first2}${middle}${last2}`;
}
