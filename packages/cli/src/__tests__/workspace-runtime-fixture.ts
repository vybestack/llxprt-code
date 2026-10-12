import { Storage } from '@vybestack/llxprt-code-settings';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import * as path from 'node:path';
import { installDefinitionRuntimeFixture } from './definition-runtime-fixture.js';
const definitionFixture = installDefinitionRuntimeFixture();

import { createUiSessionOwner } from './uiSessionOwner.js';
import { SessionInstructionOwner } from '../../../agents/src/session/session-instruction-owner.js';

import {
  WorkspaceMcpCatalogOwner,
  WorkspaceMemoryOwner,
  WorkspaceCheckpointOwner,
  type WorkspacePromptSelection,
  type WorkspaceResourceSelection,
} from '@vybestack/llxprt-code-core';
import { afterEach } from 'bun:test';
import { useMemo } from 'react';
import type { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';

import type { Agent, FromConfigOptions } from '@vybestack/llxprt-code-agents';
import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
import {
  buildSlashCommandRuntime,
  type CliUiRuntime,
  type UiRuntimeDeclarationSource,
} from '../ui/cliUiRuntime.js';

type DefinitionFixturePorts = Pick<
  Agent['workspace'],
  | 'profileDefinitions'
  | 'profileWrites'
  | 'subagentDefinitions'
  | 'subagentWrites'
>;

type FixtureRuntime = ((
  source: UiRuntimeDeclarationSource &
    Partial<
      WorkspacePromptSelection &
        Pick<WorkspaceResourceSelection, 'listResources'>
    >,
  sessionOwner?: ReturnType<typeof createUiSessionOwner> | Agent,
  settingsOwner?: NonNullable<FromConfigOptions['settingsOwner']>,
) => CliUiRuntime) & {
  dispose(): Promise<void>;
};

function createFixtureMemory(
  root: WorkspaceFilesystemOwner,
): WorkspaceMemoryOwner {
  return new WorkspaceMemoryOwner({
    globalMemoryDir: Storage.getGlobalMemoryDir(),
    workingDirectory: root.paths.directories()[0],
    jitEnabled: false,
    debugMode: false,
    loadIncludes: true,
    filtering: { respectGitIgnore: false, respectLlxprtIgnore: true },
    maxDirectories: 200,
    importFormat: 'tree',
    paths: root.paths,
    ignore: root.ignore,
    scans: root.scans,
    isTrusted: () => true,
    extensions: () => [],
  });
}

function createFixtureCheckpoints(
  filesystem: WorkspaceFilesystemOwner,
): WorkspaceCheckpointOwner {
  const project = filesystem.paths.directories()[0];
  return new WorkspaceCheckpointOwner(
    project,
    path.join(project, '.llxprt', 'fixture-history'),
    false,
  );
}

function workspaceProjection(
  retainedRoot: WorkspaceFilesystemOwner,
  source: Pick<UiRuntimeDeclarationSource, 'getWorkingDir' | 'getProjectRoot'>,
  checkpoints: WorkspaceCheckpointOwner,
  definitions: DefinitionFixturePorts,
): Agent['workspace'] {
  return {
    ...definitions,
    checkpoints: checkpoints.operations,
    ...retainedRoot.ignore,
    ...retainedRoot.search,
    getDirectories: () => [...retainedRoot.paths.directories()],
    addDirectory: (directory) => retainedRoot.addDirectory(directory),
    containsPath: (filePath) => retainedRoot.paths.contains(filePath),
    getWorkingDirectory: () => source.getWorkingDir(),
    getProjectRoot: () => source.getProjectRoot(),
  };
}

async function closeInstructionFixture(
  instructions: SessionInstructionOwner | undefined,
  memory: WorkspaceMemoryOwner | undefined,
  catalogs: WorkspaceMcpCatalogOwner | undefined,
  checkpoints: WorkspaceCheckpointOwner | undefined,
): Promise<void> {
  const results = [];
  for (const owner of [instructions, memory, catalogs, checkpoints]) {
    results.push(...(await Promise.allSettled([owner?.dispose()])));
  }
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length > 0)
    throw new AggregateError(failures, 'Fixture instructions cleanup failed');
}

function buildSuppliedSessionRuntime(
  source: Parameters<FixtureRuntime>[0],
  owner: ReturnType<typeof createUiSessionOwner> | Agent,
  settingsOwner: NonNullable<FromConfigOptions['settingsOwner']> | undefined,
): CliUiRuntime {
  return buildSlashCommandRuntime(
    source,
    owner,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    settingsOwner ??
      ('settingsOwner' in owner ? owner.settingsOwner : undefined),
  );
}

