/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260626-RUNTIMEBOUNDARY.P03
 *
 * AgentSkillsControl implementation. Delegates to the bound Config's
 * SkillManager so clients query/reload skills without a Config escape hatch.
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SkillDefinition } from '@vybestack/llxprt-code-core/skills/skillLoader.js';
import type { AgentSkillsControl, SkillInfo } from '../agent.js';
import { createControlError } from './errorUtils.js';

/**
 * Deps bundle injected by AgentImpl so SkillsControl can read the live Config
 * skill surface.
 * @plan:PLAN-20260626-RUNTIMEBOUNDARY.P03
 */
export interface SkillsControlDeps {
  readonly config: Config;
}

/** Projects a raw SkillDefinition onto the public SkillInfo shape. */
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
    const mgr = this.deps.config.getSkillManager();
    const source =
      opts?.includeDisabled === true ? mgr.getAllSkills() : mgr.getSkills();
    return source.map(toSkillInfo);
  }

  get(name: string): SkillInfo | undefined {
    const mgr = this.deps.config.getSkillManager();
    const skill = mgr.getSkill(name);
    if (skill === null) {
      return undefined;
    }
    return toSkillInfo(skill);
  }

  async reload(): Promise<void> {
    try {
      await this.deps.config.reloadSkills();
    } catch (err) {
      throw createControlError('Failed to reload skills', err);
    }
  }

  isAdminEnabled(): boolean {
    return this.deps.config.getSkillManager().isAdminEnabled();
  }
}
