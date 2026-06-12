/**
 * @plan:PLAN-20260608-ISSUE1585.P03
 * @requirement:REQ-INTERFACE-OWNERSHIP
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Result of a skill activation request. */
export interface SkillActivationResult {
  /** Whether the activation succeeded. */
  success: boolean;
  /** The activated skill instructions, if any. */
  instructions?: string;
  /** Skill description. */
  description?: string;
  /** Skill source location. */
  location?: string;
  /** Folder structure for skill resources. */
  folderStructure?: string;
  /** Directory added to workspace context for skill resources. */
  resourceDirectory?: string;
  /** Error message if activation failed. */
  error?: string;
  /** Available skill names when activation fails because the skill is missing. */
  availableSkills?: string[];
}

export interface SkillInfo {
  name: string;
  description?: string;
  location?: string;
}

/** Opaque handle to the skill manager. */
export interface SkillManager {
  /** Discover available skills. */
  discoverSkills?: (...args: unknown[]) => Promise<void>;
  /** Get list of skills. */
  getSkills?: () => SkillInfo[];
  /** Get one skill by name. */
  getSkill?: (name: string) => SkillInfo | null;
  /** Set disabled skills. */
  setDisabledSkills?: (names: string[]) => void;
}

export interface ISkillService {
  /**
   * Activate a skill by name.
   * @param name - The skill name to activate.
   * @returns The activation result.
   */
  activateSkill(name: string): Promise<SkillActivationResult>;

  /**
   * Get the skill manager instance.
   * @returns The skill manager.
   */
  getSkillManager(): SkillManager;

  /**
   * List available skills for schema generation and validation.
   */
  listSkills(): SkillInfo[];

  /**
   * Get one skill by name.
   */
  getSkill(name: string): SkillInfo | null;

  /**
   * Get the folder structure for a skill's resource directory.
   */
  getFolderStructure(skillName: string): Promise<string>;
}
