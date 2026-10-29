import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';

describe('production filesystem roots', () => {
  let promptDirectory: string;

  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;

  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'workspace-owner-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });

  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });

  useFakeResponsesReplay('plain-text.jsonl');
  const builtCredentials = useOwnedCredentials();

  it.each([
    { name: 'utf8', bytes: Buffer.from('Plain UTF-8 λ') },
    {
      name: 'utf8-bom',
      bytes: Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from('UTF-8 BOM λ'),
      ]),
    },
    {
      name: 'utf16le',
      bytes: Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from('UTF-16 λ', 'utf16le'),
      ]),
    },
  ])('decodes default public read_file content: $name', async ({ bytes }) => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'public-bom-')),
    );
    const file = join(directory, 'input.txt');
    await writeFile(file, bytes);
    const route = await openRouteAAgent({
      config: { workingDir: directory },
      authority: builtCredentials().authority,
    });
    try {
      const reader = route.agent.tools.get('read_file');
      if (!reader) throw new Error('Missing public read_file');
      const result = await reader.buildAndExecute(
        { file_path: file },
        new AbortController().signal,
      );
      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('λ');
    } finally {
      await route.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
