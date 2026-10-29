import { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { afterAll, beforeAll, describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { clientSkillNames } from './helpers/skill-declaration-reads.js';
import { openSkillWorkspaceSession } from './helpers/skill-workspace-session.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

describe('failed production skill publication', () => {
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
  const builtCredentials = useOwnedCredentials();

  it('does not grant newly discovered resource access after model publication rejects', async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'failed-skill-publication-')),
    );
    const file = join(directory, 'secret.txt');
    await writeFile(file, 'not granted');
    const root = new WorkspaceFilesystemOwner({
      targetDir: process.cwd(),
      isTrusted: () => true,
    });
    const {
      config,
      mcp,
      client,
      close: builtCallerClose,
    } = await openSkillWorkspaceSession({
      authority: builtCredentials().authority,
      overrides: { filesystemOwner: root, skillsSupport: true },
    });
    const publish = spyOn(client, 'setTools');
    publish.mockRejectedValueOnce(new Error('Model publication rejected'));
    try {
      config.setExtensions([
        {
          name: 'candidate',
          version: '1',
          isActive: true,
          path: directory,
          contextFiles: [],
          skills: [
            {
              name: 'candidate',
              description: 'Candidate resource',
              location: join(directory, 'SKILL.md'),
              body: 'Use secret.txt',
            },
          ],
        },
      ]);
      await expect(mcp.workspaceSkills.operations.reload()).rejects.toThrow(
        'Model publication rejected',
      );
      expect(mcp.toolSelection.getTool('activate_skill')).toBeUndefined();
      expect(clientSkillNames(client)).toStrictEqual([]);
      await expect(root.files.readTextFile(file)).rejects.toThrow('workspace');
      await builtCallerClose();
      expect(
        await root.files.readTextFile(join(process.cwd(), 'package.json')),
      ).toContain('@vybestack/llxprt-code-agents');
    } finally {
      publish.mockRestore();
      await builtCallerClose();
      await root.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
