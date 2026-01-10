/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SubagentManager } from '../config/subagentManager.js';

export type SubagentManagerResolver = () => SubagentManager | undefined;

export async function shouldIncludeSubagentDelegation(
  enabledToolNames: string[],
  resolveSubagentManager: SubagentManagerResolver,
): Promise<boolean> {
  const normalized = enabledToolNames.map((name) => name.toLowerCase());
  const hasTaskTool = normalized.includes('task');
  const hasListSubagentsTool = normalized.includes('list_subagents');
  if (!hasTaskTool || !hasListSubagentsTool) {
    return false;
  }

  const subagentManager = resolveSubagentManager();
  if (!subagentManager) {
    return false;
  }

  try {
    const subagents = await subagentManager.listSubagents();
    return subagents.length > 0;
  } catch (_error) {
    return false;
  }
}
