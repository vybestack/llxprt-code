/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  MemoryAccess,
  WorkspacePaths,
} from '@vybestack/llxprt-code-core/config/roles.js';
import type { LspStatusSource } from './lspControl.js';
import type { SkillManager } from '@vybestack/llxprt-code-core/skills/skillManager.js';
import type {
  AgentMemoryControl,
  AgentSkillsControl,
  AgentWorkspaceControl,
  AgentLspControl,
} from '../agent.js';
import { MemoryControl } from './memoryControl.js';
import { SkillsControl } from './skillsControl.js';
import { WorkspaceControl } from './workspaceControl.js';
import { LspControl } from './lspControl.js';

export interface NewControls {
  readonly memory: AgentMemoryControl;
  readonly skills: AgentSkillsControl;
  readonly workspace: AgentWorkspaceControl;
  readonly lsp: AgentLspControl;
  dispose(): void;
}

/**
 * Narrow config surface for building all new controls: memory, workspace
 * paths, LSP status, and the skill manager service locator.
 */
type NewControlsConfig = MemoryAccess &
  WorkspacePaths &
  LspStatusSource & {
    getSkillManager(): SkillManager;
    reloadSkills(): Promise<void>;
  };

export function buildNewControls(config: NewControlsConfig): NewControls {
  const memory = new MemoryControl({ config });
  return {
    memory,
    skills: new SkillsControl({ config }),
    workspace: new WorkspaceControl({ config }),
    lsp: new LspControl({ config }),
    dispose: () => memory.dispose(),
  };
}
