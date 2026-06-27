/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
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

export function buildNewControls(config: Config): NewControls {
  const memory = new MemoryControl({ config });
  return {
    memory,
    skills: new SkillsControl({ config }),
    workspace: new WorkspaceControl({ config }),
    lsp: new LspControl({ config }),
    dispose: () => memory.dispose(),
  };
}
