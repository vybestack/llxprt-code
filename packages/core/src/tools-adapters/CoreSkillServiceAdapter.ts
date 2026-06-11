/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import type {
  ISkillService,
  SkillActivationResult,
  SkillInfo,
  SkillManager as ToolsSkillManager,
} from '@vybestack/llxprt-code-tools';
import type { Config } from '../config/config.js';
import { getFolderStructure } from '../utils/getFolderStructure.js';
import type { SkillDefinition } from '../skills/skillLoader.js';

function toSkillInfo(skill: SkillDefinition): SkillInfo {
  return {
    name: skill.name,
    description: skill.description,
    location: skill.location,
  };
}

export class CoreSkillServiceAdapter implements ISkillService {
  private folderStructureCache = new Map<string, string>();

  constructor(private readonly config: Config) {}

  async activateSkill(name: string): Promise<SkillActivationResult> {
    const skillManager = this.config.getSkillManager();
    const skill = skillManager.getSkill(name);

    if (!skill) {
      return {
        success: false,
        error: `Skill "${name}" not found. Available skills are: ${skillManager
          .getSkills()
          .map((s) => s.name)
          .join(', ')}`,
        availableSkills: skillManager.getSkills().map((s) => s.name),
      };
    }

    skillManager.activateSkill(name);
    const resourceDirectory = path.dirname(skill.location);
    this.config.getWorkspaceContext().addDirectory(resourceDirectory);
    const folderStructure = await this.getFolderStructure(name);

    return {
      success: true,
      instructions: skill.body,
      description: skill.description,
      location: skill.location,
      folderStructure,
      resourceDirectory,
    };
  }

  getSkillManager(): ToolsSkillManager {
    const skillManager = this.config.getSkillManager();
    return {
      discoverSkills: async () => {
        await skillManager.discoverSkills(
          this.config.storage,
          this.config.getExtensions(),
        );
      },
      getSkills: () => this.listSkills(),
      getSkill: (name: string) => this.getSkill(name),
      setDisabledSkills: (names: string[]) =>
        skillManager.setDisabledSkills(names),
    };
  }

  listSkills(): SkillInfo[] {
    return this.config.getSkillManager().getSkills().map(toSkillInfo);
  }

  getSkill(name: string): SkillInfo | null {
    const skill = this.config.getSkillManager().getSkill(name);
    return skill ? toSkillInfo(skill) : null;
  }

  async getFolderStructure(skillName: string): Promise<string> {
    const cached = this.folderStructureCache.get(skillName);
    if (cached !== undefined) {
      return cached;
    }

    const skill = this.config.getSkillManager().getSkill(skillName);
    if (!skill) {
      return '';
    }

    const folderStructure = await getFolderStructure(
      path.dirname(skill.location),
    );
    this.folderStructureCache.set(skillName, folderStructure);
    return folderStructure;
  }
}
