import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
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

  it('refreshes a server without withdrawing a sibling with a shared label prefix', async () => {
    const workspace = await openWorkspaceCatalogAgent({
      authority: credentials().authority,
      serverNames: ['physical', 'physical:peer'],
    });
    try {
      const sibling = workspace.agent.mcp
        .listPrompts('physical:peer')
        .find((prompt) => prompt.serverName === 'physical:peer');
      if (!sibling)
        throw new Error('Sibling physical prompt was not published');
      await workspace.agent.mcp.refresh('physical');
      expect((await sibling.invoke({})).messages[0]?.content).toMatchObject({
        text: 'Quantity squared is 49',
      });
      expect(
        workspace.agent.mcp
          .listResources()
          .map((resource) => resource.serverName),
      ).toContain('physical:peer');
    } finally {
      await workspace.closeCatalog();
    }
  }, 30000);
});
