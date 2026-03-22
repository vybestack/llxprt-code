/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Storage } from '../config/storage.js';
import {
  type SkillDefinition,
  type SkillSource,
  loadSkillsFromDir,
  getBuiltinSkillsDir,
} from './skillLoader.js';
import type { GeminiCLIExtension } from '../config/config.js';

export { type SkillDefinition, type SkillSource };

export class SkillManager {
  private skills: SkillDefinition[] = [];
  private activeSkillNames: Set<string> = new Set();

  /**
   * Clears all discovered skills.
   */
  clearSkills(): void {
    this.skills = [];
  }

  /**
   * Discovers skills from built-in, extension, user and project locations.
   * Precedence: Built-in (lowest) -> Extensions -> User -> Project (highest).
   */
  async discoverSkills(
    storage: Storage,
    extensions: GeminiCLIExtension[] = [],
  ): Promise<void> {
    this.clearSkills();

    // 1. Built-in skills (lowest precedence)
    // Gracefully handle the case where the builtin directory doesn't exist yet
    const builtinSkills = await loadSkillsFromDir(
      getBuiltinSkillsDir(),
      'builtin',
    );
    this.addSkillsWithPrecedence(builtinSkills);

    // 2. Extension skills
    for (const extension of extensions) {
      if (extension.isActive && extension.skills) {
        // Mark extension skills with source if not already set
        const extensionSkills = extension.skills.map((skill) => ({
          ...skill,
          source: skill.source ?? ('extension' as const),
        }));
        this.addSkillsWithPrecedence(extensionSkills);
      }
    }

    // 3. User skills
    const userSkills = await loadSkillsFromDir(
      Storage.getUserSkillsDir(),
      'user',
    );
    this.addSkillsWithPrecedence(userSkills);

    // 4. Project skills (highest precedence)
    const projectSkills = await loadSkillsFromDir(
      storage.getProjectSkillsDir(),
      'project',
    );
    this.addSkillsWithPrecedence(projectSkills);
  }

  private addSkillsWithPrecedence(newSkills: SkillDefinition[]): void {
    const skillMap = new Map<string, SkillDefinition>();
    for (const skill of [...this.skills, ...newSkills]) {
      skillMap.set(skill.name, skill);
    }
    this.skills = Array.from(skillMap.values());
  }

  /**
   * Returns the list of enabled discovered skills.
   */
  getSkills(): SkillDefinition[] {
    return this.skills.filter((s) => !s.disabled);
  }

  /**
   * Returns all discovered skills, including disabled ones.
   */
  getAllSkills(): SkillDefinition[] {
    return this.skills;
  }

  /**
   * Filters discovered skills by name.
   */
  filterSkills(predicate: (skill: SkillDefinition) => boolean): void {
    this.skills = this.skills.filter(predicate);
  }

  /**
   * Sets the list of disabled skill names.
   */
  setDisabledSkills(disabledNames: string[]): void {
    for (const skill of this.skills) {
      skill.disabled = disabledNames.includes(skill.name);
    }
  }

  /**
   * Reads the full content (metadata + body) of a skill by name.
   */
  getSkill(name: string): SkillDefinition | null {
    return this.skills.find((s) => s.name === name) ?? null;
  }

  /**
   * Activates a skill by name.
   */
  activateSkill(name: string): void {
    this.activeSkillNames.add(name);
  }

  /**
   * Checks if a skill is active.
   */
  isSkillActive(name: string): boolean {
    return this.activeSkillNames.has(name);
  }
}
