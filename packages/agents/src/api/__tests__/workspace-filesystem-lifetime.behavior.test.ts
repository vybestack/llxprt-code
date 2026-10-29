import { mkdtemp, realpath, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type { AgentConfig } from '../config-types.js';
import { createAgent } from '../createAgent.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

import { buildAgent } from './helpers/agentHarness.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

describe('public Agent workspace filesystem lifetime', () => {
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

  const rootedConfig = (
    directory: string,
    root: WorkspaceFilesystemOwner,
    ownership?: AgentConfig['filesystemOwnership'],
  ): AgentConfig => ({
    provider: 'fake',
    model: 'fake-model',
    workingDir: directory,
    interactive: true,
    filesystemOwner: root,
    filesystemOwnership: ownership,
    harness: { includeProcessCwd: false },
    credentialAuthority: credentials().authority,
  });

  it('rejects caller lifetime without an explicit filesystem root', async () => {
    await expect(
      buildAgent('plain-text.jsonl', { filesystemOwnership: 'caller' }),
    ).rejects.toThrow(
      'Caller-owned filesystem requires an explicit workspace root',
    );
  });

  for (const reverse of [false, true]) {
    it(`retains exact borrowed text implementation across facade disposal order ${reverse}`, async () => {
      const directory = await realpath(
        await mkdtemp(join(tmpdir(), 'agent-filesystem-')),
      );
      const file = join(directory, 'input.txt');
      await writeFile(file, 'initial');
      await writeFile(join(directory, '.llxprtignore'), 'input.txt\n');
      const service = {
        readTextFile: async (filePath: string): Promise<string> =>
          `borrowed:${await readFile(filePath, 'utf8')}`,
        writeTextFile: async (
          filePath: string,
          content: string,
        ): Promise<void> => writeFile(filePath, content.toUpperCase()),
      };
      const root = new WorkspaceFilesystemOwner({
        targetDir: directory,
        isTrusted: () => true,
        fileSystem: { service, ownership: 'caller' },
      });
      const first = await createAgent(rootedConfig(directory, root));
      const second = await createAgent(rootedConfig(directory, root));
      try {
        expect(await first.workspace.search(directory, '*.txt')).toStrictEqual(
          [],
        );
        await writeFile(join(directory, '.llxprtignore'), '');
        expect(await second.workspace.search(directory, '*.txt')).toStrictEqual(
          ['input.txt'],
        );
        const writer = first.tools.get('write_file');
        const reader = second.tools.get('read_file');
        if (!writer || !reader)
          throw new Error('Missing actual filesystem tools');
        const written = await writer.buildAndExecute(
          { file_path: file, content: 'through-public-agent' },
          new AbortController().signal,
        );
        expect(written.error).toBeUndefined();
        expect(await readFile(file, 'utf8')).toBe('THROUGH-PUBLIC-AGENT');
        const read = await reader.buildAndExecute(
          { file_path: file },
          new AbortController().signal,
        );
        expect(read.error).toBeUndefined();
        expect(read.llmContent).toContain('borrowed:THROUGH-PUBLIC-AGENT');
        for (const facade of reverse ? [second, first] : [first, second]) {
          expect(facade.workspace.getDirectories()).toStrictEqual([directory]);
          await facade.dispose();
          await writeFile(join(directory, '.llxprtignore'), 'input.txt\n');
          expect(await root.search.search(directory, '*.txt')).toStrictEqual(
            [],
          );
          await writeFile(join(directory, '.llxprtignore'), '');
          expect(await root.search.search(directory, '*.txt')).toStrictEqual([
            'input.txt',
          ]);
          await root.files.writeTextFile(file, 'next');
          expect(await root.files.readTextFile(file)).toBe('borrowed:NEXT');
        }
        expect(await root.files.readTextFile(file)).toBe('borrowed:NEXT');
        await root.dispose();
        expect(await service.readTextFile(file)).toBe('borrowed:NEXT');
        await expect(root.files.readTextFile(file)).rejects.toThrow('disposed');
      } finally {
        await runCleanupSteps([
          () => first.dispose(),
          () => second.dispose(),
          () => root.dispose(),
          () => rm(directory, { recursive: true, force: true }),
        ]);
      }
    });
  }
  it('closes owned filesystem admission synchronously and joins accepted reads', async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'agent-filesystem-join-')),
    );
    const file = join(directory, 'input.txt');
    await writeFile(file, 'accepted');
    let release: () => void = () => {
      throw new Error('Missing read release');
    };
    const held = new Promise<void>((done) => {
      release = done;
    });
    const root = new WorkspaceFilesystemOwner({
      targetDir: directory,
      isTrusted: () => true,
      fileSystem: {
        ownership: 'workspace',
        service: {
          readTextFile: async (input) => {
            await held;
            return readFile(input, 'utf8');
          },
          writeTextFile: (input, content) => writeFile(input, content),
        },
      },
    });
    const agent = await createAgent(rootedConfig(directory, root, 'agent'));
    const accepted = root.files.readTextFile(file);
    const closing = agent.dispose();
    const afterClosing = root.files.readTextFile(file);
    release();
    try {
      await expect(afterClosing).rejects.toThrow('disposed');
    } finally {
      expect(await accepted).toBe('accepted');
      await closing;
      await runCleanupSteps([
        () => agent.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ]);
    }
  });
});
