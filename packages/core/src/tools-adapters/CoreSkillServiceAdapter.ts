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
import type { Storage } from '@vybestack/llxprt-code-settings';
import type { LlxprtExtension } from '../config/configTypes.js';
import type { SkillDefinition } from '../skills/skillLoader.js';
import type { SkillManager } from '../skills/skillManager.js';
import type { WorkspaceContext } from '../utils/workspaceContext.js';

function toSkillInfo(skill: SkillDefinition): SkillInfo {
  return {
    name: skill.name,
    description: skill.description,
    location: skill.location,
  };
}

export class CoreSkillServiceAdapter implements ISkillService {
  constructor(
    private readonly skillManager: SkillManager,
    private readonly storage: Storage,
    private readonly extensions: () => LlxprtExtension[],
    private readonly workspace: Pick<WorkspaceContext, 'addDirectory'>,
  ) {}

  async activateSkill(name: string): Promise<SkillActivationResult> {
    const skill = this.skillManager.getSkill(name);

    if (!skill) {
      return {
        success: false,
        error: `Skill "${name}" not found. Available skills are: ${this.skillManager
          .getSkills()
          .map((s) => s.name)
          .join(', ')}`,
        availableSkills: this.skillManager.getSkills().map((s) => s.name),
      };
    }

    this.skillManager.activateSkill(name);
    const resourceDirectory = path.dirname(skill.location);
    this.workspace.addDirectory(resourceDirectory);

    return {
      success: true,
      instructions: skill.body,
      description: skill.description,
      location: skill.location,
      resourceDirectory,
    };
  }

  getSkillManager(): ToolsSkillManager {
    return {
      discoverSkills: async () => {
        await this.skillManager.discoverSkills(this.storage, this.extensions());
      },
      getSkills: () => this.listSkills(),
      getSkill: (name: string) => this.getSkill(name),
      setDisabledSkills: (names: string[]) =>
        this.skillManager.setDisabledSkills(names),
    };
  }

  listSkills(): SkillInfo[] {
    return this.skillManager.getSkills().map(toSkillInfo);
  }

  getSkill(name: string): SkillInfo | null {
    const skill = this.skillManager.getSkill(name);
    return skill ? toSkillInfo(skill) : null;
  }
}
