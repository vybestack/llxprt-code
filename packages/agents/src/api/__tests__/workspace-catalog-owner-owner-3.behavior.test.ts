import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { createTestOAuthBinding } from '@vybestack/llxprt-code-mcp/test-support/oauth.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { createTestMcpRuntime } from './helpers/create-mcp-runtime.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { startCatalogFixture } from './helpers/workspace-catalog-http-fixture.js';
import { openWorkspaceCatalogAgent } from './helpers/workspace-catalog-agent.js';

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

  it('projects physical tools, prompts and resources through public Agent operations', async () => {
    const workspace = await openWorkspaceCatalogAgent({
      authority: credentials().authority,
    });
    try {
      const { agent } = workspace;
      const detail = await agent.mcp.details({
        includeTools: true,
        includePrompts: true,
        includeResources: true,
      });
      expect(
        detail.servers[0]?.prompts?.map((prompt) => prompt.name),
      ).toContain('quantity');
      expect(
        detail.servers[0]?.resources?.map((resource) => resource.uri),
      ).toContain('fixture:///quantity');
      const tool = agent.tools
        .list()
        .find((candidate) => candidate.name.includes('multiply'));
      if (!tool) throw new Error('Physical MCP tool was not published');
      const handle = agent.tools.get(tool.name);
      if (!handle) throw new Error('Physical MCP tool was not selectable');
      await handle.buildAndExecute({ factor: 6 }, new AbortController().signal);
      expect(
        await readFile(join(workspace.catalogDirectory, 'product'), 'utf8'),
      ).toBe('42');
      expect(
        await agent.mcp.readResource('physical', 'fixture:///quantity'),
      ).toMatchObject({ contents: [{ text: '7' }] });
    } finally {
      await workspace.closeCatalog();
    }
  }, 30000);

  it('serves physical prompts and resources from the MCP runtime without locating catalogs through Config', async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'workspace-catalog-')),
    );
    const server = await startCatalogFixture(directory);
    const config = new Config({
      sessionId: 'catalog-without-config-lookup',
      targetDir: directory,
      cwd: directory,
      model: 'test',
      debugMode: false,
      trustedFolder: true,
      interactive: true,
      coreTools: [],
      mcpServers: { physical: { httpUrl: server.url, trust: true } },
      telemetry: { enabled: false },
    });
    const forbiddenCalls: string[] = [];
    for (const name of ['getPromptRegistry', 'getResourceRegistry'])
      Object.defineProperty(config, name, {
        configurable: true,
        value: (): never => {
          forbiddenCalls.push(name);
          throw new Error('Config must not locate a workspace catalog');
        },
      });
    const owner = await createTestMcpRuntime(
      { oauth: createTestOAuthBinding(), config },
      {},
    );
    try {
      await owner.initialize();
      expect([...(await owner.awaitDiscovery())]).toStrictEqual([]);
      expect(
        owner.listPrompts('physical').map((prompt) => prompt.name),
      ).toContain('quantity');
      expect(owner.listResources().map((resource) => resource.uri)).toContain(
        'fixture:///quantity',
      );
      expect(
        await owner.readResource('physical', 'fixture:///quantity'),
      ).toMatchObject({ contents: [{ text: '7' }] });
      expect(forbiddenCalls).toStrictEqual([]);
    } finally {
      server.release();
      await runCleanupSteps([
        () => owner.dispose(),
        () => config.dispose(),
        () => server.stop(),
        () => rm(directory, { recursive: true, force: true }),
      ]);
    }
  }, 30000);
});
