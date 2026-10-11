/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, realpath, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import { SimpleExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import { fromConfig } from '../fromConfig.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';

describe('shared production skill resource admission', () => {
  for (const reverse of [false, true]) {
    it(`retains shared resources after one runtime closes and withdraws them after both (${reverse})`, async () => {
      const directory = await realpath(
        await mkdtemp(join(tmpdir(), 'shared-skill-resource-')),
      );
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
      const first = await buildCliStyleConfig(
        'plain-text.jsonl',
        { filesystemOwner: root, skillsSupport: true },
        {},
        {},
        new SimpleExtensionLoader([extension]),
      );
      const second = await buildCliStyleConfig(
        'plain-text.jsonl',
        { filesystemOwner: root, skillsSupport: true },
        {},
        {},
        new SimpleExtensionLoader([extension]),
      );
      const facades = [
        await fromConfig({
          settingsOwner: first.settingsOwner,
          settingsService: first.settingsService,
          config: first.config,
          providerManager: first.providerManager,
          agentClient: first.agentClient,
          mcpRuntime: first.mcpRuntime,
        }),
        await fromConfig({
          settingsOwner: second.settingsOwner,
          settingsService: second.settingsService,
          config: second.config,
          providerManager: second.providerManager,
          agentClient: second.agentClient,
          mcpRuntime: second.mcpRuntime,
        }),
      ];
      try {
        for (const facade of facades) {
          const tool = facade.tools.get('activate_skill');
          const activationTool = requireActivationTool(tool);
          const activated = await activationTool.buildAndExecute(
            { name: 'shared-resource' },
            new AbortController().signal,
          );
          expect(activated.error).toBeUndefined();
        }
        const runtimes = reverse ? [second, first] : [first, second];
        await runtimes[0].cleanup();
        const survivor = facades[reverse ? 0 : 1].tools.get('read_file');
        if (!survivor) throw new Error('Missing production read tool');
        const read = await survivor.buildAndExecute(
          { file_path: file },
          new AbortController().signal,
        );
        expect(read.error).toBeUndefined();
        expect(read.llmContent).toContain(await root.files.readTextFile(file));
        await runtimes[1].cleanup();
        await expect(root.files.readTextFile(file)).rejects.toThrow(
          'workspace',
        );
        const callerFile = join(process.cwd(), 'package.json');
        expect(await root.files.readTextFile(callerFile)).toContain(
          '@vybestack/llxprt-code-agents',
        );
      } finally {
        for (const facade of facades) await facade.dispose();
        await second.cleanup();
        await first.cleanup();
        await root.dispose();
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
});

describe('failed production skill publication', () => {
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
    const built = await buildCliStyleConfig('plain-text.jsonl', {
      filesystemOwner: root,
      skillsSupport: true,
    });
    const facade = await fromConfig({
      settingsOwner: built.settingsOwner,
      settingsService: built.settingsService,
      config: built.config,
      providerManager: built.providerManager,
      agentClient: built.agentClient,
      mcpRuntime: built.mcpRuntime,
    });
    const publish = spyOn(built.agentClient, 'setTools');
    publish.mockRejectedValueOnce(new Error('Model publication rejected'));
    try {
      built.config.setExtensions([
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
      await expect(
        built.mcpRuntime.workspaceSkills.operations.reload(),
      ).rejects.toThrow('Model publication rejected');
      expect(facade.tools.get('activate_skill')).toBeUndefined();
      await expect(root.files.readTextFile(file)).rejects.toThrow('workspace');
      await facade.dispose();
      await built.cleanup();
      expect(
        await root.files.readTextFile(join(process.cwd(), 'package.json')),
      ).toContain('@vybestack/llxprt-code-agents');
    } finally {
      publish.mockRestore();
      await facade.dispose();
      await built.cleanup();
      await root.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function requireActivationTool<T>(tool: T | undefined): T {
  if (tool === undefined) throw new Error('Missing production activation tool');
  return tool;
}