export function installWorkspaceRuntimeFixture(
  targetDir?: () => string,
  settleDisposal?: (disposal: Promise<void>) => Promise<void>,
  includeDirectories?: () => readonly string[],
  definitions?: () => DefinitionFixturePorts,
): FixtureRuntime {
  const createRoot = installTestWorkspaceFilesystem(settleDisposal);
  let root: WorkspaceFilesystemOwner | undefined;
  let instructions: SessionInstructionOwner | undefined;
  let memory: WorkspaceMemoryOwner | undefined;
  let catalogs: WorkspaceMcpCatalogOwner | undefined;
  let checkpoints: WorkspaceCheckpointOwner | undefined;
  afterEach(async () => {
    await closeInstructionFixture(instructions, memory, catalogs, checkpoints);
    checkpoints = undefined;
    instructions = undefined;
    memory = undefined;
    catalogs = undefined;
    root = undefined;
  });
  const compose = (
    source: UiRuntimeDeclarationSource &
      Partial<
        WorkspacePromptSelection &
          Pick<WorkspaceResourceSelection, 'listResources'>
      >,
    suppliedSessionOwner?: ReturnType<typeof createUiSessionOwner> | Agent,
    settingsOwner?: NonNullable<FromConfigOptions['settingsOwner']>,
  ): CliUiRuntime => {
    if (suppliedSessionOwner)
      return buildSuppliedSessionRuntime(
        source,
        suppliedSessionOwner,
        settingsOwner,
      );
    root ??= createRoot({
      targetDir: targetDir ? targetDir() : process.cwd(),
      isTrusted: () => true,
      includeDirectories: includeDirectories?.(),
    });
    memory ??= createFixtureMemory(root);
    instructions ??= new SessionInstructionOwner(
      memory.operations,
      '',
      false,
      async () => {},
    );
    catalogs ??= new WorkspaceMcpCatalogOwner(
      () => true,
      async () => {
        throw new Error('Fixture resource transport is unavailable');
      },
    );
    const mcp = catalogs;
    publishFixtureCatalogs(source, mcp);
    checkpoints ??= createFixtureCheckpoints(root);
    const workspace = workspaceProjection(
      root,
      source,
      checkpoints,
      definitions?.() ?? definitionFixture(),
    );
    return buildFixtureSessionRuntime(source, workspace, instructions, mcp);
  };
  return Object.assign(compose, {
    dispose: async (): Promise<void> => {
      if (!root) return;
      await closeInstructionFixture(
        instructions,
        memory,
        catalogs,
        checkpoints,
      );
      const disposal = root.dispose();
      if (settleDisposal) await settleDisposal(disposal);
      else await disposal;
    },
  });
}

export function installWorkspaceRuntimeHook(
  targetDir?: () => string,
  settleDisposal?: (disposal: Promise<void>) => Promise<void>,
  includeDirectories?: () => readonly string[],
  definitions?: () => DefinitionFixturePorts,
): ReturnType<typeof installWorkspaceRuntimeFixture> {
  const compose = installWorkspaceRuntimeFixture(
    targetDir,
    settleDisposal,
    includeDirectories,
    definitions,
  );
  const useFixtureRuntime = (
    source: UiRuntimeDeclarationSource,
  ): CliUiRuntime => useMemo(() => compose(source), [source]);
  return Object.assign(useFixtureRuntime, { dispose: compose.dispose });
}

function publishFixtureCatalogs(
  source: UiRuntimeDeclarationSource &
    Partial<
      WorkspacePromptSelection &
        Pick<WorkspaceResourceSelection, 'listResources'>
    >,
  mcp: WorkspaceMcpCatalogOwner,
): void {
  if (source.listPrompts)
    for (const server of Object.keys(source.getMcpServers() ?? {}))
      for (const prompt of source.listPrompts(server))
        mcp.promptPublication.registerPrompt(prompt);
  const resources = source.listResources?.() ?? [];
  for (const server of new Set(
    resources.map((resource) => resource.serverName),
  ))
    mcp.resourcePublication.setResourcesForServer(
      server,
      resources.filter((resource) => resource.serverName === server),
    );
}

function readFixtureBlockedServers(source: {
  getBlockedMcpServers?: UiRuntimeDeclarationSource['getBlockedMcpServers'];
}): NonNullable<
  ReturnType<UiRuntimeDeclarationSource['getBlockedMcpServers']>
> {
  return source.getBlockedMcpServers?.() ?? [];
}

function buildFixtureSessionRuntime(
  source: UiRuntimeDeclarationSource,
  workspace: Agent['workspace'],
  instructions: SessionInstructionOwner,
  catalogs: WorkspaceMcpCatalogOwner,
): CliUiRuntime {
  const servers = source.getMcpServers() ?? {};
  const owner = createUiSessionOwner(undefined, undefined, {
    mcpServers: servers,
    settingsMcpServers: servers,
    blockedMcpServers: readFixtureBlockedServers(source),
  });
  return buildSlashCommandRuntime(
    source,
    {
      ...owner,
      workspace,
      memory: instructions.memory,
      mcp: {
        ...owner.mcp,
        ...catalogs.promptSelection,
        ...catalogs.resourceSelection,
      },
    },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    owner.settingsOwner,
  );
}
