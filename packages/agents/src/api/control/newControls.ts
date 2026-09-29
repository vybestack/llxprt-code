/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type {
  AgentMemoryControl,
  AgentSkillsControl,
  AgentWorkspaceControl,
  AgentLspControl,
} from '../agent.js';
import { MemoryControl } from './memoryControl.js';
import { SkillsControl } from './skillsControl.js';
import type { WorkspaceSkillSurface } from '../workspace-skill-surface.js';
import type { WorkspaceLspPort } from '@vybestack/llxprt-code-core/config/lspIntegration.js';
import { WorkspaceControl } from './workspaceControl.js';
import { LspControl } from './lspControl.js';
import type { WorkspaceFileAccess } from '../workspace-file-access.js';

export interface NewControls {
  readonly memory: AgentMemoryControl;
  readonly skills: AgentSkillsControl;
  readonly workspace: AgentWorkspaceControl;
  readonly lsp: AgentLspControl;
  dispose(): void;
}

export function buildNewControls(
  config: Config,
  messageBus: MessageBus,
  skills: WorkspaceSkillSurface,
  lsp: WorkspaceLspPort,
  access?: WorkspaceFileAccess,
): NewControls {
  const memory = new MemoryControl({ config });
  return {
    memory,
    skills: new SkillsControl({
      skills,
      reload: () => config.reloadSkills(messageBus),
    }),
    workspace: new WorkspaceControl({ config, access }),
    lsp: new LspControl({ lsp }),
    dispose: () => memory.dispose(),
  };
}
