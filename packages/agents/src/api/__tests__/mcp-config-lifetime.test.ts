/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createTestOAuthBinding } from '@vybestack/llxprt-code-mcp/test-support/oauth.js';

import { describe, expect, it } from 'bun:test';
import { resolveRepositoryFixture } from './helpers/fixtureRoot.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';

import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';

describe('MCP Config lifetime deletion', () => {
  it('closes owner instruction and resource admission without disposing caller Config', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      await built.mcpRuntime.dispose();
      expect(() => built.mcpRuntime.readInstructions()).toThrow('stopped');
      expect(() => built.mcpRuntime.findResource('missing')).toThrow('stopped');
      await expect(
        built.mcpRuntime.readResource('missing', 'uri'),
      ).rejects.toThrow('stopped');
      expect(built.config.getTargetDir()).toBeTruthy();
      await expect(
        built.mcpRuntime.trust.setTrustedFolderLive(false),
      ).rejects.toThrow('disposed');
      expect(built.mcpRuntime.isStopped()).toBe(true);
    } finally {
      await built.cleanup();
    }
  }, 30000);

  it('revokes trust and disposes while a real stdio discovery response is blocked', async () => {
    const evidence = join(tmpdir(), 'llxprt-mcp-config-lifetime-deletion');
    await mkdir(evidence, { recursive: true });
    const directory = await mkdtemp(join(evidence, 'blocked-'));
    const marker = join(directory, 'discovering');
    const config = new Config({
      sessionId: 'blocked-owner',
      targetDir: directory,
      cwd: directory,
      model: 'test',
      debugMode: false,
      trustedFolder: false,
      coreTools: [],
      skillsSupport: false,
      telemetry: { enabled: false },
      mcpServers: {
        same: {
          command: process.execPath,
          args: [
            resolveRepositoryFixture(
              import.meta.url,
              'scripts/tests/mcp-blocked-discovery-stdio-fixture.ts',
            ),
            marker,
          ],
        },
      },
    });
    const owner = await McpRuntimeOwner.create(
      createTestOAuthBinding(),
      config,
    );
    try {
      await owner.initialize();
      const gaining = owner.trust.setTrustedFolderLive(true);
      await waitFor(() => expect(existsSync(marker)).toBe(true));
      const pid = Number(await readFile(marker, 'utf8'));
      const revoking = owner.trust.setTrustedFolderLive(false);
      expect(owner.readInstructions()).toBe('');
      expect(owner.findResource('same:fixture:///arithmetic')).toBeUndefined();
      await expect(
        owner.readResource('same', 'fixture:///arithmetic'),
      ).rejects.toThrow('not available');
      expect(
        owner.toolSelection
          .getAllTools()
          .filter((tool) => tool.name.startsWith('mcp__')),
      ).toHaveLength(0);
      await owner.dispose();
      await Promise.all([gaining, revoking]);
      expect(() => process.kill(pid, 0)).toThrow('ESRCH');
      expect(() => owner.readInstructions()).toThrow('stopped');
    } finally {
      await owner.dispose();
      await config.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30000);

  it('reloads and refreshes one retained owner without changing another same-label owner', async () => {
    const evidence = join(tmpdir(), 'llxprt-mcp-config-lifetime-deletion');
    await mkdir(evidence, { recursive: true });
    const directory = await mkdtemp(join(evidence, 'reload-'));
    const owners: Array<{
      config: Config;
      owner: McpRuntimeOwner;
      directory: string;
    }> = [];
    try {
      for (const name of ['A', 'B']) {
        const cwd = join(directory, name);
        await mkdir(cwd);
        const config = new Config({
          sessionId: 'same',
          targetDir: cwd,
          cwd,
          model: 'test',
          debugMode: false,
          trustedFolder: true,
          coreTools: [],
          skillsSupport: false,
          telemetry: { enabled: false },
          mcpServers: {
            same: {
              command: process.execPath,
              args: [
                resolveRepositoryFixture(
                  import.meta.url,
                  'scripts/tests/mcp-standalone-stdio-fixture.ts',
                ),
                cwd,
              ],
            },
          },
        });
        const owner = await McpRuntimeOwner.create(
          createTestOAuthBinding(),
          config,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          {
            read: () => ({
              mcpServers: config.getMcpServers() ?? {},
              blockedMcpServers: [],
              settingsMcpServers: {},
            }),
            reload: async () => ({
              mcpServers: {},
              blockedMcpServers: [],
              settingsMcpServers: {},
            }),
          },
        );
        owners.push({ config, owner, directory: cwd });
        await owner.initialize();
        expect(Array.from(await owner.awaitDiscovery())).toStrictEqual([]);
      }
      const [a, b] = owners;
      const catalog = b.owner
        .listResources()
        .find(
          (resource) =>
            resource.serverName === 'same' &&
            resource.uri === 'fixture:///arithmetic',
        );
      expect(catalog).toMatchObject({
        serverName: 'same',
        uri: 'fixture:///arithmetic',
      });
      const tools = b.owner.toolSelection;
      const bus = b.owner.messageBus;
      const bRequests = await readFile(join(b.directory, 'requests'), 'utf8');
      await a.owner.refresh();
      await a.owner.reload();
      expect(a.owner.readInstructions()).toBe('');
      expect(
        a.owner.findResource('same:fixture:///arithmetic'),
      ).toBeUndefined();
      expect(b.owner.readInstructions()).toContain('Use arithmetic locally.');
      expect(b.owner.findResource('same:fixture:///arithmetic')).toBeDefined();
      expect(b.owner.findResource('same:fixture:///arithmetic')).toBe(catalog);
      expect(new Set([b.owner.toolSelection, tools]).size).toBe(1);
      expect(b.owner.messageBus).toBe(bus);
      expect(await readFile(join(b.directory, 'requests'), 'utf8')).toBe(
        bRequests,
      );
    } finally {
      for (const { config, owner } of owners) {
        await owner.dispose();
        await config.dispose();
      }
      await rm(directory, { recursive: true, force: true });
    }
  }, 30000);

  it('rejects late instruction-consuming requests on a disposed borrowed facade', async () => {
    const { fromConfig } = await import('../fromConfig.js');
    const built = await buildCliStyleConfig('plain-text.jsonl');
    const agent = await fromConfig({
      settingsOwner: built.settingsOwner,
      settingsService: built.settingsService,
      agentClient: built.agentClient,
      providerManager: built.providerManager,
      config: built.config,
      mcpRuntime: built.mcpRuntime,
    });
    try {
      await agent.dispose();
      await expect(agent.generate('Do not send this request')).rejects.toThrow(
        'closed',
      );
      await expect(agent.generateJson([], {})).rejects.toThrow('closed');
      expect(built.mcpRuntime.isStopped()).toBe(false);
      expect(built.mcpRuntime.readInstructions()).toBe('');
    } finally {
      await agent.dispose();
      await built.cleanup();
    }
  }, 30000);
});
