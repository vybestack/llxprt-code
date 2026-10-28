/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAgent,
  type Agent,
  type AgentEvent,
} from '@vybestack/llxprt-code-agents';
import { awaitMcpDiscoveryReady } from '../../../agents/src/api/__tests__/helpers/mcp-discovery-ready.js';
import {
  createScriptedHeadlessMcpOwner,
  SCRIPTED_LISTING_OUTPUT,
  SCRIPTED_LISTING_TOOL_NAME,
  type ScriptedHeadlessMcpOwner,
} from './scripted-headless-mcp-owner.js';

const scriptedEvents: readonly AgentEvent[] = [
  {
    type: 'tool-call',
    call: {
      id: 'tool-listing-1',
      name: SCRIPTED_LISTING_TOOL_NAME,
      args: { command: 'ls' },
    },
  },
  { type: 'text', text: 'listed' },
  { type: 'done', reason: 'stop' },
];

describe('scripted headless MCP owner', () => {
  let previousReplay: string | undefined;
  let workingDirectory: string;
  const open: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    workingDirectory = await mkdtemp(join(tmpdir(), 'scripted-mcp-owner-'));
  });
  afterEach(async () => {
    for (const close of open.splice(0).reverse()) await close();
    if (previousReplay === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previousReplay;
    await rm(workingDirectory, { recursive: true, force: true });
  });

  async function openAgent(owner: ScriptedHeadlessMcpOwner): Promise<Agent> {
    process.env.LLXPRT_FAKE_RESPONSES = owner.responsesFile;
    const agent = await createAgent({
      provider: 'fake',
      model: 'fake-model',
      workingDir: workingDirectory,
      mcpServers: owner.mcpServers,
      harness: {
        forceInteractive: false,
        forceConfirmations: false,
        includeProcessCwd: false,
      },
    });
    open.push(() => agent.dispose());
    await awaitMcpDiscoveryReady(agent);
    return agent;
  }

  async function collect(agent: Agent): Promise<AgentEvent[]> {
    const events: AgentEvent[] = [];
    for await (const event of agent.stream('List the files'))
      events.push(event);
    return events;
  }

  it('runs the scripted listing call through the MCP server and reports the listing', async () => {
    const owner = await createScriptedHeadlessMcpOwner(scriptedEvents);
    open.push(owner.close);
    const agent = await openAgent(owner);

    const events = await collect(agent);

    expect(
      events.flatMap((event) =>
        event.type === 'tool-result'
          ? [{ id: event.result.id, display: event.result.display }]
          : [],
      ),
    ).toStrictEqual([
      { id: 'tool-listing-1', display: SCRIPTED_LISTING_OUTPUT },
    ]);
    expect(events.filter((event) => event.type === 'text')).toStrictEqual([
      { type: 'text', text: 'listed' },
    ]);
    expect(events.filter((event) => event.type === 'done')).toStrictEqual([
      { type: 'done', reason: 'stop' },
    ]);
  }, 60_000);

  it('removes its temporary files on close', async () => {
    const owner = await createScriptedHeadlessMcpOwner(scriptedEvents);

    await owner.close();

    await expect(access(owner.responsesFile)).rejects.toThrow(/ENOENT/);
  });

  it('rejects scripted events it cannot replay', async () => {
    await expect(
      createScriptedHeadlessMcpOwner([
        { type: 'error', message: 'unsupported' } as unknown as AgentEvent,
      ]),
    ).rejects.toThrow('Unsupported scripted provider event error');
  });
});
