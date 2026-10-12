import { WorkspaceTrustLifecycle } from '../services/workspace-trust-lifecycle.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { assembleWorkspaceMemory } from '../config/workspace-memory-assembly.js';
import { Config } from '../config/config.js';
import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { SimpleExtensionLoader } from './extensionLoader.js';

describe('explicit extension MCP operations', () => {
  const createFilesystem = installTestWorkspaceFilesystem();
  it('loads and unloads through explicit extension operations without a Config MCP manager', async () => {
    const config = new Config({
      sessionId: 'extension-operations',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      debugMode: false,
      model: 'test',
      enableExtensionReloading: true,
    });
    const trust = new WorkspaceTrustLifecycle();
    const filesystem = createFilesystem({
      targetDir: process.cwd(),
      isTrusted: () => trust.isTrustedFolder(),
    });
    const memory = assembleWorkspaceMemory(config, filesystem, trust);
    const loader = new SimpleExtensionLoader([]);
    const active = new Set<string>();
    await loader.start(
      config,
      async (extension) => {
        active.add(extension.name);
      },
      async (extension) => {
        active.delete(extension.name);
      },
      undefined,
      undefined,
      async () => {
        await memory.operations.refresh();
      },
    );
    const extension = {
      name: 'explicit',
      version: '1',
      path: process.cwd(),
      isActive: true,
      contextFiles: [],
    };
    await loader.loadExtension(extension);
    expect([...active]).toStrictEqual(
      loader.getExtensions().map((entry) => entry.name),
    );
    expect(active.size).toBe(1);
    await loader.unloadExtension(extension);
    expect(active.size).toBe(0);
    expect(loader.getExtensions()).toHaveLength(0);
    await memory.dispose();
    await trust.dispose();
    await config.dispose();
  });
});
