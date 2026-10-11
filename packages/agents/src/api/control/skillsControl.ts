/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { WorkspaceSkillOperations } from '@vybestack/llxprt-code-core/skills/workspace-skill-owner.js';
import type { SkillDefinition } from '@vybestack/llxprt-code-core/skills/skillLoader.js';
import type { AgentSkillsControl, SkillInfo } from '../agent.js';
import { createControlError } from './errorUtils.js';

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
  private closed = false;
  private readonly accepted = new Set<Promise<void>>();
  constructor(
    private readonly operations: Pick<
      WorkspaceSkillOperations,
      'list' | 'find' | 'reload' | 'isAdminEnabled'
    >,
  ) {}

  list(opts?: { readonly includeDisabled?: boolean }): readonly SkillInfo[] {
    return this.operations.list(opts?.includeDisabled).map(toSkillInfo);
  }

  get(name: string): SkillInfo | undefined {
    const skill = this.operations.find(name);
    return skill === undefined ? undefined : toSkillInfo(skill);
  }

  async reload(): Promise<void> {
    try {
      if (this.closed) throw new Error('Skill facade is closed');
      const operation = this.operations.reload();
      this.accepted.add(operation);
      try {
        await operation;
      } finally {
        this.accepted.delete(operation);
      }
    } catch (err) {
      throw createControlError('Failed to reload skills', err);
    }
  }

  closeAdmission(): void {
    this.closed = true;
  }

  async dispose(): Promise<void> {
    this.closeAdmission();
    const results = await Promise.allSettled([...this.accepted]);
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(failures, 'Skill facade cleanup failed');
  }

  isAdminEnabled(): boolean {
    return this.operations.isAdminEnabled();
  }
}
