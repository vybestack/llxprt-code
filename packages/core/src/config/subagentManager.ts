/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fsPromises from 'fs/promises';
import * as path from 'path';
import type { SubagentConfig } from '../config/types.js';
import type { ProfileManager } from './profileManager.js';
import type { NodeJSError } from '../interfaces/nodejs-error.interface.js';
import { debugLogger } from '../utils/debugLogger.js';

// Error message templates for consistency
// @plan:PLAN-20250117-SUBAGENTCONFIG.P05
const ERROR_MESSAGES = {
  INVALID_NAME:
    'Invalid subagent name. Only alphanumeric, hyphens, and underscores allowed.',
  NAME_REQUIRED: 'Subagent name is required.',
  PROFILE_REQUIRED: 'Profile name is required.',
  PROMPT_REQUIRED: 'Empty system prompt not allowed.',
  PROFILE_NOT_FOUND:
    "Profile '{profile}' not found. Use '/profile list' to see available profiles.",
  SUBAGENT_NOT_FOUND: "Subagent '{name}' not found.",
  PERMISSION_DENIED: 'Permission denied: {operation}.',
  DISK_FULL: 'No disk space: {operation}.',
  CORRUPTED_FILE: "Subagent '{name}' file is corrupted (invalid JSON).",
  INVALID_CONFIG: "Subagent '{name}' is invalid: {reason}.",
  DIRECTORY_NOT_FOUND: 'Directory not found: {path}',
  CANNOT_PERFORM_OP: 'Cannot perform operation: {reason}',
  MISSING_FIELDS:
    "Subagent '{name}' file is missing required configuration fields.",
  INVALID_TIMESTAMP:
    "Subagent '{name}' has an invalid timestamp format. Expected ISO 8601.",
  FILENAME_MISMATCH:
    "Subagent filename mismatch: expected '{expected}', found '{actual}'",
};

/**
 * Manages subagent configuration files in ~/.llxprt/subagents/
 *
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P05
 * @requirement:REQ-002
 *
 * Pattern: Follows ProfileManager design
 * Storage: JSON files in baseDir directory
 * Naming: <name>.json
 */
export class SubagentManager {
  private readonly baseDir: string;
  private readonly profileManager: ProfileManager;
  private extensionSubagents: Map<string, SubagentConfig> = new Map();
  private settingsSubagents: Map<string, SubagentConfig> = new Map();

  /**
   * @param baseDir Directory where subagent configs are stored (e.g., ~/.llxprt/subagents/)
   * @param profileManager ProfileManager instance for validation
   *
   * @plan:PLAN-20250117-SUBAGENTCONFIG.P05
   * @requirement:REQ-002
   * @pseudocode SubagentManager.md lines 1-8
   */
  constructor(baseDir: string, profileManager: ProfileManager) {
    this.baseDir = baseDir;
    this.profileManager = profileManager;
  }

  /**
   * Register extension-contributed subagents in memory
   */
  registerExtensionSubagents(
    extensionName: string,
    subagents: Array<{ name: string; profile: string; systemPrompt: string }>,
  ): void {
    for (const sa of subagents) {
      // Warn if another extension already registered this name (cross-extension conflict)
      const existing = this.extensionSubagents.get(sa.name);
      if (existing != null && existing.sourceExtension !== extensionName) {
        console.warn(
          `Extension '${extensionName}' overrides subagent '${sa.name}' previously registered by extension '${existing.sourceExtension}'. Last-registered wins.`,
        );
      }
      const now = new Date().toISOString();
      this.extensionSubagents.set(sa.name, {
        name: sa.name,
        profile: sa.profile,
        systemPrompt: sa.systemPrompt,
        createdAt: now,
        updatedAt: now,
        source: 'extension',
        sourceExtension: extensionName,
      });
    }
  }

  /**
   * Clear ALL extension subagents (used during full re-initialization)
   */
  clearExtensionSubagents(): void {
    this.extensionSubagents.clear();
  }

  /**
   * Remove subagents contributed by a specific extension (used when an extension is unloaded)
   */
  removeExtensionSubagents(extensionName: string): void {
    for (const [name, config] of this.extensionSubagents) {
      if (config.sourceExtension === extensionName) {
        this.extensionSubagents.delete(name);
      }
    }
  }

