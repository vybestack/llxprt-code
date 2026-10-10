/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveRepositoryFixture } from './helpers/fixtureRoot.js';
import { MCPDiscoveryState, McpClient } from '@vybestack/llxprt-code-mcp';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import { fromConfig } from '../fromConfig.js';

describe('MCP Agent operations', () => {
  it('joins configured discovery when disposing the retained MCP owner', async () => {
    let signalEntered!: () => void;
    const entered = new Promise<void>((resolveEntered) => {
      signalEntered = resolveEntered;
    });
    let release!: () => void;
    const pending = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const connection = spyOn(McpClient.prototype, 'connect').mockImplementation(
      async () => {
        signalEntered();
        await pending;
      },
    );
    const built = await buildCliStyleConfig('plain-text.jsonl', {
      folderTrust: true,
      mcpServers: {
        held: { command: process.execPath, args: ['-e', 'process.exit(0)'] },
      },
      telemetry: { enabled: false },
      recording: { enabled: false },
    });
    try {
      await entered;
      expect(built.mcpRuntime.status()?.discoveryState).toBe(
        MCPDiscoveryState.IN_PROGRESS,
      );
      let disposed = false;
      const disposal = built.mcpRuntime.dispose().then(() => {
        disposed = true;
      });
      await new Promise<void>((resolveTurn) => setImmediate(resolveTurn));
      expect(disposed).toBe(false);
      release();
      await disposal;
      expect(built.mcpRuntime.isStopped()).toBe(true);
    } finally {
      release();
      connection.mockRestore();
      await built.cleanup();
    }
  }, 30000);

  it('uses retained MCP discovery and refresh for an adopted Agent without Config runtime delegates', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mcp-agent-operations-'));
    const built = await buildCliStyleConfig('plain-text.jsonl', {
      folderTrust: true,
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
      telemetry: { enabled: false },
      recording: { enabled: false },
    });
    const obsolete = [
      'getMcpRuntimeStatus',
      'refreshMcpServers',
      'awaitMcpDiscoveryGate',
      'getMcpClientManager',
    ];
    for (const name of obsolete) {
      Object.defineProperty(built.config, name, {
        configurable: true,
        value: () => {
          throw new Error(
            'Agent must not locate the MCP runtime through Config',
          );
        },
      });
    }
    const agent = await fromConfig({
      settingsOwner: built.settingsOwner,
      settingsService: built.settingsService,
      agentClient: built.agentClient,
      providerManager: built.providerManager,
      config: built.config,
      mcpRuntime: built.mcpRuntime,
    });
    try {
      const controller = new AbortController();
      controller.abort();
      const events = [];
      for await (const event of agent.stream('unused', {
        signal: controller.signal,
      })) {
        events.push(event);
      }
      expect(events).toStrictEqual([{ type: 'done', reason: 'aborted' }]);
      expect(agent.mcp.discoveryState()).toBe('ready');
      Object.defineProperty(built.config, 'getResourceRegistry', {
        configurable: true,
        value: () => {
          throw new Error('Lookup must retain its original resource catalog');
        },
      });
      try {
        expect(
          agent.mcp.findResource('arithmetic:fixture:///arithmetic'),
        ).toMatchObject({
          serverName: 'arithmetic',
          uri: 'fixture:///arithmetic',
        });
        expect(
          agent.mcp.findResource('absent:fixture:///arithmetic'),
        ).toBeUndefined();
      } finally {
        Reflect.deleteProperty(built.config, 'getResourceRegistry');
      }
      expect(
        await agent.mcp.readResource('arithmetic', 'fixture:///arithmetic'),
      ).toMatchObject({
        contents: [{ text: 'Addition combines quantities.' }],
      });
      await expect(
        agent.mcp.readResource('absent', 'fixture:///arithmetic'),
      ).rejects.toThrow('not available');
      await agent.mcp.refresh('arithmetic');
      const requests = await readFile(join(directory, 'requests'), 'utf8');
      expect(
        requests.split('\n').filter((line) => line === 'tools/list'),
      ).toHaveLength(2);
      const prompt = built.mcpRuntime.listPrompts('arithmetic')[0];
      await agent.dispose();
      expect(built.mcpRuntime.isStopped()).toBe(false);
      expect(() =>
        agent.mcp.findResource('arithmetic:fixture:///arithmetic'),
      ).toThrow('closed');
      expect(
        built.mcpRuntime.findResource('arithmetic:fixture:///arithmetic'),
      ).toBeDefined();
      await expect(
        agent.mcp.readResource('arithmetic', 'fixture:///arithmetic'),
      ).rejects.toThrow('closed');
      expect(
        await built.mcpRuntime.readResource(
          'arithmetic',
          'fixture:///arithmetic',
        ),
      ).toMatchObject({
        contents: [{ text: 'Addition combines quantities.' }],
      });
      expect(
        (await prompt.invoke({ value: 'nine' })).messages[0]?.content,
      ).toMatchObject({ text: 'Explain nine' });
      const revocation = built.mcpRuntime.trust.setTrustedFolderLive(false);
      await expect(
        built.mcpRuntime.readResource('arithmetic', 'fixture:///arithmetic'),
      ).rejects.toThrow(/not available|not authorized|not connected/i);
      await revocation;
    } finally {
      for (const name of obsolete) Reflect.deleteProperty(built.config, name);
      await agent.dispose();
      await built.cleanup();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30000);
});
