/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  WorkspaceMemoryOwner,
  WorkspaceMcpCatalogOwner,
} from '@vybestack/llxprt-code-core';
import type { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type { WorkspaceLspOwner } from '@vybestack/llxprt-code-core/lsp/workspace-lsp-owner.js';
import type { WorkspaceSkillOwner } from '@vybestack/llxprt-code-core/skills/workspace-skill-owner.js';
import type { WorkspaceExtensionOwner } from '@vybestack/llxprt-code-core/utils/workspace-extension-owner.js';
import type { McpClientManager } from '@vybestack/llxprt-code-mcp';
export async function closeFixtureWorkspace(
  extensions: WorkspaceExtensionOwner,
  manager: McpClientManager | undefined,
  skills: WorkspaceSkillOwner,
  trust: ReadonlySet<Promise<void>>,
  lsp: WorkspaceLspOwner,
  filesystem: WorkspaceFilesystemOwner,
  catalogs: WorkspaceMcpCatalogOwner,
  memory: WorkspaceMemoryOwner,
): Promise<void> {
  catalogs.closeAdmission();
  memory.closeAdmission();
  const failures: unknown[] = [];
  for (const close of [
    () => memory.dispose(),
    () => lsp.dispose(),
    () => extensions.dispose(),
    () => catalogs.dispose(),
    () => manager?.stop(),
    () => skills.dispose(),
    () => filesystem.dispose(),
  ]) {
    try {
      await close();
    } catch (error) {
      failures.push(error);
    }
  }
  for (const result of await Promise.allSettled([...trust]))
    if (result.status === 'rejected') failures.push(result.reason);
  if (failures.length > 0)
    throw new AggregateError(failures, 'Workspace runtime cleanup failed');
}
