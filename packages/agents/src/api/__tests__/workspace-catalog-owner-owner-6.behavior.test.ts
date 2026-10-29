import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { createTestOAuthBinding } from '@vybestack/llxprt-code-mcp/test-support/oauth.js';
import type { Agent } from '../agent.js';
import { createAgent } from '../createAgent.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { awaitMcpDiscoveryReady } from './helpers/mcp-discovery-ready.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import {
  startCatalogFixture,
  type PhysicalCatalogFixture,
} from './helpers/workspace-catalog-http-fixture.js';

describe('workspace catalog ownership through public Agent operations', () => {
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
  const credentials = [useOwnedCredentials(), useOwnedCredentials()];

  let fixtureDirectory: string;
  let fixtureServer: PhysicalCatalogFixture;

  async function openAgent(index: number): Promise<Agent> {
    const agent = await createAgent({
      provider: 'fake',
      model: 'fake-model',
      workingDir: fixtureDirectory,
      interactive: true,
      folderTrust: true,
      mcpServers: {
        physical: { httpUrl: fixtureServer.url, trust: true },
      },
      mcpTokenStorage: createTestOAuthBinding().tokenStorage,
      credentialAuthority: credentials[index]().authority,
      telemetry: { enabled: false },
      recording: { enabled: false },
    });
    await awaitMcpDiscoveryReady(agent);
    return agent;
  }

  async function openfixture(): Promise<Agent[]> {
    fixtureDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'workspace-catalog-')),
    );
    fixtureServer = await startCatalogFixture(fixtureDirectory);
    return [await openAgent(0), await openAgent(1)];
  }

  async function closefixture(): Promise<void> {
    fixtureServer.release();
    await runCleanupSteps([
      () => fixtureServer.stop(),
      () => rm(fixtureDirectory, { recursive: true, force: true }),
    ]);
  }

  it.each([0, 1])(
    "retains each agent's catalog independent of the other agent's disposal order %i",
    async (first) => {
      const agents = await openfixture();
      try {
        const prompts = agents.map((agent) => {
          const prompt = agent.mcp
            .listPrompts('physical')
            .find((current) => current.serverName === 'physical');
          if (!prompt) throw new Error('Physical prompt was not published');
          return prompt;
        });
        const closing = agents[first];
        const other = agents[1 - first];
        const closingPrompt = prompts[first];
        const otherPrompt = prompts[1 - first];
        await closing.dispose();
        expect(
          await other.mcp.readResource('physical', 'fixture:///quantity'),
        ).toMatchObject({ contents: [{ text: '7' }] });
        expect(
          (await otherPrompt.invoke({})).messages[0]?.content,
        ).toMatchObject({ text: 'Quantity squared is 49' });
        await other.mcp.refresh('physical');
        await expect(otherPrompt.invoke({})).rejects.toThrow('withdrawn');
        expect(
          other.mcp.listPrompts('physical').map((current) => current.name),
        ).toContain('quantity');
        await other.dispose();
        await expect(
          closing.mcp.readResource('physical', 'fixture:///quantity'),
        ).rejects.toThrow('closed');
        await expect(closingPrompt.invoke({})).rejects.toThrow('stopped');
      } finally {
        for (const agent of agents) await agent.dispose();
        await closefixture();
      }
    },
    30000,
  );
});
