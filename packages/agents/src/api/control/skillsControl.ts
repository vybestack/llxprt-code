/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SkillDefinition } from '@vybestack/llxprt-code-core/skills/skillLoader.js';
import type { AgentSkillsControl, SkillInfo } from '../agent.js';
import type { WorkspaceSkillSurface } from '../workspace-skill-surface.js';
import { createControlError } from './errorUtils.js';

export interface SkillsControlDeps {
  readonly skills: Pick<
    WorkspaceSkillSurface,
    'getSkills' | 'getAllSkills' | 'getSkill' | 'isAdminEnabled'
  >;
  readonly reload: () => Promise<void>;
}

function toSkillInfo(s: SkillDefinition): SkillInfo {
  return {
    name: s.name,
    description: s.description,
    ...(s.disabled !== undefined ? { disabled: s.disabled } : {}),
    ...(s.source !== undefined ? { source: s.source } : {}),
    location: s.location,
  };
}

export class SkillsControl implements AgentSkillsControl {
  constructor(private readonly deps: SkillsControlDeps) {}

  list(opts?: { readonly includeDisabled?: boolean }): readonly SkillInfo[] {
    const source =
      opts?.includeDisabled === true
        ? this.deps.skills.getAllSkills()
        : this.deps.skills.getSkills();
    return source.map(toSkillInfo);
  }

  get(name: string): SkillInfo | undefined {
    const skill = this.deps.skills.getSkill(name);
    return skill === null ? undefined : toSkillInfo(skill);
  }

  async reload(): Promise<void> {
    try {
      await this.deps.reload();
    } catch (err) {
      throw createControlError('Failed to reload skills', err);
    }
  }

  isAdminEnabled(): boolean {
    return this.deps.skills.isAdminEnabled();
  }
}
