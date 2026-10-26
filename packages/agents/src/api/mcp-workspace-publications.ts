import { assembleMcpFilesystem } from './mcp-filesystem-assembly.js';
import {
  handoffOwner,
  retainPolicyOwner,
  type McpOwnerHandoff,
  type McpPolicyHandoff,
} from './mcp-runtime-construction.js';
import type { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FileSystemService } from '@vybestack/llxprt-code-core/services/fileSystemService.js';

import {
  assembleWorkspaceMemory,
  WorkspaceToolCatalogOwner,
  WorkspaceMcpCatalogOwner,
  type Config,
  type LlxprtExtension,
  type WorkspaceTrustControlPort,
} from '@vybestack/llxprt-code-core';
import type { WorkspaceMemoryOwner } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';
import type { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { WorkspaceExtensionOwner } from '@vybestack/llxprt-code-core/utils/workspace-extension-owner.js';
import type {
  ExtensionLoader,
  ExtensionRuntimeConfiguration,
} from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import {
  captureMcpSettings,
  type WorkspaceMcpSettings,
  type SessionMcpSettingsReads,
} from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { McpConstructionResources } from './mcp-construction-resources.js';
import { updateWorkspaceExtensionDefinitions } from './workspace-definition-assembly.js';
import type { WorkspaceDefinitionOwner } from '@vybestack/llxprt-code-core';
import type { McpClientManager } from '@vybestack/llxprt-code-mcp';
import {
  readMcpRuntimeStatus,
  type McpRuntimeStatusView,
} from './control/mcpControl.js';

export function readWorkspaceMcpStatus(
  manager: McpClientManager | undefined,
  settings: WorkspaceMcpSettings,
  extensions: LlxprtExtension[],
): McpRuntimeStatusView | undefined {
  if (manager === undefined) return undefined;
  return {
    ...readMcpRuntimeStatus(manager),
    servers: projectWorkspaceMcpSettings(settings, extensions).mcpServers,
  };
}

export function retainWorkspaceTools(
  resources: McpConstructionResources,
  config: Config,
  bus: MessageBus,
  trust: WorkspaceTrustControlPort,
): WorkspaceToolCatalogOwner {
  const owner = new WorkspaceToolCatalogOwner(config, bus, trust);
  resources.retain(() => owner.dispose());
  return owner;
}

export function retainWorkspaceMemory(
  resources: McpConstructionResources,
  config: Config,
  filesystem: WorkspaceFilesystemOwner,
  trust: WorkspaceTrustControlPort,
  handoff: McpOwnerHandoff<WorkspaceMemoryOwner>,
  readExtensions: () => LlxprtExtension[],
): WorkspaceMemoryOwner {
  const supplied = handoffOwner(handoff);
  const memory =
    supplied ??
    assembleWorkspaceMemory(config, filesystem, trust, readExtensions);
  if (handoff.kind === 'none') resources.retain(() => memory.dispose());
  return memory;
}

export function retainMcpCatalogs(
  resources: McpConstructionResources,
  trust: WorkspaceTrustControlPort,
  readResource: ConstructorParameters<typeof WorkspaceMcpCatalogOwner>[1],
): WorkspaceMcpCatalogOwner {
  const owner = new WorkspaceMcpCatalogOwner(
    () => trust.isTrustedFolder(),
    readResource,
  );
  resources.retain(() => owner.dispose());
  return owner;
}

export function composeWorkspaceExtensions(
  config: ExtensionRuntimeConfiguration & Pick<Config, 'getExtensions'>,
  loader: ExtensionLoader | undefined,
  refreshMemory: () => Promise<void>,
  definitions: WorkspaceDefinitionOwner,
  memory: WorkspaceMemoryOwner,
  reloadHooks: () => Promise<void>,
): WorkspaceExtensionOwner {
  return new WorkspaceExtensionOwner(
    config,
    loader,
    refreshMemory,
    (operation) =>
      updateWorkspaceExtensionDefinitions(
        definitions,
        operation,
        () => config.getExtensions(),
        memory,
      ),
    reloadHooks,
  );
}

export function projectWorkspaceMcpSettings(
  settings: WorkspaceMcpSettings,
  extensions: readonly LlxprtExtension[],
): WorkspaceMcpSettings {
  const contributed = Object.fromEntries(
    extensions
      .filter((extension) => extension.isActive)
      .flatMap((extension) =>
        Object.entries(extension.mcpServers ?? {}).map(([name, server]) => [
          name,
          { ...server, extension },
        ]),
      ),
  );
  return captureMcpSettings({
    ...settings,
    mcpServers: { ...contributed, ...settings.mcpServers },
  });
}

export function captureInitialMcpSettings(
  config: Pick<Config, 'getMcpServers' | 'getBlockedMcpServers'>,
): WorkspaceMcpSettings {
  return {
    mcpServers: config.getMcpServers() ?? {},
    blockedMcpServers: config.getBlockedMcpServers() ?? [],
    settingsMcpServers: config.getMcpServers() ?? {},
  };
}

export async function reloadWorkspaceMcpServers(
  binding: SessionMcpSettingsReads,
  previous: WorkspaceMcpSettings,
  publish: (settings: WorkspaceMcpSettings) => void,
  reconcile: () => Promise<void>,
  assertActive: () => void,
): Promise<void> {
  const next = await binding.reload();
  assertActive();
  try {
    publish(captureMcpSettings(next));
    await reconcile();
    assertActive();
  } catch (error) {
    try {
      publish(previous);
      await reconcile();
    } catch (rollback) {
      throw new AggregateError(
        [error, rollback],
        'MCP settings rollback failed',
      );
    }
    throw error;
  }
}

export function captureWorkspaceServerDeclarations(
  config: Config,
  loader: ExtensionLoader | undefined,
  binding: SessionMcpSettingsReads | undefined,
): [WorkspaceMcpSettings, LlxprtExtension[], string[] | undefined] {
  return [
    captureMcpSettings(binding?.read() ?? captureInitialMcpSettings(config)),
    (loader?.getExtensions() ?? config.getExtensions()).slice(),
    config.getAllowedMcpServers()?.slice(),
  ];
}

export function retainWorkspaceEnvironment(
  resources: McpConstructionResources,
  config: Config,
  trust: WorkspaceTrustControlPort,
  filesystem: McpOwnerHandoff<WorkspaceFilesystemOwner>,
  memory: McpOwnerHandoff<WorkspaceMemoryOwner>,
  readExtensions: () => LlxprtExtension[],
  policy: McpPolicyHandoff,
  filesystemService: McpOwnerHandoff<FileSystemService>,
): [
  WorkspaceFilesystemOwner,
  WorkspaceMemoryOwner,
  RuntimePolicyOwner,
  boolean,
  () => void,
] {
  const retained = assembleMcpFilesystem(
    config,
    filesystem,
    resources,
    trust,
    handoffOwner(filesystemService),
  );
  const retainedMemory = retainWorkspaceMemory(
    resources,
    config,
    retained.filesystem,
    trust,
    memory,
    readExtensions,
  );
  const retainedPolicy = retainPolicyOwner(resources, config, policy, trust);
  return [
    retained.filesystem,
    retainedMemory,
    retainedPolicy.owner,
    retainedPolicy.owned,
    retained.unsubscribe,
  ];
}
