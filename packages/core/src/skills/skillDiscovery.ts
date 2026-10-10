/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { WorkspaceSkillOperations } from './workspace-skill-owner.js';
import type { SkillDefinition } from './skillLoader.js';

export async function discoverSkillsForConfig(
  skills: Pick<WorkspaceSkillOperations, 'list'>,
  initialize: () => Promise<void>,
): Promise<SkillDefinition[]> {
  await initialize();
  return skills.list(true);
}
