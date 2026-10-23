import type { McpRuntimeOwner } from '../../api/mcpRuntimeAssembly.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startCatalogFixture } from '../../api/__tests__/helpers/workspace-catalog-http-fixture.js';
import { ACTIVATE_MCP_SERVER_TOOL_NAME } from '@vybestack/llxprt-code-tools';
import {
  installSubagentCleanup,
  seedSubagentSettings,
  createSubagentConfig,
  acquireSubagentSettings,
  acquireSubagentWorkspace,
} from './subagent-test-helpers.js';

describe('createMockConfig MCP lifecycle', () => {
  const retainSubagentCleanup = installSubagentCleanup();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps complete lazy-MCP registry behavior while scheduled refreshes complete', async () => {
    let config: Config | undefined;
    let workspaceOwner: McpRuntimeOwner | undefined;
    const directory = await mkdtemp(join(tmpdir(), 'subagent-lazy-refresh-'));
    const server = await startCatalogFixture(directory);
    let releaseRefresh!: () => void;
    let markRefreshStarted!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const refreshStarted = new Promise<void>((resolve) => {
      markRefreshStarted = resolve;
    });
    const failures: unknown[] = [];
    try {
      const settings = seedSubagentSettings({ 'mcp.lazy': true });
      config = createSubagentConfig(settings, retainSubagentCleanup, {
        targetDir: directory,
        cwd: directory,
        trustedFolder: true,
        mcpServers: {
          'scheduled-server': { httpUrl: server.url, trust: true },
        },
      });
      await acquireSubagentSettings(config, settings, retainSubagentCleanup);
      const mcpRuntime = await acquireSubagentWorkspace(
        config,
        retainSubagentCleanup,
        {
          getTool: () => undefined,
        },
      );
      workspaceOwner = mcpRuntime;
      const toolRegistry = mcpRuntime.toolSelection;
      const retainedSelectionRead = toolRegistry.getAllTools;
      await mcpRuntime.awaitDiscovery();
      const scan = mcpRuntime.workspaceFilesystem.scans.run;
      vi.spyOn(mcpRuntime.workspaceFilesystem.scans, 'run').mockImplementation(
        (directories, operation) =>
          scan(directories, async () => {
            markRefreshStarted();
            await refreshGate;
            return operation();
          }),
      );
      const refreshing = mcpRuntime.workspaceMemory.operations.refresh();
      await refreshStarted;
      const serverRefresh = mcpRuntime.refresh('scheduled-server');
      releaseRefresh();
      await Promise.all([refreshing, serverRefresh]);
      await mcpRuntime.refreshContext();
      expect(
        toolRegistry
          .getAllTools()
          .filter((tool) => 'serverName' in tool)
          .map((tool) => Reflect.get(tool, 'serverName')),
      ).toContain('scheduled-server');
      expect(mcpRuntime.toolSelection.getAllTools).toBe(retainedSelectionRead);
      expect(
        retainedSelectionRead().filter((tool) => 'serverName' in tool).length,
      ).toBeGreaterThan(0);
      expect(
        toolRegistry
          .getAllTools()
          .some((tool) => tool.name === ACTIVATE_MCP_SERVER_TOOL_NAME),
      ).toBe(true);
    } catch (primary) {
      failures.push(primary);
    } finally {
      releaseRefresh();
      server.release();
      for (const close of [
        () => workspaceOwner?.dispose(),
        () => config?.dispose(),
      ]) {
        try {
          await close();
        } catch (error) {
          failures.push(error);
        }
      }
      try {
        await server.stop();
      } catch (error) {
        failures.push(error);
      }
      try {
        await rm(directory, { recursive: true, force: true });
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        'Scheduled refresh fixture cleanup failed',
      );
  }, 30000);
});