  /**
   * Register settings-defined subagents in memory
   */
  registerSettingsSubagents(
    definitions: Record<string, { profile: string; systemPrompt: string }>,
  ): void {
    const validNameRegex = /^[a-zA-Z0-9_-]+$/;
    const sentinelTimestamp = '1970-01-01T00:00:00.000Z';

    for (const [name, def] of Object.entries(definitions)) {
      // Validate name format
      if (!validNameRegex.test(name)) {
        console.warn(
          `Settings subagent '${name}' has invalid name format (must be alphanumeric, hyphens, and underscores only). Skipping.`,
        );
        continue;
      }

      // Validate required fields
      if (!def.profile || !def.systemPrompt) {
        console.warn(
          `Settings subagent '${name}' is missing required fields (profile and systemPrompt). Skipping.`,
        );
        continue;
      }

      // Profile validation is intentionally skipped (same as extension subagents)
      // Missing profiles surface as runtime errors during task() execution

      this.settingsSubagents.set(name, {
        name,
        profile: def.profile,
        systemPrompt: def.systemPrompt,
        createdAt: sentinelTimestamp,
        updatedAt: sentinelTimestamp,
        source: 'settings',
      });
    }
  }

  /**
   * Clear ALL settings subagents (used during full re-initialization)
   */
  clearSettingsSubagents(): void {
    this.settingsSubagents.clear();
  }

  /**
   * Returns true if a settings-defined subagent with this name exists (regardless of disk override)
   */
  hasSettingsSubagent(name: string): boolean {
    return this.settingsSubagents.has(name);
  }

  /**
   * Check if a subagent exists on disk (public wrapper for _diskSubagentExists)
   *
   * @license
   * Copyright 2026 Vybestack LLC
   * SPDX-License-Identifier: Apache-2.0
   */
  async subagentExistsOnDisk(name: string): Promise<boolean> {
    return this._diskSubagentExists(name);
  }

  /**
   * Check if a subagent is defined in settings (vs disk or extension)
   *
   * @license
   * Copyright 2026 Vybestack LLC
   * SPDX-License-Identifier: Apache-2.0
   */
  isSettingsSubagent(name: string): boolean {
    return this.settingsSubagents.has(name);
  }

