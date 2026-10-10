/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Agent } from '../agent.js';
import { fromConfig } from '../fromConfig.js';
import {
  buildCliStyleConfig,
  type BuiltCliConfig,
} from './helpers/buildCliStyleConfig.js';

const evidence = join(
  tmpdir(),
  'llxprt-mcp-status-owner-implementation-retained',
);
const fixture = fileURLToPath(
  new URL('./helpers/mcp-owner-status-stdio-fixture.ts', import.meta.url),
);

describe('MCP public owner status isolation', () => {
  it('keeps B connected and usable after stopping A with the same server label', async () => {
    await mkdir(evidence, { recursive: true });
    const directory = await mkdtemp(join(evidence, 'runtime-'));
    const builtOwners: BuiltCliConfig[] = [];
    const agents: Agent[] = [];
    const pids: number[] = [];
    try {
      for (const name of ['A', 'B']) {
        const cwd = join(directory, name);
        await mkdir(cwd);
        const built = await buildCliStyleConfig('plain-text.jsonl', {
          workingDir: cwd,
          folderTrust: true,
          coreTools: [],
          telemetry: { enabled: false },
          recording: { enabled: false },
          mcpServers: {
            same: {
              command: process.execPath,
              args: [fixture, join(cwd, 'server.pid')],
            },
          },
        });
        builtOwners.push(built);
        expect(
          Array.from(await built.mcpRuntime.awaitDiscovery()),
        ).toStrictEqual([]);
        pids.push(Number(await readFile(join(cwd, 'server.pid'), 'utf8')));
        const tools = built.mcpRuntime.toolSelection;
        const resources = built.mcpRuntime.findResource(
          'same:fixture:///counter',
        );
        const agent = await fromConfig({
          settingsOwner: built.settingsOwner,
          settingsService: built.settingsService,
          agentClient: built.agentClient,
          providerManager: built.providerManager,
          runtimeFactoryBindings: built.runtimeFactoryBindings,
          config: built.config,
          mcpRuntime: built.mcpRuntime,
          mcpOwnership: 'caller',
          messageBus: built.messageBus,
        });

        agents.push(agent);
        expect(agent.getMessageBus()).toBe(built.messageBus);
        expect(new Set([built.mcpRuntime.toolSelection, tools]).size).toBe(1);
        expect(built.mcpRuntime.findResource('same:fixture:///counter')).toBe(
          resources,
        );
      }
      const [a, b] = builtOwners;
      const [agentA, agentB] = agents;
      const baseline = {
        a: agentA.mcp.status(),
        b: agentB.mcp.status(),
        resource: await agentB.mcp.readResource('same', 'fixture:///counter'),
      };
      await writeFile(
        join(evidence, 'baseline.json'),
        JSON.stringify(baseline, null, 2),
      );
      expect(baseline.a.servers).toMatchObject([
        { name: 'same', status: 'connected' },
      ]);
      expect(baseline.b.servers).toMatchObject([
        { name: 'same', status: 'connected' },
      ]);
      expect(baseline.resource).toMatchObject({ contents: [{ text: '1' }] });
      const tools = b.mcpRuntime.toolSelection;
      const resources = b.mcpRuntime
        .listResources()
        .find(
          (resource) =>
            resource.serverName === 'same' &&
            resource.uri === 'fixture:///counter',
        );
      expect(resources).toMatchObject({
        serverName: 'same',
        uri: 'fixture:///counter',
      });
      const aEvents: unknown[] = [];
      const bEvents: unknown[] = [];
      agentA.mcp.subscribeStatus(() => {
        aEvents.push(agentA.mcp.status());
      });
      const releaseB = agentB.mcp.subscribeStatus(() => {
        bEvents.push(agentB.mcp.status());
      });
      await agentA.dispose();
      expect(a.mcpRuntime.isStopped()).toBe(false);
      await a.mcpRuntime.dispose();
      expect(aEvents).toStrictEqual([]);
      expect(bEvents).toStrictEqual([]);
      releaseB();
      const after = {
        list: agentB.mcp.listServers(),
        status: agentB.mcp.status(),
        resource: await agentB.mcp.readResource('same', 'fixture:///counter'),
      };
      await writeFile(
        join(evidence, 'after-stop.json'),
        JSON.stringify(after, null, 2),
      );
      expect(after.resource).toMatchObject({ contents: [{ text: '2' }] });
      expect(new Set([b.mcpRuntime.toolSelection, tools]).size).toBe(1);
      expect(b.mcpRuntime.findResource('same:fixture:///counter')).toBe(
        resources,
      );
      expect(agentB.getMessageBus()).toBe(b.messageBus);
      expect(b.mcpRuntime.isStopped()).toBe(false);
      expect({ list: after.list, status: after.status }).toMatchObject({
        list: [{ name: 'same', status: 'connected' }],
        status: {
          discoveryState: 'ready',
          servers: [{ name: 'same', status: 'connected' }],
        },
      });
      const disconnected = new Promise<void>((resolveDisconnected) => {
        agentB.mcp.subscribeStatus(() => {
          if (
            agentB.mcp
              .listServers()
              .every((server) => server.status === 'disconnected')
          )
            resolveDisconnected();
        });
      });
      process.kill(pids[1], 'SIGTERM');
      await disconnected;
      expect(agentB.mcp.listServers()).toMatchObject([
        { name: 'same', status: 'disconnected' },
      ]);
      expect(bEvents).toStrictEqual([]);
    } finally {
      const results = await Promise.allSettled(
        agents.map((agent) => agent.dispose()),
      );
      for (const built of [...builtOwners].reverse()) {
        results.push(
          ...(await Promise.allSettled([built.mcpRuntime.dispose()])),
        );
        results.push(...(await Promise.allSettled([built.config.dispose()])));
        results.push(...(await Promise.allSettled([built.cleanup()])));
      }
      const alive = pids.filter((pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch (error) {
          if (
            error instanceof Error &&
            'code' in error &&
            error.code === 'ESRCH'
          )
            return false;
          throw error;
        }
      });
      await writeFile(
        join(evidence, 'cleanup.json'),
        JSON.stringify({ pids, alive, results }, null, 2),
      );
      await rm(directory, { recursive: true, force: true });
      const failures = results.filter((result) => result.status === 'rejected');
      expect(failures).toStrictEqual([]);
      expect(alive).toStrictEqual([]);
    }
  });
});
