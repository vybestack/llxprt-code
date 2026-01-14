/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Storage } from '../config/storage.js';

import {
  type SkillDefinition,
  type SkillSource,
  loadSkillsFromDir,
  getBuiltinSkillsDir,
} from './skillLoader.js';
import type { GeminiCLIExtension } from '../config/config.js';

export { type SkillDefinition, type SkillSource };

// ESM-compatible __dirname equivalent
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Configuration for a built-in skill using config.json format.
 */
interface BuiltinSkillConfig {
  name?: string;
  description?: string;
  version?: string;
  author?: string;
  license?: string;
  keywords?: string[];
  disabled?: boolean;
}

export class SkillManager {
  private skills: SkillDefinition[] = [];
  private activeSkillNames: Set<string> = new Set();
  private adminSkillsEnabled = true;

  /**
   * Clears all discovered skills.
   */
  clearSkills(): void {
    this.skills = [];
  }

  /**
   * Sets administrative settings for skills.
   */
  setAdminSettings(enabled: boolean): void {
    this.adminSkillsEnabled = enabled;
  }

  /**
   * Returns true if skills are enabled by the admin.
   */
  isAdminEnabled(): boolean {
    return this.adminSkillsEnabled;
  }

  /**
   * Discovers skills from built-in, extension, user and workspace locations.
   * Precedence: Built-in (lowest) -> Extensions -> User -> Workspace (highest).
   */
  async discoverSkills(
    storage: Storage,
    extensions: GeminiCLIExtension[] = [],
  ): Promise<void> {
    this.clearSkills();

    // 1. Built-in skills (lowest precedence)
    // First try to discover config.json-based skills recursively, then fall back to SKILL.md
    let builtinSkills = await this.discoverBuiltinSkills();
    if (builtinSkills.length === 0) {
      // Fall back to existing SKILL.md-based discovery
      builtinSkills = await loadSkillsFromDir(getBuiltinSkillsDir(), 'builtin');
    }
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

    // 4. Workspace skills (highest precedence)
    const projectSkills = await loadSkillsFromDir(
      storage.getProjectSkillsDir(),
      'project',
    );
    this.addSkillsWithPrecedence(projectSkills);
  }

  /**
   * Recursively discover built-in skills from nested directories using config.json.
   */
  async discoverBuiltinSkills(): Promise<SkillDefinition[]> {
    const builtinDir = this.resolveBuiltinSkillsDir();

    if (!(await this.pathExists(builtinDir))) {
      return [];
    }

    const skills: SkillDefinition[] = [];
    await this.discoverSkillsRecursive(builtinDir, skills);

    return skills;
  }

  /**
   * Recursively walk skill directories to discover config.json-based skills.
   */
  private async discoverSkillsRecursive(
    dir: string,
    skills: SkillDefinition[],
  ): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Check for config.json in this directory
          const configPath = path.join(fullPath, 'config.json');

          if (await this.pathExists(configPath)) {
            // This is a skill directory
            try {
              const skill = await this.loadSkillFromConfig(
                configPath,
                fullPath,
                entry.name,
              );
              if (skill) {
                skills.push(skill);
              }
            } catch (error) {
              console.warn(
                `Failed to load builtin skill ${entry.name}:`,
                error,
              );
              // Continue with other skills
            }
          } else {
            // Recurse into subdirectories
            await this.discoverSkillsRecursive(fullPath, skills);
          }
        }
      }
    } catch {
      // Directory read error - silently continue
    }
  }

  /**
   * Load a skill from its config.json file.
   */
  private async loadSkillFromConfig(
    configPath: string,
    skillPath: string,
    name: string,
  ): Promise<SkillDefinition | null> {
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      const config: BuiltinSkillConfig = JSON.parse(content);

      // Validate required fields
      if (!config || typeof config !== 'object') {
        return null;
      }

      // Skill name can come from config or use directory name
      const skillName = config.name || name;

      // Look for skill instruction file (SKILL.md or similar)
      const body = await this.loadSkillBody(skillPath);

      return {
        name: skillName,
        description: config.description || '',
        location: skillPath,
        body,
        source: 'builtin',
        disabled: config.disabled,
      };
    } catch {
      return null;
    }
  }

  /**
   * Load the skill body/instructions from the skill directory.
   * Looks for SKILL.md, instructions.md, or returns empty string.
   */
  private async loadSkillBody(skillPath: string): Promise<string> {
    const bodyFiles = ['SKILL.md', 'instructions.md', 'README.md'];

    for (const file of bodyFiles) {
      const filePath = path.join(skillPath, file);
      try {
        if (await this.pathExists(filePath)) {
          const content = await fs.readFile(filePath, 'utf-8');
          // Extract body after frontmatter if present
          const frontmatterRegex = /^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)/;
          const match = content.match(frontmatterRegex);
          return match ? match[1].trim() : content.trim();
        }
      } catch {
        // Continue to next file
      }
    }

    return '';
  }

  /**
   * Resolve the built-in skills directory using multiple strategies.
   */
  resolveBuiltinSkillsDir(): string {
    // Strategy 1: CLI root from environment (production)
    if (process.env.LLXPRT_CLI_ROOT) {
      const envPath = path.join(
        process.env.LLXPRT_CLI_ROOT,
        'skills',
        'builtin',
      );
      if (fsSync.existsSync(envPath)) return envPath;
    }

    // Strategy 2: Relative to this file's package (development - core package)
    const devPath = path.join(__dirname, '..', '..', 'skills', 'builtin');
    if (fsSync.existsSync(devPath)) return devPath;

    // Strategy 3: Project root skills directory (development - monorepo root)
    const projectRoot = path.join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'skills',
      'builtin',
    );
    if (fsSync.existsSync(projectRoot)) return projectRoot;

    // Strategy 4: Packaged assets location
    const assetsPath = path.join(__dirname, 'assets', 'skills', 'builtin');
    if (fsSync.existsSync(assetsPath)) return assetsPath;

    // Strategy 5: Fallback to existing getBuiltinSkillsDir()
    return getBuiltinSkillsDir();
  }

  /**
   * Check if a path exists.
   */
  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
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
