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
  const normalized = new Set(
    enabledToolNames.map((name) => name.trim().toLowerCase()),
  );
  const hasTaskTool = normalized.has('task');
  const hasListSubagentsTool = normalized.has('list_subagents');
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

/**
 * Determines whether to include async subagent guidance in the prompt.
 * Async guidance should only be shown when:
 * 1. Subagent delegation is included (tools available, subagents exist)
 * 2. Global async setting is enabled
 * 3. Profile async setting is enabled
 */
export async function shouldIncludeAsyncSubagentGuidance(
  includeSubagentDelegation: boolean,
  globalAsyncEnabled: boolean,
  profileAsyncEnabled: boolean,
): Promise<boolean> {
  return includeSubagentDelegation && globalAsyncEnabled && profileAsyncEnabled;
}
