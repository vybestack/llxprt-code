/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { buildSlashCommandRuntimeForTest } from '../../__tests__/slash-command-runtime-fixture.js';
import { describe, expect, it, spyOn } from 'bun:test';
import { openRouteAAgent } from '../../../../agents/src/api/__tests__/helpers/route-a-agent.js';
import { useFakeResponsesReplay } from '../../../../agents/src/api/__tests__/helpers/fake-responses-replay.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { registerMcpCommand } from '../../__tests__/credential-command-test-owner.js';

describe('CLI MCP authentication', () => {
  useFakeResponsesReplay('multi-turn-text.jsonl');

  it('belongs to the public Agent disposal lifetime', async () => {
    let enter = (): void => {};
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    let release = (): void => {};
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signal: AbortSignal | null | undefined;
    const network = spyOn(globalThis, 'fetch').mockImplementation(
      Object.assign(
        async (
          _url: Parameters<typeof fetch>[0],
          init: Parameters<typeof fetch>[1],
        ) => {
          signal = init?.signal;
          enter();
          await barrier;
          return new Response(null, { status: 401 });
        },
        { preconnect: () => {} },
      ),
    );
    const built = await openRouteAAgent({
      config: {
        folderTrust: false,
        mcpServers: { shared: { httpUrl: 'https://mcp-owner.test/mcp' } },
        telemetry: { enabled: false },
        recording: { enabled: false },
      },
    });
    const base = createMockCommandContext();
    const context = {
      ...base,
      services: {
        ...base.services,
        agent: built.agent,
        config: buildSlashCommandRuntimeForTest(built.config, built.agent),
      },
    };
    const messages: unknown[] = [];
    let reloads = 0;
    context.ui.addItem = (item) => {
      messages.push(item);
      return 1;
    };
    context.ui.reloadCommands = () => {
      reloads++;
    };
    const action = registerMcpCommand(context).subCommands?.find(
      (command) => command.name === 'auth',
    )?.action;
    if (!action) throw new Error('Missing MCP auth command');
    let work: ReturnType<typeof action> | undefined;
    let disposal: Promise<void> | undefined;
    try {
      work = action(createMockCommandContext(), 'shared');
      await entered;
      expect(JSON.stringify(messages)).toContain(
        "Starting OAuth authentication for MCP server 'shared'",
      );
      disposal = built.agent.dispose();
      expect(signal?.aborted).toBe(true);
      release();
      expect(await work).toMatchObject({
        type: 'message',
        messageType: 'error',
      });
      await disposal;
      expect(JSON.stringify(messages)).not.toContain(
        'Successfully authenticated',
      );
      expect(reloads).toBe(0);
    } finally {
      release();
      await work;
      await disposal;
      await built.close();
      network.mockRestore();
    }
  }, 30000);
});
