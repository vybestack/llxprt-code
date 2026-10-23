/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `tools.core` alone does not remove the subagent tools: the registry always
 * adds `task` and `list_subagents` to the core list, and only the top-level
 * `excludeTools` setting keeps them out of the declarations sent to the model.
 * (`tools.exclude` is a policy deny rule; it leaves the tool declared.)
 *
 * Real-model tests declare exactly the tools they exercise. On the CPU-only
 * local model that cuts roughly 750 of ~3,600 prompt tokens per request, and the
 * model cannot be offered tools the test never intends it to use.
 */
export function focusedToolSettings(coreTools: readonly string[]): {
  tools: { core: string[] };
  excludeTools: string[];
} {
  return {
    tools: { core: [...coreTools] },
    excludeTools: ['task', 'list_subagents'],
  };
}
