/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkspaceContext } from '@vybestack/llxprt-code-core/utils/workspaceContext.js';

import type { Agent } from '../../agent.js';
import type { WorkspacePathOperations } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';

export function agentWorkspacePaths(
  agent: Pick<Agent, 'workspace'>,
): WorkspacePathOperations {
  const context = new WorkspaceContext(agent.workspace.getProjectRoot(), [
    ...agent.workspace.getDirectories(),
  ]);
  return {
    resolve: (filePath) => context.resolvePath(filePath),
    directories: () => agent.workspace.getDirectories(),
    contains: (filePath) => agent.workspace.containsPath(filePath),
    validate: (filePath, label = 'Path') =>
      agent.workspace.containsPath(filePath)
        ? null
        : `${label} is outside the workspace: ${filePath}`,
  };
}
