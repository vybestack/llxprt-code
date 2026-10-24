/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { createTestOAuthBinding } from '@vybestack/llxprt-code-mcp/test-support/oauth.js';
import { buildAgent, type Agent } from './helpers/agentHarness.js';
import {
  startNoAuthMcpFixture,
  type NoAuthMcpFixture,
} from './helpers/mcp-cutover-server-fixture.js';

async function discoveryReady(agent: Agent): Promise<void> {
  await new Promise<void>((resolve) => {
    const check = (): void => {
      if (agent.mcp.discoveryState() === 'ready') {
        unsubscribe();
        resolve();
      }
    };
    const unsubscribe = agent.mcp.subscribeStatus(check);
    check();
  });
}

async function withConnectedAgent(
  run: (agent: Agent, fixture: NoAuthMcpFixture) => Promise<void>,
): Promise<void> {
  const fixture = await startNoAuthMcpFixture();
  const oauth = createTestOAuthBinding();
  const built = await buildAgent('multi-turn-text.jsonl', {
    folderTrust: true,
    mcpTokenStorage: oauth.tokenStorage,
    mcpServers: { same: { httpUrl: `${fixture.base}/mcp` } },
    telemetry: { enabled: false },
    recording: { enabled: false },
  });
  try {
    await discoveryReady(built.agent);
    await run(built.agent, fixture);
  } finally {
    await built.cleanup();
    await fixture.close();
  }
}

function recordSettlement(
  fixture: NoAuthMcpFixture,
  operation: Promise<unknown>,
  marker: string,
): Promise<'fulfilled' | 'rejected'> {
  return operation
    .then(
      () => 'fulfilled' as const,
      () => 'rejected' as const,
    )
    .then((outcome) => {
      fixture.events.push(marker);
      return outcome;
    });
}

function deleteIndexesAfter(
  fixture: NoAuthMcpFixture,
  marker: string,
): number[] {
  const start = fixture.events.indexOf(marker);
  return fixture.events
    .map((event, index) => (event === 'delete' && index > start ? index : -1))
    .filter((index) => index !== -1);
}

describe('MCP runtime retirement with MCP operations in flight (characterization)', () => {
  it.each(['initialize', 'resources/list'])(
    'agent.mcp.refresh held on %s has settled before dispose fulfills, with no session closed ahead of it',
    async (method) => {
      await withConnectedAgent(async (agent, fixture) => {
        fixture.hold(method);
        const refreshing = recordSettlement(
          fixture,
          agent.mcp.refresh('same'),
          'refresh-settled',
        );
        await fixture.waitUntilHeld(method);
        const disposing = agent.dispose();
        fixture.release(method);
        await disposing;
        expect(fixture.events).toContain('refresh-settled');
        await refreshing;
        const settled = fixture.events.indexOf('refresh-settled');
        for (const index of deleteIndexesAfter(fixture, `held:${method}`))
          expect(index).toBeGreaterThan(settled);
      });
    },
  );

  it('agent.mcp.readResource held on resources/read is cancelled and settled before dispose fulfills, and no session closes ahead of it', async () => {
    await withConnectedAgent(async (agent, fixture) => {
      fixture.hold('resources/read');
      const reading = recordSettlement(
        fixture,
        agent.mcp.readResource('same', 'test://same'),
        'read-settled',
      );
      await fixture.waitUntilHeld('resources/read');
      await agent.dispose();
      expect(fixture.events).toContain('read-settled');
      expect(await reading).toBe('rejected');
      const settled = fixture.events.indexOf('read-settled');
      for (const index of deleteIndexesAfter(fixture, 'held:resources/read'))
        expect(index).toBeGreaterThan(settled);
    });
  });
});
