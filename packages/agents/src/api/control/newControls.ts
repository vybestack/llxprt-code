/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AgentMcpOperations } from '../mcpRuntimeAssembly.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type {
  AgentSkillsControl,
  AgentWorkspaceControl,
  AgentLspControl,
} from '../agent.js';
import type { WorkspaceSkillOperations } from '@vybestack/llxprt-code-core/skills/workspace-skill-owner.js';
import { SkillsControl } from './skillsControl.js';
import { WorkspaceControl } from './workspaceControl.js';
import { LspControl } from './lspControl.js';

export interface NewControls {
  readonly skills: AgentSkillsControl;
  readonly workspace: AgentWorkspaceControl;
  readonly lsp: AgentLspControl;
  closeAdmission(): void;
  dispose(): Promise<void>;
}

export function buildNewControls(
  config: Config,
  skills: WorkspaceSkillOperations,
  operations: AgentMcpOperations,
): NewControls {
  const workspace = new WorkspaceControl({
    checkpoints: operations.checkpointOperations,
    profileDefinitions: operations.profileDefinitions,
    profileWrites: operations.profileWrites,
    subagentDefinitions: operations.subagentDefinitions,
    subagentWrites: operations.subagentWrites,
    directories: operations.workspacePaths.directories,
    ignore: operations.workspaceIgnore,
    search: operations.workspaceSearch,
    containsPath: operations.workspacePaths.contains,
    addDirectory: operations.addWorkspaceDirectory,
    workingDirectory: config.getTargetDir(),
    projectRoot: config.getProjectRoot(),
  });
  const skillControl = new SkillsControl({
    list: (all) => skills.list(all),
    find: (name) => skills.find(name),
    reload: () => skills.reload(),
    isAdminEnabled: () => skills.isAdminEnabled(),
  });
  return {
    skills: skillControl,
    workspace,
    lsp: new LspControl({ inspection: operations.lspInspection }),
    closeAdmission: () => {
      skillControl.closeAdmission();
      workspace.closeAdmission();
    },
    dispose: async () => {
      const results = await Promise.allSettled([
        skillControl.dispose(),
        workspace.dispose(),
      ]);
      const failures = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      );
      if (failures.length > 0)
        throw new AggregateError(failures, 'Workspace facade cleanup failed');
    },
  };
}