  /**
   * Save or update a subagent configuration
   *
   * @plan:PLAN-20250117-SUBAGENTCONFIG.P05
   * @requirement:REQ-002
   * @pseudocode SubagentManager.md lines 61-128
   */
  async saveSubagent(
    name: string,
    profile: string,
    systemPrompt: string,
  ): Promise<void> {
    if (profile === undefined || profile.trim() === '') {
      throw new Error('Profile name is required.');
    }

    if (systemPrompt === undefined || systemPrompt.trim() === '') {
      throw new Error(ERROR_MESSAGES.PROMPT_REQUIRED);
    }

    // Validate profile exists
    const profileExists = await this.validateProfileReference(profile);
    if (!profileExists) {
      throw new Error(
        ERROR_MESSAGES.PROFILE_NOT_FOUND.replace('{profile}', profile),
      );
    }

    // Check if subagent exists for update vs create
    const exists = await this.subagentExists(name);

    let config: SubagentConfig;

    if (exists) {
      // Load existing to preserve createdAt
      const existing = await this.loadSubagent(name);
      config = {
        name,
        profile,
        systemPrompt,
        createdAt: existing.createdAt, // Preserve original timestamp
        updatedAt: new Date().toISOString(), // Update timestamp
      };
    } else {
      // Create new with current timestamps
      const now = new Date().toISOString();
      config = {
        name,
        profile,
        systemPrompt,
        createdAt: now,
        updatedAt: now,
      };
    }

    // Ensure directory exists
    await this.ensureDirectory();

    // Get file path via private helper
    const filePath = this.getSubagentPath(name);

    // Prepare JSON content
    const jsonString = JSON.stringify(config, null, 2);

    // Write to file
    try {
      await fsPromises.writeFile(filePath, jsonString, 'utf-8');
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        const code = (error as NodeJSError).code;
        if (code === 'EACCES') {
          throw new Error(
            ERROR_MESSAGES.PERMISSION_DENIED.replace(
              '{operation}',
              `Cannot write subagent file ${filePath}`,
            ),
          );
        } else if (code === 'ENOSPC') {
          throw new Error(
            ERROR_MESSAGES.DISK_FULL.replace(
              '{operation}',
              `Cannot write subagent file ${filePath}`,
            ),
          );
        } else if (code === 'ENOENT') {
          throw new Error(
            ERROR_MESSAGES.DIRECTORY_NOT_FOUND.replace('{path}', this.baseDir),
          );
        }
      }
      throw new Error(
        ERROR_MESSAGES.CANNOT_PERFORM_OP.replace(
          '{reason}',
          error instanceof Error ? error.message : 'Unknown error',
        ),
      );
    }
  }

  /**
   * Load a subagent configuration from disk
   *
   * @plan:PLAN-20250117-SUBAGENTCONFIG.P05
   * @requirement:REQ-002
   * @pseudocode SubagentManager.md lines 129-180
   */
  async loadSubagent(name: string): Promise<SubagentConfig> {
    // Try disk-backed (user) subagent first (highest priority)
    try {
      const config = await this._loadDiskSubagent(name);
      return { ...config, source: 'user' };
    } catch (error) {
      // Only fall through to next tier if the error is "not found"
      // All other errors (corrupt JSON, missing fields, etc.) should propagate
      if (error instanceof Error && !error.message.includes('not found')) {
        throw error;
      }
      // Fall through to settings tier
    }

    // Check settings-defined subagents (middle priority)
    const settingsSubagent = this.settingsSubagents.get(name);
    if (settingsSubagent != null) {
      return settingsSubagent;
    }

    // Check extension-contributed subagents (lowest priority)
    const extSubagent = this.extensionSubagents.get(name);
    if (extSubagent != null) {
      return extSubagent;
    }

    throw new Error(ERROR_MESSAGES.SUBAGENT_NOT_FOUND.replace('{name}', name));
  }

  /**
   * Load a subagent configuration from disk (private helper)
   */
  private async _loadDiskSubagent(name: string): Promise<SubagentConfig> {
    // Validate input via private helper
    const filePath = this.getSubagentPath(name);

    let content: string;
    // Read file
    try {
      content = await fsPromises.readFile(filePath, 'utf-8');
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        const code = (error as NodeJSError).code;
        if (code === 'ENOENT') {
          throw new Error(
            ERROR_MESSAGES.SUBAGENT_NOT_FOUND.replace('{name}', name),
          );
        } else if (code === 'EACCES') {
          throw new Error(
            ERROR_MESSAGES.PERMISSION_DENIED.replace(
              '{operation}',
              `Cannot read subagent file ${filePath}`,
            ),
          );
        }
      }
      throw new Error(
        ERROR_MESSAGES.CANNOT_PERFORM_OP.replace(
          '{reason}',
          error instanceof Error ? error.message : 'Unknown error',
        ),
      );
    }

    let config: SubagentConfig;
    // Parse JSON
    try {
      config = JSON.parse(content) as SubagentConfig;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(ERROR_MESSAGES.CORRUPTED_FILE.replace('{name}', name));
      }
      throw new Error(
        ERROR_MESSAGES.CANNOT_PERFORM_OP.replace(
          '{reason}',
          error instanceof Error ? error.message : 'Unknown error',
        ),
      );
    }

    // Validate required fields
    const {
      name: configName,
      profile,
      systemPrompt,
      createdAt,
      updatedAt,
    } = config;
    if (!configName || !profile || !systemPrompt) {
      throw new Error(
        `Subagent '${name}' file is missing required field(s): name, profile, or systemPrompt.`,
      );
    }

    if (!createdAt || !updatedAt) {
      throw new Error(
        `Subagent '${name}' file is missing required field(s): createdAt or updatedAt.`,
      );
    } // @plan:PLAN-20250117-SUBAGENTCONFIG.P05 @requirement:REQ-002

    // Validate timestamp format
    if (
      Number.isNaN(Date.parse(config.createdAt)) ||
      Number.isNaN(Date.parse(config.updatedAt))
    ) {
      throw new Error(ERROR_MESSAGES.INVALID_TIMESTAMP.replace('{name}', name));
    }

    // Validate name matches filename after sanitization
    const canonicalName = config.name.replace(/[^a-zA-Z0-9_-]/g, '');
    if (canonicalName !== path.basename(filePath, '.json')) {
      throw new Error(
        ERROR_MESSAGES.FILENAME_MISMATCH.replace(
          '{expected}',
          canonicalName,
        ).replace('{actual}', path.basename(filePath, '.json')),
      );
    }

    return config;
  }

  /**
   * List all subagent names
   *
   * @plan:PLAN-20250117-SUBAGENTCONFIG.P05
   * @requirement:REQ-002
   * @pseudocode SubagentManager.md lines 181-209
   */
  async listSubagents(): Promise<string[]> {
    // Get disk-backed user subagents (highest priority)
    const userSubagents = await this._listDiskSubagents();
    const userSet = new Set(userSubagents);

    // Add settings-defined subagents not already in user set (middle priority)
    const settingsNames = [...this.settingsSubagents.keys()].filter(
      (name) => !userSet.has(name),
    );

    // Build combined set for deduplication against extensions
    const combinedSet = new Set([...userSubagents, ...settingsNames]);

    // Add extension subagents not already in combined set (lowest priority)
    const extensionNames = [...this.extensionSubagents.keys()].filter(
      (name) => !combinedSet.has(name),
    );

    // Return deduplicated, sorted list
    return [...userSubagents, ...settingsNames, ...extensionNames].sort();
  }

  /**
   * List disk-backed subagent names (private helper)
   */
  private async _listDiskSubagents(): Promise<string[]> {
    try {
      // Ensure directory exists
      await this.ensureDirectory();

      // Read directory contents
      const files = await fsPromises.readdir(this.baseDir);

      // Filter for .json files and extract names
      const subagentFiles = files.filter((file) => file.endsWith('.json'));
      const subagentNames = subagentFiles.map((file) => file.slice(0, -5)); // Remove .json extension

      // Sort alphabetically
      subagentNames.sort();

      return subagentNames;
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        const code = (error as NodeJSError).code;
        if (code === 'ENOENT') {
          // Directory doesn't exist yet, return empty list
          return [];
        } else if (code === 'EACCES') {
          throw new Error(
            ERROR_MESSAGES.PERMISSION_DENIED.replace(
              '{operation}',
              `Cannot read subagent directory ${this.baseDir}`,
            ),
          );
        }
      }
      throw new Error(
        ERROR_MESSAGES.CANNOT_PERFORM_OP.replace(
          '{reason}',
          error instanceof Error ? error.message : 'Unknown error',
        ),
      );
    }
  }

  /**
   * Delete a subagent configuration
   *
   * @plan:PLAN-20250117-SUBAGENTCONFIG.P05
   * @requirement:REQ-002
   * @pseudocode SubagentManager.md lines 210-236
   *
   * @returns true if deleted, false if not found
   */
  async deleteSubagent(name: string): Promise<boolean> {
    // Check if this is a settings-defined subagent without a user disk override
    if (this.settingsSubagents.has(name)) {
      const diskExists = await this._diskSubagentExists(name);
      if (!diskExists) {
        throw new Error(
          `Cannot delete settings-defined subagent '${name}'. Modify it in settings.json instead.`,
        );
      }
      // User has a disk override — delete the override (settings version resurfaces)
    }

    // Check if this is an extension subagent
    if (this.extensionSubagents.has(name)) {
      const diskExists = await this._diskSubagentExists(name);
      if (!diskExists) {
        throw new Error(
          `Cannot delete extension-provided subagent '${name}'. It is managed by extension '${this.extensionSubagents.get(name)!.sourceExtension}'.`,
        );
      }
      // If user has a disk override AND extension has it, delete the user override
    }

    // Check if subagent exists
    const exists = await this.subagentExists(name);
    if (!exists) {
      return false;
    }

    // Delete file
    return this._deleteDiskSubagent(name);
  }

  /**
   * Delete a disk-backed subagent (private helper)
   */
  private async _deleteDiskSubagent(name: string): Promise<boolean> {
    const filePath = this.getSubagentPath(name);
    try {
      await fsPromises.unlink(filePath);
      return true;
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        const code = (error as NodeJSError).code;
        if (code === 'ENOENT') {
          // File already deleted
          return false;
        } else if (code === 'EACCES') {
          throw new Error(
            ERROR_MESSAGES.PERMISSION_DENIED.replace(
              '{operation}',
              `Cannot delete subagent file ${filePath}`,
            ),
          );
        }
      }
      throw new Error(
        ERROR_MESSAGES.CANNOT_PERFORM_OP.replace(
          '{reason}',
          error instanceof Error ? error.message : 'Unknown error',
        ),
      );
    }
  }

  /**
   * Check if a subagent configuration exists
   *
   * @plan:PLAN-20250117-SUBAGENTCONFIG.P05
   * @requirement:REQ-002
   * @pseudocode SubagentManager.md lines 237-262
   */
  async subagentExists(name: string): Promise<boolean> {
    const diskExists = await this._diskSubagentExists(name);
    if (diskExists) return true;
    if (this.settingsSubagents.has(name)) return true;
    return this.extensionSubagents.has(name);
  }

  /**
   * Check if a disk-backed subagent exists (private helper)
   */
  private async _diskSubagentExists(name: string): Promise<boolean> {
    // Validate input via private helper
    // This check will return false for empty or invalid names.
    let filePath: string;
    try {
      filePath = this.getSubagentPath(name);
    } catch (_error) {
      // getSubagentPath throws for invalid names. If it throws here, the agent doesn't exist.
      return false;
    }

    // Check file existence
    try {
      await fsPromises.access(filePath);
      return true;
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        const code = (error as NodeJSError).code;
        if (code === 'ENOENT') {
          return false;
        }
      }
      // For other access errors, treat as not existing to be safe (aligns with pseudocode).
      return false;
    }
  }

  /**
   * Validate that a profile exists in ProfileManager
   *
   * @plan:PLAN-20250117-SUBAGENTCONFIG.P05
   * @requirement:REQ-002
   * @pseudocode SubagentManager.md lines 263-281
   */
  async validateProfileReference(profileName: string): Promise<boolean> {
    // Validate input
    if (
      profileName === undefined ||
      profileName === null ||
      profileName.trim() === ''
    ) {
      return false;
    }

    // Check if profile exists using the injected ProfileManager instance.
    try {
      const availableProfiles = await this.profileManager.listProfiles();
      return availableProfiles.includes(profileName);
    } catch (error) {
      // If ProfileManager fails, we cannot validate
      debugLogger.warn(
        `Cannot validate profile reference '${profileName}': ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return false;
    }
  }

  /**
   * Get full path to subagent config file
   *
   * @plan:PLAN-20250117-SUBAGENTCONFIG.P05
   * @requirement:REQ-002
   * @pseudocode SubagentManager.md lines 9-43
   */
  private getSubagentPath(name: string): string {
    // Centralize all name validation in this helper
    // 1. Validate name is not undefined or null
    if (name === undefined || name === null) {
      throw new Error(ERROR_MESSAGES.NAME_REQUIRED);
    }

    // 2. Validate name is not an empty string or just whitespace
    if (name.trim() === '') {
      throw new Error(ERROR_MESSAGES.INVALID_NAME);
    }

    // 3. Sanitize filename (prevent path traversal)
    const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, '');

    // 4. Validate name after sanitization
    if (sanitizedName !== name) {
      throw new Error(ERROR_MESSAGES.INVALID_NAME);
    }

    // 5. Validate baseDir is provided to the instance
    if (
      this.baseDir === undefined ||
      this.baseDir === null ||
      this.baseDir.trim() === ''
    ) {
      throw new Error('Base directory is required');
    }

    // 6. Validate profileManager is provided to the instance
    if (this.profileManager === undefined || this.profileManager === null) {
      throw new Error('ProfileManager instance is required');
    }

    // Construct full path
    return path.join(this.baseDir, `${sanitizedName}.json`);
  }

  /**
   * Ensure subagent directory exists, create if not
   *
   * @plan:PLAN-20250117-SUBAGENTCONFIG.P05
   * @requirement:REQ-002
   * @pseudocode SubagentManager.md lines 45-60
   */
  private async ensureDirectory(): Promise<void> {
    try {
      // Create directory if it doesn't exist
      await fsPromises.mkdir(this.baseDir, { recursive: true });
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        const code = (error as NodeJSError).code;
        if (code === 'EACCES') {
          throw new Error(
            ERROR_MESSAGES.PERMISSION_DENIED.replace(
              '{operation}',
              `Cannot create directory ${this.baseDir}`,
            ),
          );
        } else if (code === 'ENOSPC') {
          throw new Error(
            ERROR_MESSAGES.DISK_FULL.replace(
              '{operation}',
              `Cannot create directory ${this.baseDir}`,
            ),
          );
        }
      }
      throw new Error(
        ERROR_MESSAGES.CANNOT_PERFORM_OP.replace(
          '{reason}',
          error instanceof Error ? error.message : 'unknown error',
        ),
      );
    }
  }
}
