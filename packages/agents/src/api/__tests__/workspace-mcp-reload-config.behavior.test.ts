/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { McpClientManager } from '@vybestack/llxprt-code-mcp';
import { createTestOAuthBinding } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { createTestMcpRuntime } from './helpers/create-mcp-runtime.js';
describe('Config composition lifetimes', () => {
  const approvalRoots: Array<() => Promise<void>> = [];
  afterEach(async () => {
    const failures: unknown[] = [];
    for (const close of approvalRoots.splice(0).reverse()) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        'Config composition fixture cleanup failed',
      );
  });
  describe('Config MCP runtime capabilities (agents boundary)', () => {
    const baseParams = {
      sessionId: 'test',
      targetDir: '.',
      debugMode: false,
      model: 'test-model',
      cwd: '.',
    };
    beforeEach(() => {
      vi.spyOn(
        McpClientManager.prototype,
        'startConfiguredMcpServers',
      ).mockResolvedValue(undefined);
      vi.spyOn(
        McpClientManager.prototype,
        'reconcileConfiguredMcpServers',
      ).mockResolvedValue(undefined);
    });
    afterEach(() => vi.restoreAllMocks());
    describe('reloadMcpServers reconciliation ownership', () => {
      it('swaps MCP/blocked state then invokes the live manager reconcile exactly once', async () => {
        const readReloadSettings = vi.fn().mockResolvedValue({
          mcpServers: { fresh: { command: 'fresh' } },
          blockedMcpServers: [{ name: 'blocked', extensionName: 'ext' }],
          settingsMcpServers: { fresh: { command: 'fresh' } },
        });

        const config = new Config({
          ...baseParams,
          trustedFolder: true,
          mcpServers: { stale: { command: 'stale' } },
        });
        const owner = await createTestMcpRuntime(
          { oauth: createTestOAuthBinding(), config },
          { mcpSettings: createReloadBinding(config, readReloadSettings) },
        );
        approvalRoots.push(() => owner.dispose());
        await owner.initialize();

        await owner.reload();

        expect(owner.readServerSettings().mcpServers).toStrictEqual({
          fresh: { command: 'fresh' },
        });
        expect(owner.readServerSettings().blockedMcpServers).toStrictEqual([
          { name: 'blocked', extensionName: 'ext' },
        ]);
        expect(config.getMcpServers()).not.toStrictEqual(
          owner.readServerSettings().mcpServers,
        );
      });
    });
  });
  function createReloadBinding(
    config: Config,
    load: () => Promise<
      import('@vybestack/llxprt-code-core/session/session-settings-owner.js').WorkspaceMcpSettings
    >,
  ): import('@vybestack/llxprt-code-core/session/session-settings-owner.js').SessionMcpSettingsReads {
    const owner = new SessionSettingsOwner(new SettingsService());
    owner.bindMcpSettings(
      {
        mcpServers: config.getMcpServers() ?? {},
        blockedMcpServers: config.getBlockedMcpServers() ?? [],
        settingsMcpServers: config.getMcpServers() ?? {},
      },
      load,
    );
    const binding = owner.readMcpSettingsBinding();
    if (binding === undefined)
      throw new Error('Missing fixture reload binding');
    approvalRoots.push(async () => owner.dispose());
    return binding;
  }
});
