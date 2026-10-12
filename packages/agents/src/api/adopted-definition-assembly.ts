/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  Config,
  WorkspaceDefinitionOwner,
} from '@vybestack/llxprt-code-core';
import type {
  AgentMcpOperations,
  McpRuntimeOwner,
} from './mcpRuntimeAssembly.js';

export function assembleAdoptedDefinitionOperations(
  workspace: McpRuntimeOwner,
  definitions: WorkspaceDefinitionOwner | undefined,
  _config: Config,
  ownership: 'agent' | 'caller' = 'caller',
  ownsWorkspace = false,
): AgentMcpOperations {
  const selected = definitions ?? workspace.workspaceDefinitions;
  let closed = false;
  const subscriptions = new Set<() => void>();
  const assertOpen = (): void => {
    if (closed) throw new Error('MCP facade is closed');
  };
  return {
    trust: workspace.trust,
    ide: workspace.ide,
    profileDefinitions: selected.profileReads,
    profileWrites: selected.profileWrites,
    subagentDefinitions: {
      ...selected.subagentReads,
      loadSubagent: (name) =>
        selected.subagentReads.loadSubagent(
          name,
          workspace.trust.isTrustedFolder(),
        ),
      listSubagents: () =>
        selected.subagentReads.listSubagents(workspace.trust.isTrustedFolder()),
      subagentExists: (name) =>
        selected.subagentReads.subagentExists(
          name,
          workspace.trust.isTrustedFolder(),
        ),
    },
    subagentWrites: selected.subagentWrites,
    closeAdmission: () => {
      closed = true;
      const failures: unknown[] = [];
      for (const release of subscriptions) {
        try {
          release();
        } catch (error) {
          failures.push(error);
        }
      }
      subscriptions.clear();
      if (ownership === 'agent' && definitions !== undefined)
        definitions.closeAdmission();
      if (ownsWorkspace) workspace.closeAdmission();
      if (failures.length > 0)
        throw new AggregateError(
          failures,
          'MCP facade subscription cleanup failed',
        );
    },
    checkpointOperations: workspace.checkpointOperations,
    workspacePaths: workspace.workspacePaths,
    workspaceFiles: workspace.workspaceFiles,
    workspaceIgnore: workspace.workspaceIgnore,
    workspaceScans: workspace.workspaceScans,
    workspaceSearch: workspace.workspaceSearch,
    addWorkspaceDirectory: workspace.addWorkspaceDirectory,
    lspInspection: workspace.lspInspection,
    policyInspection: workspace.policyInspection,
    ...adoptedMcpCalls(workspace, assertOpen, subscriptions),
  };
}

export function adoptedDefinitionCleanup(
  workspace: McpRuntimeOwner,
  definitions: WorkspaceDefinitionOwner | undefined,
  ownership: 'agent' | 'caller' | undefined,
  ownsWorkspace: boolean,
): (() => Promise<void>) | undefined {
  const owned =
    ownership === 'agent' &&
    definitions !== undefined &&
    (!ownsWorkspace || definitions !== workspace.workspaceDefinitions);
  if (!owned && !ownsWorkspace) return undefined;
  return async () => {
    const results = await Promise.allSettled([
      owned ? definitions.dispose() : undefined,
      ownsWorkspace ? workspace.dispose() : undefined,
    ]);
    const errors = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1)
      throw new AggregateError(
        errors,
        'Adopted workspace definition cleanup failed',
      );
  };
}

function adoptedMcpCalls(
  workspace: McpRuntimeOwner,
  assertOpen: () => void,
  subscriptions: Set<() => void>,
): Pick<
  AgentMcpOperations,
  | 'performOAuth'
  | 'readOAuthCredentials'
  | 'readServerSettings'
  | 'listPrompts'
  | 'listResources'
  | 'findResource'
  | 'readResource'
  | 'status'
  | 'subscribeStatus'
  | 'refresh'
  | 'reload'
  | 'awaitDiscovery'
> {
  return {
    performOAuth: (...args) => {
      assertOpen();
      return workspace.performOAuth(...args);
    },
    readOAuthCredentials: (...args) => {
      assertOpen();
      return workspace.readOAuthCredentials(...args);
    },
    readServerSettings: () => {
      assertOpen();
      return workspace.readServerSettings();
    },
    listPrompts: (server) => {
      assertOpen();
      return workspace.listPrompts(server);
    },
    listResources: () => {
      assertOpen();
      return workspace.listResources();
    },
    findResource: (identifier) => {
      assertOpen();
      return workspace.findResource(identifier);
    },
    readResource: (server, uri) => {
      assertOpen();
      return workspace.readResource(server, uri);
    },
    status: () => {
      assertOpen();
      return workspace.status();
    },
    subscribeStatus: (listener) => {
      assertOpen();
      const release = workspace.subscribeStatus(listener);
      const unsubscribe = (): void => {
        subscriptions.delete(unsubscribe);
        release();
      };
      subscriptions.add(unsubscribe);
      return unsubscribe;
    },
    refresh: (server) => {
      assertOpen();
      return workspace.refresh(server);
    },
    reload: () => {
      assertOpen();
      return workspace.reload();
    },
    awaitDiscovery: () => {
      assertOpen();
      return workspace.awaitDiscovery();
    },
  };
}
