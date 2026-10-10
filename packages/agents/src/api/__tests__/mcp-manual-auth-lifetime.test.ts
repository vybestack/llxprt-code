/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import {
  MCP_CLIENT_UPDATE_EVENT,
  type HostFeedbackSink,
} from '@vybestack/llxprt-code-mcp/host/hostServices.js';
import { CoreEvent } from '@vybestack/llxprt-code-core';
import { buildAgent } from './helpers/agentHarness.js';

function gate(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('manual MCP authentication lifetime', () => {
  it('keeps the MCP update event compatible with core listeners', () => {
    expect(MCP_CLIENT_UPDATE_EVENT).toBe(CoreEvent.McpClientUpdate);
  });

  it('public disposal aborts manual MCP authentication immediately and joins an external metadata wait', async () => {
    const entered = gate();
    const released = gate();
    let signal: AbortSignal | null | undefined;
    let requests = 0;
    const network = spyOn(globalThis, 'fetch').mockImplementation(
      async (_input, init) => {
        requests++;
        signal = init?.signal;
        entered.release();
        await released.promise;
        return new Response(null, { status: 401 });
      },
    );
    const built = await buildAgent('multi-turn-text.jsonl', {
      folderTrust: false,
      mcpServers: { shared: { httpUrl: 'https://mcp-owner.test/mcp' } },
      telemetry: { enabled: false },
      recording: { enabled: false },
    });
    let auth: Promise<unknown> | undefined;
    let disposal: Promise<void> | undefined;
    try {
      auth = built.agent.mcp.authenticate('shared').then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      await entered.promise;
      let settled = false;
      disposal = built.agent.dispose();
      void disposal.then(() => {
        settled = true;
      });
      expect(signal?.aborted).toBe(true);
      expect(built.agent.dispose()).toBe(disposal);
      await Promise.resolve();
      expect(settled).toBe(false);
      await expect(built.agent.mcp.authenticate('shared')).rejects.toThrow(
        'MCP authentication owner disposed',
      );
      released.release();
      expect(await auth).toHaveProperty('error.name', 'AbortError');
      await disposal;
      expect(requests).toBe(1);
      expect((await built.agent.mcp.auth('shared')).sessionAuthenticated).toBe(
        false,
      );
    } finally {
      released.release();
      await auth;
      await disposal;
      await built.cleanup();
      network.mockRestore();
    }
  }, 30000);

  it('routes real discovery feedback to the explicit public Agent host', async () => {
    const notices: Array<Parameters<HostFeedbackSink>> = [];
    const built = await buildAgent('multi-turn-text.jsonl', {
      folderTrust: true,
      mcpHost: {
        emitFeedback: (...args) => {
          notices.push(args);
        },
      },
      mcpServers: { broken: {} },
      telemetry: { enabled: false },
      recording: { enabled: false },
    });
    try {
      for await (const _event of built.agent.stream('continue')) {
        /* drain discovery gate */
      }
      expect(notices).toHaveLength(1);
      expect(notices[0]?.[0]).toBe('error');
      expect(notices[0]?.[1]).toContain(
        "Error during discovery for server 'broken'",
      );
      expect(notices[0]?.[2]).toBeInstanceOf(Error);
    } finally {
      await built.cleanup();
    }
  }, 30000);

  it('keeps discovery feedback with each public Agent host when two owners coexist', async () => {
    const noticesA: Array<Parameters<HostFeedbackSink>> = [];
    const noticesB: Array<Parameters<HostFeedbackSink>> = [];
    const a = await buildAgent('multi-turn-text.jsonl', {
      folderTrust: true,
      mcpHost: { emitFeedback: (...args) => noticesA.push(args) },
      mcpServers: { brokenA: {} },
      telemetry: { enabled: false },
      recording: { enabled: false },
    });
    try {
      const b = await buildAgent('multi-turn-text.jsonl', {
        folderTrust: true,
        mcpHost: { emitFeedback: (...args) => noticesB.push(args) },
        mcpServers: { brokenB: {} },
        telemetry: { enabled: false },
        recording: { enabled: false },
      });
      try {
        for await (const _event of a.agent.stream('continue')) {
          /* drain discovery gate */
        }
        for await (const _event of b.agent.stream('continue')) {
          /* drain discovery gate */
        }
        expect({
          a: noticesA.map(([, message]) => message),
          b: noticesB.map(([, message]) => message),
        }).toStrictEqual({
          a: [expect.stringContaining("server 'brokenA'")],
          b: [expect.stringContaining("server 'brokenB'")],
        });
      } finally {
        await b.cleanup();
      }
    } finally {
      await a.cleanup();
    }
  }, 30000);
});
