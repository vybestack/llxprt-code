/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  WorkspaceDefinitionOwner,
  parseSettingsSubagentDefinitions,
  type SubagentDefinitionReads,
  type LlxprtExtension,
} from '@vybestack/llxprt-code-core';
import { join } from 'node:path';
import type { McpConstructionResources } from './mcp-construction-resources.js';
import type { WorkspaceMemoryOwner } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';

export function composeWorkspaceDefinitions(
  resources: McpConstructionResources,
  directories: {
    readonly globalConfigRoot: string;
    readonly profileDirectory?: string;
    readonly subagentDirectory?: string;
  },
  supplied: WorkspaceDefinitionOwner | undefined,
  ownership: 'runtime' | 'caller',
): WorkspaceDefinitionOwner {
  const owner =
    supplied ??
    new WorkspaceDefinitionOwner(
      directories.profileDirectory ??
        join(directories.globalConfigRoot, 'profiles'),
      directories.subagentDirectory ??
        join(directories.globalConfigRoot, 'subagents'),
    );
  if (ownership === 'runtime') resources.retain(() => owner.dispose());
  return owner;
}

export function projectTrustedSubagents(
  owner: WorkspaceDefinitionOwner,
  trusted: () => boolean,
): SubagentDefinitionReads {
  return {
    ...owner.subagentReads,
    loadSubagent: (name) => owner.subagentReads.loadSubagent(name, trusted()),
    listSubagents: () => owner.subagentReads.listSubagents(trusted()),
    subagentExists: (name) =>
      owner.subagentReads.subagentExists(name, trusted()),
  };
}

export function updateWorkspaceExtensionDefinitions(
  owner: WorkspaceDefinitionOwner,
  operation: () => Promise<void>,
  extensions: () => LlxprtExtension[],
  memory: Pick<WorkspaceMemoryOwner, 'withReload'>,
): Promise<void> {
  let start!: () => void;
  const admitted = new Promise<void>((resolve) => {
    start = resolve;
  });
  const updated = owner.withExtensionUpdate(
    () => {
      start();
      return reload;
    },
    () =>
      extensions()
        .filter((extension) => extension.isActive)
        .map((extension) => ({
          name: extension.name,
          subagents: extension.subagents ?? [],
        })),
  );
  const reload = memory.withReload(() => admitted.then(operation));
  return updated;
}

export async function refreshWorkspaceDefinitionMemory(
  owner: WorkspaceDefinitionOwner,
  extensions: LlxprtExtension[],
  refresh: () => Promise<unknown>,
): Promise<void> {
  owner.replaceExtensionSubagents(
    extensions
      .filter((extension) => extension.isActive)
      .map((extension) => ({
        name: extension.name,
        subagents: extension.subagents ?? [],
      })),
  );
  await refresh();
}

export function composeDefinitionContributions(
  resources: McpConstructionResources,
  owner: WorkspaceDefinitionOwner,
  owned: boolean,
): WorkspaceDefinitionOwner {
  if (owned) return owner;
  const contributions = owner.forkContributions();
  resources.retain(() => contributions.dispose());
  return contributions;
}

export async function initializeWorkspaceDefinitions(
  owner: WorkspaceDefinitionOwner,
  settings: Record<string, unknown>,
  refresh: () => Promise<void>,
): Promise<void> {
  owner.replaceSettingsSubagents(
    parseSettingsSubagentDefinitions(settings) ?? {},
  );
  await owner.initialize();
  await refresh();
}

export function assertDefinitionBootstrapConfig(started: boolean): void {
  if (started)
    throw new Error(
      'An initialized Config requires its original MCP runtime handoff',
    );
}

export function composeDefinitionRoots(
  resources: McpConstructionResources,
  directories: Parameters<typeof composeWorkspaceDefinitions>[1],
  supplied: WorkspaceDefinitionOwner | undefined,
  ownership: 'runtime' | 'caller',
): [WorkspaceDefinitionOwner, WorkspaceDefinitionOwner] {
  const definitions = composeWorkspaceDefinitions(
    resources,
    directories,
    supplied,
    ownership,
  );
  const contributions = composeDefinitionContributions(
    resources,
    definitions,
    ownership === 'runtime',
  );
  return [definitions, contributions];
}
