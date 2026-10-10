/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { WorkspaceTrustReadPort } from '@vybestack/llxprt-code-core';

import { WorkspaceExtensionOwner } from '@vybestack/llxprt-code-core/utils/workspace-extension-owner.js';
import type { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import { composeWorkspaceSkills } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import type { WorkspaceSkillOwner } from '@vybestack/llxprt-code-core/skills/workspace-skill-owner.js';
import type { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type {
  WorkspaceMemoryOwner,
  WorkspaceToolCatalogOwner,
} from '@vybestack/llxprt-code-core';
import type { ExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
export function assembleFixtureWorkspace(
  config: Parameters<typeof composeWorkspaceSkills>[0] &
    ConstructorParameters<typeof WorkspaceExtensionOwner>[0],
  filesystem: WorkspaceFilesystemOwner,
  sessionClient: { publishTools(): Promise<void> } | undefined,
  extensionLoader: ExtensionLoader | undefined,
  toolCatalog: WorkspaceToolCatalogOwner,
  memory: WorkspaceMemoryOwner,
  trust: WorkspaceTrustReadPort,
  readMessageBus: Parameters<typeof composeWorkspaceSkills>[4],
  skillOperations: WorkspaceSkillAssemblyOperations,
): {
  workspaceSkills: WorkspaceSkillOwner;
  extensions: WorkspaceExtensionOwner;
} {
  const workspaceSkills = composeWorkspaceSkills(
    config,
    (directory, approved) =>
      filesystem.admitSkillDirectory(directory, approved),
    () => filesystem.notifyTrustChanged(),
    trust,
    readMessageBus,
    skillOperations,
    () => {
      const lease = toolCatalog.acceptSkillPublication();
      return {
        registry: lease.registry,
        publish: async () => {
          await sessionClient?.publishTools();
        },
        release: lease.release,
      };
    },
  );
  const extensions = new WorkspaceExtensionOwner(
    config,
    extensionLoader,
    () => memory.operations.refresh().then(() => undefined),
    (operation) => memory.withReload(operation),
  );
  return { workspaceSkills, extensions };
}
