import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { createTestMcpRuntime } from './helpers/create-mcp-runtime.js';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { createTestOAuthBinding } from '@vybestack/llxprt-code-mcp/test-support/oauth.js';
import { resolveRepositoryFixture } from './helpers/fixtureRoot.js';
import { existsSync } from 'node:fs';
import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

describe('MCP Config lifetime deletion', () => {
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'engine-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });

  useFakeResponsesReplay('plain-text.jsonl');

  it('closes owner instruction and resource admission without disposing caller Config', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mcp-config-lifetime-'));
    const config = new Config({
      sessionId: 'closed-owner',
      targetDir: directory,
      cwd: directory,
      model: 'test',
      debugMode: false,
      trustedFolder: true,
      coreTools: [],
      skillsSupport: false,
      telemetry: { enabled: false },
    });
    const mcp = await createTestMcpRuntime(
      { oauth: createTestOAuthBinding(), config },
      {},
    );
    try {
      await mcp.initialize();
      await mcp.dispose();
      expect(() => mcp.readInstructions()).toThrow('stopped');
      expect(() => mcp.findResource('missing')).toThrow('stopped');
      await expect(mcp.readResource('missing', 'uri')).rejects.toThrow(
        'stopped',
      );
      expect(config.getTargetDir()).toBeTruthy();
      await expect(mcp.trust.setTrustedFolderLive(false)).rejects.toThrow(
        'disposed',
      );
      expect(mcp.isStopped()).toBe(true);
    } finally {
      await mcp.dispose();
      await config.dispose();
      await rm(directory, { recursive: true, force: true });
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
    const owner = await createTestMcpRuntime(
      { oauth: createTestOAuthBinding(), config },
      {},
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
        const owner = await createTestMcpRuntime(
          { oauth: createTestOAuthBinding(), config },
          {
            mcpSettings: {
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
    const route = await openRouteAAgent();
    try {
      await route.agent.dispose();
      await expect(
        route.agent.generate('Do not send this request'),
      ).rejects.toThrow('closed');
      await expect(route.agent.generateJson([], {})).rejects.toThrow('closed');
    } finally {
      await route.close();
    }
  }, 30000);
});
