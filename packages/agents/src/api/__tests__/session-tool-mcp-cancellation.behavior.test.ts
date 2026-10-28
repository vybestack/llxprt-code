import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { createTestOAuthBinding } from '@vybestack/llxprt-code-mcp/test-support/oauth.js';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { createAgent } from '../createAgent.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { awaitMcpDiscoveryReady } from './helpers/mcp-discovery-ready.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import {
  startCatalogFixture,
  waitForFixtureFile,
} from './helpers/workspace-catalog-http-fixture.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

describe('physical MCP tool cancellation', () => {
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
  const credentials = useOwnedCredentials();

  async function runCancellation(closeOwner: boolean): Promise<void> {
    const directory = await mkdtemp(join(tmpdir(), 'physical-tool-cancel-'));
    const server = await startCatalogFixture(directory);
    const oauth = createTestOAuthBinding();
    const agent = await createAgent({
      provider: 'fake',
      model: 'fake-model',
      workingDir: directory,
      interactive: true,
      folderTrust: true,
      telemetry: { enabled: false },
      recording: { enabled: false },
      mcpServers: { physical: { httpUrl: server.url, trust: true } },
      mcpTokenStorage: oauth.tokenStorage,
      credentialAuthority: credentials().authority,
    });
    const controller = new AbortController();
    try {
      await awaitMcpDiscoveryReady(agent);
      const declaration = agent.tools
        .list()
        .find((tool) => tool.serverToolName === 'multiply');
      if (declaration === undefined)
        throw new Error('Missing actual MCP declaration');
      const tool = agent.tools.get(declaration.name);
      if (tool === undefined) throw new Error('Missing actual MCP capability');
      const operation = tool.build({ factor: 99 }).execute(controller.signal);
      const settled = operation.then(
        () => undefined,
        (error: unknown) => error,
      );
      await waitForFixtureFile(join(directory, 'tool-entered'));
      if (closeOwner) {
        await agent.dispose();
      } else {
        controller.abort(new Error('Caller cancelled physical multiplication'));
      }
      expect(await settled).toBeInstanceOf(Error);
      await waitForFixtureFile(join(directory, 'tool-cancelled'));
      const requests = (
        await readFile(join(directory, 'requests'), 'utf8')
      ).split('\n');
      expect(requests.filter((method) => method === 'tools/call')).toHaveLength(
        1,
      );
      expect(
        requests.filter((method) => method === 'notifications/cancelled'),
      ).toHaveLength(1);
      await expect(
        readFile(join(directory, 'product'), 'utf8'),
      ).rejects.toThrow('ENOENT');
      if (closeOwner) {
        await expect(
          tool.buildAndExecute({ factor: 2 }, new AbortController().signal),
        ).rejects.toThrow('closed');
      }
    } finally {
      server.release();
      await runCleanupSteps([
        () => agent.dispose(),
        () => server.stop(),
        () => rm(directory, { recursive: true, force: true }),
      ]);
    }
  }

  it('forwards caller cancellation into the actual MCP JSON-RPC work', async () => {
    await expect(runCancellation(false)).resolves.toBeUndefined();
  });
  it('forwards session closure into the actual MCP JSON-RPC work and withdraws retained dispatch', async () => {
    await expect(runCancellation(true)).resolves.toBeUndefined();
  });
});
