import type { WorkspaceDefinitionOwner } from '@vybestack/llxprt-code-core';
import { projectTrustedSubagents } from './workspace-definition-assembly.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { WorkspaceControl } from './control/workspaceControl.js';
import type { McpRuntimeOwner } from './mcpRuntimeAssembly.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';

export function assembleForegroundWorkspace(
  workspace: McpRuntimeOwner,
  config: Config,
  definitions?: WorkspaceDefinitionOwner,
): WorkspaceControl {
  return new WorkspaceControl(
    definitions?.profileReads ?? workspace.profileDefinitions,
    definitions?.profileWrites ?? workspace.profileWrites,
    definitions === undefined
      ? workspace.subagentDefinitions
      : projectTrustedSubagents(definitions, () =>
          workspace.trust.isTrustedFolder(),
        ),
    definitions?.subagentWrites ?? workspace.subagentWrites,
    workspace.checkpointOperations,
    workspace.workspaceIgnore,
    workspace.workspaceSearch,
    workspace.workspaceFiles,
    workspace.workspacePaths.contains,
    workspace.workspacePaths.directories,
    workspace.addWorkspaceDirectory,
    config.getTargetDir(),
    config.getProjectRoot(),
  );
}
