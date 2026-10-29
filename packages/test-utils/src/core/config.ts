/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach } from 'bun:test';
import { WorkspaceMcpCatalogOwner } from '@vybestack/llxprt-code-core';
import { SimpleExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import type { LlxprtExtension } from '@vybestack/llxprt-code-core/config/config.js';
export {
  installTestWorkspaceFilesystem,
  installTestWorkspacePaths,
} from './workspace-filesystem.js';
export { createTestOAuthBinding } from './fixture-mcp-auth.js';
export { makeFakeConfig } from './fixture-fake-config.js';

export { createTestAgentClient } from './fixture-agent-client.js';

export function createTestExtensionLoader(
  extensions: LlxprtExtension[],
): SimpleExtensionLoader {
  return new SimpleExtensionLoader(extensions);
}

export function installTestCatalogOwners(): () => WorkspaceMcpCatalogOwner {
  let roots: readonly WorkspaceMcpCatalogOwner[] = [];
  afterEach(async () => {
    const retained = roots;
    roots = [];
    const failures: unknown[] = [];
    for (const root of [...retained].reverse()) {
      try {
        await root.dispose();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, 'Test catalog cleanup failed');
  });
  return (): WorkspaceMcpCatalogOwner => {
    const root = new WorkspaceMcpCatalogOwner(
      () => true,
      async () => {
        throw new Error('Manager fixture has no resource transport');
      },
    );
    roots = [...roots, root];
    return root;
  };
}
