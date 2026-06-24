/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P27
 * @requirement:REQ-021
 *
 * Shared typed inputs/outputs for the durable app-service subpath
 * (`@vybestack/llxprt-code-agents/app-service.js`). REQ-021 separates durable
 * config/app concerns from the live `Agent` runtime facade: these types are the
 * contracts for the standalone, behavior-real functions that wrap existing
 * persistence services (SettingsService, ProfileManager, SkillManager,
 * ExtensionLoader, MemoryTool) without requiring a live agent.
 */

import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { Profile } from '@vybestack/llxprt-code-settings';
import type { MCPServerConfig } from '@vybestack/llxprt-code-core/config/config.js';
import type { SkillDefinition } from '@vybestack/llxprt-code-core/skills/skillManager.js';
import type { GeminiCLIExtension } from '@vybestack/llxprt-code-core/config/config.js';

/**
 * The kind a CLI touchpoint is mapped to in the command→API map.
 *   - runtime    -> a live Agent method path (affects the active turn).
 *   - subpath    -> a durable app-service concern exposed publicly.
 *   - cli-local  -> pure UI/UX with no core dependency.
 */
export type CommandApiKind = 'runtime' | 'subpath' | 'cli-local';

/**
 * One row of the canonical command→API map.
 */
export interface CommandApiMapping {
  readonly command: string;
  readonly kind: CommandApiKind;
  readonly target: string;
  readonly exportName?: string;
  readonly note?: string;
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

/**
 * Input for {@link saveCurrentProfile}. The durable store is keyed by name; the
 * concrete profile payload to persist is provided explicitly (no live Agent).
 */
export interface SaveProfileInput {
  /** Optional custom profiles directory (used for tests / non-default homes). */
  readonly profilesDir?: string;
  /** The profile name to persist under. */
  readonly name: string;
  /** The concrete profile payload to persist. */
  readonly profile: Profile;
}

export interface SaveProfileResult {
  readonly name: string;
  readonly saved: true;
}

export interface ListProfilesInput {
  readonly profilesDir?: string;
}

export interface ListProfilesResult {
  readonly profiles: readonly string[];
}

export interface DeleteProfileInput {
  readonly profilesDir?: string;
  readonly name: string;
}

export interface DeleteProfileResult {
  readonly name: string;
  readonly deleted: true;
}

// ---------------------------------------------------------------------------
// MCP server config
// ---------------------------------------------------------------------------

export interface AddMcpServerInput {
  readonly settingsService: SettingsService;
  readonly name: string;
  readonly config: MCPServerConfig;
}

export interface AddMcpServerResult {
  readonly name: string;
  readonly servers: Readonly<Record<string, MCPServerConfig>>;
}

export interface RemoveMcpServerInput {
  readonly settingsService: SettingsService;
  readonly name: string;
}

export interface RemoveMcpServerResult {
  readonly name: string;
  readonly removed: boolean;
  readonly servers: Readonly<Record<string, MCPServerConfig>>;
}

// ---------------------------------------------------------------------------
// Memory file edits
// ---------------------------------------------------------------------------

export interface EditMemoryInput {
  /** Absolute path to the durable memory file to append to. */
  readonly memoryFilePath: string;
  /** The fact/entry text to append. */
  readonly fact: string;
}

export interface EditMemoryResult {
  readonly memoryFilePath: string;
  readonly written: true;
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export type SkillAction = 'list' | 'enable' | 'disable';

export interface ManageSkillsInput {
  /** A discovered SkillManager whose state to read/mutate. */
  readonly manager: ManageSkillsManager;
  readonly action: SkillAction;
  /** Skill names to enable/disable (ignored for 'list'). */
  readonly names?: readonly string[];
  /**
   * Optional SettingsService for durable persistence of the disabled set
   * beyond the manager instance.
   */
  readonly settingsService?: SettingsService;
}

/** Minimal SkillManager surface this app-service depends on. */
export interface ManageSkillsManager {
  getAllSkills(): SkillDefinition[];
  getSkills(): SkillDefinition[];
  setDisabledSkills(disabledNames: string[]): void;
}

export interface ManageSkillsSkill {
  readonly name: string;
  readonly description: string;
  readonly disabled: boolean;
  readonly source?: string;
}

export interface ManageSkillsResult {
  readonly action: SkillAction;
  readonly skills: readonly ManageSkillsSkill[];
  readonly disabled: readonly string[];
}

// ---------------------------------------------------------------------------
// Extensions
// ---------------------------------------------------------------------------

export type ExtensionAction = 'list' | 'enable' | 'disable';

export interface ManageExtensionsInput {
  /** A loader whose active extensions to read. */
  readonly loader: ManageExtensionsLoader;
  readonly action: ExtensionAction;
  /** Extension names to enable/disable (ignored for 'list'). */
  readonly names?: readonly string[];
  /**
   * SettingsService used to persist the durable disabled-extensions set.
   * Required for enable/disable so the choice survives beyond the loader.
   */
  readonly settingsService?: SettingsService;
}

/** Minimal ExtensionLoader surface this app-service depends on. */
export interface ManageExtensionsLoader {
  getExtensions(): GeminiCLIExtension[];
}

export interface ManageExtensionsExtension {
  readonly name: string;
  readonly version: string;
  readonly isActive: boolean;
  readonly disabled: boolean;
}

export interface ManageExtensionsResult {
  readonly action: ExtensionAction;
  readonly extensions: readonly ManageExtensionsExtension[];
  readonly disabled: readonly string[];
}

// ---------------------------------------------------------------------------
// Settings mutation
// ---------------------------------------------------------------------------

export interface MutateSettingsInput {
  readonly settingsService: SettingsService;
  readonly changes: Readonly<Record<string, unknown>>;
}

export interface MutateSettingsResult {
  readonly settings: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Diagnostics / About
// ---------------------------------------------------------------------------

export interface DiagnosticsInput {
  readonly settingsService: SettingsService;
}

export interface DiagnosticsResult {
  readonly provider: string;
  readonly model: string;
  readonly profile: string | null;
  readonly providerSettings: Readonly<Record<string, unknown>>;
  readonly ephemeralSettings: Readonly<Record<string, unknown>>;
  readonly modelParams: Readonly<Record<string, unknown>>;
  /** Configured sandbox preference surfaced from settings (never fabricated). */
  readonly sandbox: string | null;
}

export interface AboutInput {
  readonly settingsService: SettingsService;
}

export interface AboutResult {
  readonly provider: string;
  readonly model: string;
  readonly profile: string | null;
  readonly sandbox: string | null;
}
