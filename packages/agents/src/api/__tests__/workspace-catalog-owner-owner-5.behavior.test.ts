import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openWorkspaceCatalogAgent } from './helpers/workspace-catalog-agent.js';
import { waitForFixtureFile } from './helpers/workspace-catalog-http-fixture.js';

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

  it('cancels retained physical prompt invocation and denies reuse after root disposal', async () => {
    const workspace = await openWorkspaceCatalogAgent({
      authority: credentials().authority,
    });
    const { agent } = workspace;
    try {
      const prompt = agent.mcp
        .listPrompts('physical')
        .find((prompt) => prompt.serverName === 'physical');
      if (!prompt) throw new Error('Physical prompt was not published');
      expect((await prompt.invoke({})).messages[0]?.content).toMatchObject({
        text: 'Quantity squared is 49',
      });
      const outcome = prompt.invoke({ hold: 'yes' }).then(
        () => 'fulfilled',
        () => 'rejected',
      );
      expect(
        await waitForFixtureFile(join(workspace.catalogDirectory, 'entered')),
      ).toBe('prompts/get');
      await agent.dispose();
      expect(await outcome).toBe('rejected');
      await expect(prompt.invoke({})).rejects.toThrow('stopped');
      expect(
        (
          await readFile(join(workspace.catalogDirectory, 'requests'), 'utf8')
        ).split('\n'),
      ).toContain('notifications/cancelled');
    } finally {
      await workspace.closeCatalog();
    }
  }, 30000);
});
