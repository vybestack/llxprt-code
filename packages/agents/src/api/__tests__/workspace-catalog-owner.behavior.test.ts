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
  const credentials = useOwnedCredentials();

  let fixtureDirectory: string;
  let fixtureServer: PhysicalCatalogFixture;

  async function openfixture(
    serverNames: string[] = ['physical'],
  ): Promise<Agent> {
    fixtureDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'workspace-catalog-')),
    );
    fixtureServer = await startCatalogFixture(fixtureDirectory);
    const agent = await createAgent({
      provider: 'fake',
      model: 'fake-model',
      workingDir: fixtureDirectory,
      interactive: true,
      folderTrust: true,
      mcpServers: Object.fromEntries(
        serverNames.map((name) => [
          name,
          { httpUrl: fixtureServer.url, trust: true },
        ]),
      ),
      mcpTokenStorage: createTestOAuthBinding().tokenStorage,
      credentialAuthority: credentials().authority,
      telemetry: { enabled: false },
      recording: { enabled: false },
    });
    await awaitMcpDiscoveryReady(agent);
    return agent;
  }

  async function closefixture(): Promise<void> {
    fixtureServer.release();
    await runCleanupSteps([
      () => fixtureServer.stop(),
      () => rm(fixtureDirectory, { recursive: true, force: true }),
    ]);
  }

  it('withdraws physical prompt and resource declarations while trust is revoked', async () => {
    const agent = await openfixture();
    try {
      const visible = await agent.mcp.details({
        includePrompts: true,
        includeResources: true,
      });
      expect(
        visible.servers
          .flatMap((server) => server.prompts ?? [])
          .map((prompt) => prompt.name),
      ).toContain('quantity');
      await agent.ide.setTrustedFolderLive(false);
      const withdrawn = await agent.mcp.details({
        includePrompts: true,
        includeResources: true,
      });
      expect(
        withdrawn.servers.flatMap((server) => server.prompts ?? []),
      ).toStrictEqual([]);
      expect(
        withdrawn.servers.flatMap((server) => server.resources ?? []),
      ).toStrictEqual([]);
    } finally {
      await agent.dispose();
      await closefixture();
    }
  }, 30000);
});
