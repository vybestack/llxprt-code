/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core';
import type { SessionClientOwner } from '../session/session-client-owner.js';
import type { StableEditorCallbacksHolder } from './agentBootstrap.js';
import type { AgentAuthState } from './control/authState.js';
import { assembleIdeControl, type IdeControl } from './control/ideControl.js';
import { LspControl } from './control/lspControl.js';
import type { McpControl } from './control/mcpControl.js';
import { buildOwnedMcpControl } from './control/mcpControlWiring.js';
import { WorkspaceControl } from './control/workspaceControl.js';
import type { McpRuntimeOwner } from './mcpRuntimeAssembly.js';

export interface WorkspaceFacadeControls {
  readonly workspace: WorkspaceControl;
  readonly ide: IdeControl;
  readonly lsp: LspControl;
  readonly mcp: McpControl;
}

/**
 * Builds the workspace, IDE, LSP and MCP controls the agent facade publishes,
 * for every construction path. Subagent definitions come from
 * `McpRuntimeOwner.subagentDefinitions`, which is the one place that filters
 * extension subagents by workspace trust.
 */
export function assembleWorkspaceFacade(
  runtime: McpRuntimeOwner,
  config: Config,
  session: SessionClientOwner,
  auth: AgentAuthState,
  editors: StableEditorCallbacksHolder,
): WorkspaceFacadeControls {
  return {
    workspace: new WorkspaceControl(
      runtime.profileDefinitions,
      runtime.profileWrites,
      runtime.subagentDefinitions,
      runtime.subagentWrites,
      runtime.checkpointOperations,
      runtime.workspaceIgnore,
      runtime.workspaceSearch,
      runtime.workspaceFiles,
      runtime.workspacePaths.contains,
      runtime.workspacePaths.directories,
      runtime.addWorkspaceDirectory,
      config.getTargetDir(),
      config.getProjectRoot(),
    ),
    ide: assembleIdeControl(
      runtime.trust,
      runtime.ide,
      () => editors.editorCallbacks,
    ),
    lsp: new LspControl(runtime.lspInspection),
    mcp: buildOwnedMcpControl(
      runtime.readServerSettings.bind(runtime),
      session.toolCatalog.selection,
      runtime.listPrompts.bind(runtime),
      runtime.listResources.bind(runtime),
      runtime.readOAuthCredentials.bind(runtime),
      runtime.performOAuth.bind(runtime),
      runtime.status.bind(runtime),
      runtime.refresh.bind(runtime),
      runtime.reload.bind(runtime),
      (server) => auth.mcpAuth.has(server),
      (server) => auth.mcpAuth.add(server),
      () => session.refreshToolDefinitions(),
      runtime.subscribeStatus.bind(runtime),
      runtime.findResource.bind(runtime),
      runtime.readResource.bind(runtime),
    ),
  };
}
