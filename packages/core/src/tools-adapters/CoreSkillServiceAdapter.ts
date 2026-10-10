/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  ISkillService,
  SkillActivationResult,
  SkillInfo,
} from '@vybestack/llxprt-code-tools';
import type { WorkspaceSkillOperations } from '../skills/workspace-skill-owner.js';

export class CoreSkillServiceAdapter implements ISkillService {
  constructor(
    private readonly operations: Pick<
      WorkspaceSkillOperations,
      'activate' | 'list' | 'find'
    >,
  ) {}

  activateSkill(name: string): Promise<SkillActivationResult> {
    return this.operations.activate(name);
  }

  listSkills(): SkillInfo[] {
    return this.operations.list().map(({ name, description, location }) => ({
      name,
      description,
      location,
    }));
  }

  getSkill(name: string): SkillInfo | null {
    const skill = this.operations.find(name);
    return skill
      ? {
          name: skill.name,
          description: skill.description,
          location: skill.location,
        }
      : null;
  }
}
