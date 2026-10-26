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

const MCP_CLOSE_DEADLINE_MS = 10_000;

function describeFailure(failure: unknown): string {
  expect(failure).toBeDefined();
  if (failure instanceof AggregateError)
    return [failure.message, ...failure.errors.map(describeFailure)].join('|');
  return failure instanceof Error ? failure.message : String(failure);
}
const SOCKET_CLOSE_WAIT_MS = 2000;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

async function socketsClosed(fixture: NoAuthMcpFixture): Promise<void> {
  const deadline = Date.now() + SOCKET_CLOSE_WAIT_MS;
  while (fixture.liveSockets() > 0 && Date.now() < deadline) await delay(5);
}

interface HeldDisposal {
  readonly outcome: 'fulfilled' | 'rejected';
  readonly events: readonly string[];
}

/**
 * Starts `operation`, waits until the fixture holds `method`, disposes with the
 * hold still armed, and releases only after `dispose` fulfills. Releasing on a
 * timer instead would race retirement: when the timer won, the fixture answered
 * a request production had already given up on, so the abandonment the test
 * asserts was overwritten by `released:<method>`. Retirement alone must end the
 * held request.
 */
async function disposeWhileHeld(
  fixture: NoAuthMcpFixture,
  method: string,
  start: () => Promise<unknown>,
  dispose: () => Promise<void>,
): Promise<HeldDisposal> {
  fixture.hold(method);
  const settlement = recordSettlement(fixture, start(), 'operation-settled');
  await fixture.waitUntilHeld(method);
  const first = fixture.events.length;
  const disposing = dispose().then(() => fixture.events.push('disposed'));
  await disposing;
  fixture.release(method);
  const outcome = await settlement;
  await socketsClosed(fixture);
  return {
    outcome,
    events: fixture.events.slice(first),
  };
}

function expectOperationJoinedBeforeDisposal(
  fixture: NoAuthMcpFixture,
  result: HeldDisposal,
): void {
  const settled = result.events.indexOf('operation-settled');
  const disposed = result.events.indexOf('disposed');
  expect(settled).toBeGreaterThanOrEqual(0);
  expect(disposed).toBeGreaterThan(settled);
  expect(fixture.liveSockets()).toBe(0);
  expect(fixture.liveSessions()).toBe(0);
}

describe('MCP runtime retirement with MCP operations in flight (characterization)', () => {
  it('a plain agent.dispose terminates the MCP session and leaves no connection open', async () => {
    await withConnectedAgent(async (agent, fixture) => {
      expect(fixture.liveSessions()).toBe(1);
      await agent.dispose();
      await socketsClosed(fixture);
      expect(fixture.events).toContain('delete:session-1');
      expect(fixture.liveSessions()).toBe(0);
      expect(fixture.liveSockets()).toBe(0);
    });
  });

  it('a session DELETE the server never answers is cancelled at the close deadline, reported once, and does not hang agent.dispose', async () => {
    await withConnectedAgent(async (agent, fixture) => {
      fixture.holdSessionDeletes();
      const startedAt = Date.now();

      const failure: unknown = await agent.dispose().then(
        () => undefined,
        (error: unknown) => error,
      );

      expect(Date.now() - startedAt).toBeLessThan(MCP_CLOSE_DEADLINE_MS + 5000);
      await socketsClosed(fixture);
      expect(fixture.events).toContain('delete:session-1');
      expect(fixture.events).toContain('delete-abandoned:session-1');
      expect(fixture.liveSockets()).toBe(0);
      expect(describeFailure(failure).split('session-1').length - 1).toBe(1);
    });
  }, 60_000);

  it.each(['initialize', 'resources/list'])(
    'agent.mcp.refresh held on %s settles before dispose fulfills and leaves no connection open',
    async (method) => {
      await withConnectedAgent(async (agent, fixture) => {
        const result = await disposeWhileHeld(
          fixture,
          method,
          () => agent.mcp.refresh('same'),
          () => agent.dispose(),
        );
        expect(result.events).toContain(`abandoned:${method}`);
        expectOperationJoinedBeforeDisposal(fixture, result);
      });
    },
  );

  it('agent.mcp.readResource held on resources/read is cancelled and settled before dispose fulfills and leaves no connection open', async () => {
    await withConnectedAgent(async (agent, fixture) => {
      const result = await disposeWhileHeld(
        fixture,
        'resources/read',
        () => agent.mcp.readResource('same', 'test://same'),
        () => agent.dispose(),
      );
      expect(result.outcome).toBe('rejected');
      expect(result.events).toContain('abandoned:resources/read');
      expectOperationJoinedBeforeDisposal(fixture, result);
    });
  });
});
