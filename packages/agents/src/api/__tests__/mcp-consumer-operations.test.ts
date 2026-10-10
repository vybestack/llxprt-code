/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createTestOAuthBinding } from '@vybestack/llxprt-code-mcp/test-support/oauth.js';

import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveRepositoryFixture } from './helpers/fixtureRoot.js';
import { Config, SimpleExtensionLoader } from '@vybestack/llxprt-code-core';

import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';

describe('retained MCP consumer operations', () => {
  it('updates extension tools and JIT memory through the retained MCP owner', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'llxprt-mcp-consumers-'));
    const loader = new SimpleExtensionLoader([]);
    const config = new Config({
      sessionId: 'explicit-mcp-consumers',
      targetDir: directory,
      cwd: directory,
      model: 'test',
      debugMode: false,
      trustedFolder: true,
      coreTools: [],
      jitContextEnabled: true,
      enableExtensionReloading: true,
      telemetry: { enabled: false },
    });
    const owner = await McpRuntimeOwner.create(
      createTestOAuthBinding(),
      config,
      undefined,
      undefined,
      undefined,
      loader,
    );
    const extension = {
      name: 'arithmetic-extension',
      version: '1',
      isActive: true,
      path: directory,
      contextFiles: [],
      mcpServers: {
        arithmetic: {
          command: process.execPath,
          args: [
            resolveRepositoryFixture(
              import.meta.url,
              'scripts/tests/mcp-standalone-stdio-fixture.ts',
            ),
            directory,
          ],
        },
      },
    };
    try {
      await owner.initialize();

      await loader.loadExtension(extension);
      await owner.awaitDiscovery();
      await owner.workspaceMemory.operations.refresh();
      expect(
        owner.toolSelection
          .getAllTools()
          .filter(
            (tool) => 'serverName' in tool && tool.serverName === 'arithmetic',
          ),
      ).toHaveLength(1);
      expect(
        owner.workspaceMemory.operations.snapshot().environmentMemory +
          owner.readInstructions(),
      ).toContain('Use arithmetic locally.');
      const prompt = owner.listPrompts('arithmetic')[0];
      expect(
        (await prompt.invoke({ value: 'eleven' })).messages[0]?.content,
      ).toMatchObject({ text: 'Explain eleven' });
      await loader.unloadExtension(extension);
      expect(
        owner.toolSelection
          .getAllTools()
          .filter(
            (tool) => 'serverName' in tool && tool.serverName === 'arithmetic',
          ),
      ).toHaveLength(0);
      expect(
        owner.workspaceMemory.operations.snapshot().environmentMemory +
          owner.readInstructions(),
      ).not.toContain('Use arithmetic locally.');
    } finally {
      await owner.dispose();
      await config.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30000);
});
