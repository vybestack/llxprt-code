/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Environment/trust ceilings for the current process.
 *
 * These ceilings are the upper bound granted by the environment (startup flags, OS-level
 * policy, trust prompts). Profile policy can only narrow them; nothing in the profiles
 * tree raises a ceiling above what the environment allows.
 */
export interface TrustToolEnvironmentPort {
  getToolCeiling(): {
    allowedTools: readonly string[];
    disabledTools: readonly string[];
  };
  isToolAvailable(toolId: string): boolean;
  getShellCeiling(): 'allowlist' | 'all' | 'none';
  getApprovalCeiling(): 'yolo' | 'standard' | 'strict';
}
