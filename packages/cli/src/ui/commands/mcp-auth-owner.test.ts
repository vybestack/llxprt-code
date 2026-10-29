/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { buildSlashCommandRuntimeForTest } from '../../__tests__/slash-command-runtime-fixture.js';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it, spyOn } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { createTestOAuthBinding } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { createAgent } from '@vybestack/llxprt-code-agents';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { useFakeResponsesReplay } from '../../../../agents/src/api/__tests__/helpers/fake-responses-replay.js';
import { useOwnedCredentials } from '../../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { registerMcpCommand } from '../../__tests__/credential-command-test-owner.js';

describe('CLI MCP authentication', () => {
  useFakeResponsesReplay('multi-turn-text.jsonl');
  const builtCredentials = useOwnedCredentials();

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
    // The agent is a Route C root (HTTP MCP servers on Route A and B use the
    // OS keychain); the slash-command runtime reads declarations from the
    // test's own Config.
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'mcp-auth-owner-')),
    );
    const agent = await createAgent({
      provider: 'fake',
      model: 'fake-model',
      workingDir: directory,
      folderTrust: false,
      mcpServers: { shared: { httpUrl: 'https://mcp-owner.test/mcp' } },
      mcpTokenStorage: createTestOAuthBinding().tokenStorage,
      credentialAuthority: builtCredentials().authority,
      telemetry: { enabled: false },
      recording: { enabled: false },
    });
    const declarations = new Config({
      sessionId: randomUUID(),
      targetDir: directory,
      cwd: directory,
      debugMode: false,
      model: 'fake-model',
      folderTrust: false,
      telemetry: { enabled: false },
    });
    const base = createMockCommandContext();
    const context = {
      ...base,
      services: {
        ...base.services,
        agent,
        config: buildSlashCommandRuntimeForTest(declarations, agent),
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
      disposal = agent.dispose();
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
      await agent.dispose();
      await declarations.dispose();
      await rm(directory, { recursive: true, force: true });
      network.mockRestore();
    }
  }, 30000);
});
