/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { createTestMcpRuntime } from './helpers/create-mcp-runtime.js';
import { mkdtemp, realpath, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, vi } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { IdeClient } from '@vybestack/llxprt-code-ide-integration';
import { createTestOAuthBinding } from '@vybestack/llxprt-code-mcp/test-support/oauth.js';
import { createAgent } from '../createAgent.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { awaitMcpDiscoveryReady } from './helpers/mcp-discovery-ready.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';
import {
  listenCutoverFixtureServer,
  startCutoverFixtureServer,
} from './helpers/mcp-cutover-server-fixture.js';

describe('explicit MCP construction ownership', () => {
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
  const builtCredentials = useOwnedCredentials();
  useFakeResponsesReplay('plain-text.jsonl');

  it('requires a retained handle when the caller requests MCP ownership', async () => {
    await expect(
      openRouteAAgent({
        intent: { sessionId: ' ' },
        authority: builtCredentials().authority,
      }),
    ).rejects.toThrow('Invalid runtimeId');
    expect(builtCredentials().keySnapshot()).toStrictEqual([]);
  });

  it('retains failed root initialization and rejects a mismatched adoption bus without poisoning an independent root', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mcp-retained-owner-'));
    await mkdir(join(directory, '.agents', 'skills', 'handoff'), {
      recursive: true,
    });
    await writeFile(
      join(directory, '.agents', 'skills', 'handoff', 'SKILL.md'),
      '---\nname: handoff\ndescription: retained handoff skill\n---\nOwned workspace instructions',
    );
    const config = new Config({
      sessionId: 'mcp-owner-handoff',
      skillsSupport: true,
      targetDir: directory,
      cwd: directory,
      debugMode: false,
      model: 'test-model',
    });
    const first = await createTestMcpRuntime(
      { oauth: createTestOAuthBinding(), config },
      {},
    );
    const second = await createTestMcpRuntime(
      {
        oauth: createTestOAuthBinding(),
        config,
        policy: { owner: first.policyOwner, ownership: 'caller' },
      },
      {},
    );
    const primary = new Error('IDE acquisition failed');
    const acquisition = vi
      .spyOn(IdeClient, 'create')
      .mockRejectedValue(primary);
    const initialization = first.initialize();
    const observedFailure = initialization.catch((error: unknown) => error);
    const rootPromises = new Set([initialization, first.initialize()]);
    expect(rootPromises.size).toBe(1);
    const failure = await observedFailure;
    acquisition.mockRestore();
    expect(failure).toBe(primary);
    expect(await first.initialize().catch((error: unknown) => error)).toBe(
      failure,
    );
    expect(first.isStopped()).toBe(false);
    await second.initialize();
    expect(second.isStopped()).toBe(false);
    expect(second.trust).toBe(first.trust);
    expect(second.messageBus).toBe(first.messageBus);
    expect(second.toolSelection.getAllToolNames()).toContain('activate_skill');
    const published = second.toolSelection.getTool('activate_skill');
    if (!published)
      throw new Error('Independent root did not publish its skill tool');
    const activation = await published
      .build({ name: 'handoff' })
      .execute(new AbortController().signal);
    expect(activation.llmContent).toContain('Owned workspace instructions');
    expect(first.isStopped()).toBe(false);
    await second.dispose();
    await expect(first.dispose()).rejects.toThrow(
      'Workspace runtime cleanup failed',
    );
    await config.dispose();
    await rm(directory, { recursive: true, force: true });
  });

  it('borrows the original credential and browser owner for manual reconnect', async () => {
    const fixture = startCutoverFixtureServer('http', () => 1);
    await listenCutoverFixtureServer(fixture);
    const binding = createTestOAuthBinding();
    const browsers: string[] = [];
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-caller-')),
    );
    try {
      const agent = await createAgent({
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        workingDir: directory,
        folderTrust: true,
        mcpServers: {
          same: {
            url: `${fixture.base}/mcp`,
            type: 'http',
            oauth: {
              enabled: false,
              authorizationUrl: `${fixture.base}/authorize`,
              tokenUrl: `${fixture.base}/token`,
              registrationUrl: `${fixture.base}/register`,
            },
          },
        },
        mcpTokenStorage: binding.tokenStorage,
        mcpHost: {
          openBrowser: async (value) => {
            browsers.push(value);
            const url = new URL(value);
            url.searchParams.set('owner', 'borrower');
            const response = await fetch(url);
            await response.text();
          },
        },
      });
      try {
        await awaitMcpDiscoveryReady(agent);
        expect(browsers).toHaveLength(0);
        await agent.mcp.authenticate('same');
        expect(browsers).toHaveLength(1);
        expect(
          (await binding.tokenStorage.getCredentials('same'))?.token
            .accessToken,
        ).toBe('borrower');
        expect(fixture.traffic).toContain('Bearer borrower');
      } finally {
        await agent.dispose();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
      fixture.server.closeAllConnections();
      await new Promise<void>((resolve) =>
        fixture.server.close(() => resolve()),
      );
    }
  });
});
