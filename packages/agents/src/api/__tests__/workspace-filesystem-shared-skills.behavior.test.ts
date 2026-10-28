import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type { Agent } from '../agent.js';
import type { AgentConfig } from '../config-types.js';
import { createAgent } from '../createAgent.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

function requireActivationTool<T>(tool: T | undefined): T {
  if (tool === undefined) throw new Error('Missing production activation tool');
  return tool;
}

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

describe('shared production skill resource admission', () => {
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

  for (const reverse of [false, true]) {
    it(`retains shared resources after one runtime closes and withdraws them after both (${reverse})`, async () => {
      const directory = await realpath(
        await mkdtemp(join(tmpdir(), 'shared-skill-resource-')),
      );
      const workingDirectories = [
        await realpath(await mkdtemp(join(tmpdir(), 'shared-skill-first-'))),
        await realpath(await mkdtemp(join(tmpdir(), 'shared-skill-second-'))),
      ];
      const file = join(directory, 'resource.txt');
      await writeFile(file, 'shared resource bytes');
      const root = new WorkspaceFilesystemOwner({
        targetDir: process.cwd(),
        isTrusted: () => true,
      });
      const extension = {
        name: 'shared-resource',
        version: '1',
        isActive: true,
        path: directory,
        contextFiles: [],
        skills: [
          {
            name: 'shared-resource',
            description: 'Reads shared resource',
            location: join(directory, 'SKILL.md'),
            body: 'Use resource.txt',
          },
        ],
      };
      const sharedRootConfig = (workingDir: string): AgentConfig => ({
        provider: 'fake',
        model: 'fake-model',
        workingDir,
        interactive: true,
        filesystemOwner: root,
        skillsSupport: true,
        extensions: [extension],
        harness: { includeProcessCwd: false },
        credentialAuthority: credentials().authority,
      });
      const facades: Agent[] = [];
      try {
        for (const workingDir of workingDirectories)
          facades.push(await createAgent(sharedRootConfig(workingDir)));
        for (const facade of facades) {
          const tool = facade.tools.get('activate_skill');
          const activationTool = requireActivationTool(tool);
          const activated = await activationTool.buildAndExecute(
            { name: 'shared-resource' },
            new AbortController().signal,
          );
          expect(activated.error).toBeUndefined();
        }
        const releases = reverse
          ? [() => facades[1].dispose(), () => facades[0].dispose()]
          : [() => facades[0].dispose(), () => facades[1].dispose()];
        await releases[0]();
        const survivor = facades[reverse ? 0 : 1].tools.get('read_file');
        if (!survivor) throw new Error('Missing production read tool');
        const read = await survivor.buildAndExecute(
          { file_path: file },
          new AbortController().signal,
        );
        expect(read.error).toBeUndefined();
        expect(read.llmContent).toContain(await root.files.readTextFile(file));
        await releases[1]();
        await expect(root.files.readTextFile(file)).rejects.toThrow(
          'workspace',
        );
        const callerFile = join(process.cwd(), 'package.json');
        expect(await root.files.readTextFile(callerFile)).toContain(
          '@vybestack/llxprt-code-agents',
        );
      } finally {
        await runCleanupSteps([
          ...facades.map((facade) => () => facade.dispose()),
          () => root.dispose(),
          () => rm(directory, { recursive: true, force: true }),
          ...workingDirectories.map(
            (workingDir) => () =>
              rm(workingDir, { recursive: true, force: true }),
          ),
        ]);
      }
    });
  }
});
