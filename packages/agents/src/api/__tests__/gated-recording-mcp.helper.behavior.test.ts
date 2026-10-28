/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { createAgent, type Agent } from '@vybestack/llxprt-code-agents';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import {
  createGatedRecordingMcp,
  type GatedRecordingMcp,
} from './helpers/gated-recording-mcp.js';

/**
 * Control test for the H-c `gateDiscovery` option: the server holds its
 * `tools/list` response until `releaseDiscovery()`, and answers at once when
 * the option is absent.
 */
describe('gated recording MCP server discovery gate', () => {
  useFakeResponsesReplay('plain-text.jsonl');
  const open: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const close of open.splice(0)) await close();
  });

  async function openAgent(mcp: GatedRecordingMcp): Promise<Agent> {
    const agent = await createAgent({
      provider: 'fake',
      model: 'fake-model',
      workingDir: process.cwd(),
      mcpServers: mcp.mcpServers,
    });
    open.push(() => agent.dispose(), mcp.close);
    return agent;
  }

  it('holds discovery until releaseDiscovery and then publishes the tool', async () => {
    const mcp = await createGatedRecordingMcp({
      toolName: 'external_record',
      gateDiscovery: true,
    });
    const agent = await openAgent(mcp);
    await mcp.discoveryEntered();
    await sleep(200);
    expect(agent.mcp.discoveryState()).not.toBe('ready');
    expect(agent.tools.list().map((tool) => tool.serverToolName)).not.toContain(
      'external_record',
    );
    await mcp.releaseDiscovery();
    const handle = await mcp.tool(agent);
    expect(handle).toBeDefined();
    expect(agent.mcp.discoveryState()).toBe('ready');
  }, 60_000);

  it('answers discovery at once when the option is absent', async () => {
    const mcp = await createGatedRecordingMcp({ toolName: 'external_record' });
    const agent = await openAgent(mcp);
    expect(await mcp.tool(agent)).toBeDefined();
    expect(
      (await mcp.effects()).filter(
        (effect) => effect.event === 'discovery-entered',
      ),
    ).toStrictEqual([]);
  }, 60_000);

  it('rejects discovery controls on a server created without the option', async () => {
    const mcp = await createGatedRecordingMcp({ toolName: 'external_record' });
    open.push(mcp.close);
    expect(() => mcp.discoveryEntered()).toThrow('gateDiscovery');
    expect(() => mcp.releaseDiscovery()).toThrow('gateDiscovery');
  });
});
