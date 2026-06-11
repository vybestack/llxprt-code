/**
 * @plan:PLAN-20260608-ISSUE1585.P03
 * @requirement:REQ-INTERFACE-OWNERSHIP
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tools-owned interface for tool key storage.
 *
 * Provides API key management operations needed by
 * tool-key-storage, codesearch, exa-web-search, and
 * google-web-search tools.
 *
 * Consumed by: tool-key-storage, codesearch, exa-web-search,
 * google-web-search.
 * Implemented by: CoreToolKeyStorageAdapter in packages/core.
 */

export interface IToolKeyStorage {
  /**
   * Save an API key for a tool.
   * @param toolName - The tool name.
   * @param key - The API key to save.
   */
  saveKey(toolName: string, key: string): Promise<void>;

  /**
   * Get an API key for a tool.
   * @param toolName - The tool name.
   * @returns The API key, or null if not found.
   */
  getKey(toolName: string): Promise<string | null>;

  /**
   * Delete an API key for a tool.
   * @param toolName - The tool name.
   */
  deleteKey(toolName: string): Promise<void>;

  /**
   * Check if an API key exists for a tool.
   * @param toolName - The tool name.
   * @returns Whether the key exists.
   */
  hasKey(toolName: string): Promise<boolean>;

  /**
   * Resolve an API key for a tool, checking multiple sources.
   * @param toolName - The tool name.
   * @returns The resolved API key, or null if not found.
   */
  resolveKey(toolName: string): Promise<string | null>;

  /**
   * Mask an API key for display purposes.
   * @param key - The API key to mask.
   * @returns The masked key string.
   */
  maskKeyForDisplay(key: string): string;

  /**
   * Get the list of tool names that support key storage.
   * @returns Array of supported tool names.
   */
  getSupportedToolNames(): string[];
}
