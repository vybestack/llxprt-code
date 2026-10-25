import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import {
  openWorkspaceCatalogAgent,
  type WorkspaceCatalogAgent,
} from './helpers/workspace-catalog-agent.js';

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

  it('keeps same-label physical workspace resources and prompts independent', async () => {
    const opened: WorkspaceCatalogAgent[] = [];
    try {
      const first = await openWorkspaceCatalogAgent({
        authority: credentials().authority,
      });
      opened.push(first);
      const second = await openWorkspaceCatalogAgent({
        authority: credentials().authority,
      });
      opened.push(second);
      await writeFile(join(second.catalogDirectory, 'quantity'), '11');
      expect(
        await first.agent.mcp.readResource('physical', 'fixture:///quantity'),
      ).toMatchObject({ contents: [{ text: '7' }] });
      expect(
        await second.agent.mcp.readResource('physical', 'fixture:///quantity'),
      ).toMatchObject({ contents: [{ text: '11' }] });
      const firstPrompt = first.agent.mcp
        .listPrompts('physical')
        .find((prompt) => prompt.name === 'quantity');
      const secondPrompt = second.agent.mcp
        .listPrompts('physical')
        .find((prompt) => prompt.name === 'quantity');
      if (firstPrompt === undefined || secondPrompt === undefined)
        throw new Error('Missing independent physical prompts');
      expect((await firstPrompt.invoke({})).messages[0]?.content).toMatchObject(
        { text: 'Quantity squared is 49' },
      );
      expect(
        (await secondPrompt.invoke({})).messages[0]?.content,
      ).toMatchObject({ text: 'Quantity squared is 121' });
      await first.agent.dispose();
      expect(
        await second.agent.mcp.readResource('physical', 'fixture:///quantity'),
      ).toMatchObject({ contents: [{ text: '11' }] });
      expect(
        (await secondPrompt.invoke({})).messages[0]?.content,
      ).toMatchObject({ text: 'Quantity squared is 121' });
    } finally {
      await runCleanupSteps(opened.map((workspace) => workspace.closeCatalog));
    }
  }, 30000);
});
