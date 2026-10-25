/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { awaitMcpDiscoveryReady } from './helpers/mcp-discovery-ready.js';
import { openRouteAAgent, type RouteAAgent } from './helpers/route-a-agent.js';

const evidence = join(
  tmpdir(),
  'llxprt-mcp-status-owner-implementation-retained',
);
const fixture = fileURLToPath(
  new URL('./helpers/mcp-owner-status-stdio-fixture.ts', import.meta.url),
);

describe('MCP public owner status isolation', () => {
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

  it('keeps B connected and usable after stopping A with the same server label', async () => {
    await mkdir(evidence, { recursive: true });
    const directory = await mkdtemp(join(evidence, 'runtime-'));
    const opened: RouteAAgent[] = [];
    const pids: number[] = [];
    try {
      for (const name of ['A', 'B']) {
        const cwd = join(directory, name);
        await mkdir(cwd);
        const route = await openRouteAAgent({
          config: {
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
          },
        });
        opened.push(route);
        await awaitMcpDiscoveryReady(route.agent);
        pids.push(Number(await readFile(join(cwd, 'server.pid'), 'utf8')));
      }
      const [{ agent: agentA }, { agent: agentB }] = opened;
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
      const tools = agentB.tools.list();
      const resources = agentB.mcp
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
      expect(agentB.tools.list()).toStrictEqual(tools);
      expect(agentB.mcp.findResource('same:fixture:///counter')).toBe(
        resources,
      );
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
        [...opened].reverse().map((route) => route.close()),
      );
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
