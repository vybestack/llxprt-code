/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core';
import { AggregateDisposeError } from '../disposeErrors.js';
import * as agents from '../../../index.js';
import { loadSkillsFromDir } from '@vybestack/llxprt-code-core/skills/skillLoader.js';
import { createTestOAuthBinding } from '@vybestack/llxprt-code-mcp/test-support/oauth.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

describe('Public skill discovery boundary', () => {
  useOwnedCredentials();

  it('does not export a workspace runtime owner to ordinary consumers', () => {
    expect(Reflect.has(agents, 'McpRuntimeOwner')).toBe(false);
  });

  it('discovers project and extension skill files through private native initialization and returns only skill data', async () => {
    const home = process.env.LLXPRT_CONFIG_HOME;
    if (home === undefined) throw new Error('Missing isolated home');
    const workspace = join(home, 'workspace');
    const project = join(workspace, '.agents/skills/native-project');
    const extension = join(home, 'extension');
    const extensionSkill = join(extension, 'skills/native-extension');
    await mkdir(project, { recursive: true });
    await mkdir(extensionSkill, { recursive: true });
    await writeFile(
      join(project, 'SKILL.md'),
      '---\nname: native-project\ndescription: Project filesystem discovery\n---\nRead the local files.\n',
    );
    await writeFile(
      join(extensionSkill, 'SKILL.md'),
      '---\nname: native-extension\ndescription: Extension filesystem discovery\n---\nRead extension files.\n',
    );
    const oauth = createTestOAuthBinding();
    const skills = await agents.discoverAgentSkills(
      {
        workingDir: workspace,
        skillsEnabled: true,
        trustedFolder: true,
        mcpEnabled: false,
        disabledSkills: ['native-project'],
        extensions: [
          {
            name: 'native-extension-package',
            version: '1',
            path: extension,
            isActive: true,
            contextFiles: [],
            skills: await loadSkillsFromDir(
              join(extension, 'skills'),
              'extension',
            ),
          },
        ],
      },
      { oauth },
    );
    const projectResult = skills.find(
      (skill) => skill.name === 'native-project',
    );
    const extensionResult = skills.find(
      (skill) => skill.name === 'native-extension',
    );
    expect(projectResult).toMatchObject({
      source: 'project',
      disabled: true,
      location: join(project, 'SKILL.md'),
    });
    expect(extensionResult).toMatchObject({
      source: 'extension',
      location: join(extensionSkill, 'SKILL.md'),
    });
    expect(Array.isArray(skills)).toBe(true);
    expect(Reflect.has(skills, 'workspaceSkills')).toBe(false);
    expect(Reflect.has(skills, 'policyOwner')).toBe(false);
    expect(Reflect.has(skills, 'messageBus')).toBe(false);
    expect(await oauth.tokenStorage.listServers()).toStrictEqual([]);
  });

  it('rolls back native acquisition on invalid host OAuth capability access while preserving independent errors and borrowed storage', async () => {
    const home = process.env.LLXPRT_CONFIG_HOME;
    if (home === undefined) throw new Error('Missing isolated home');
    const workspace = join(home, 'failed-workspace');
    await mkdir(workspace, { recursive: true });
    const primary = new Error('host OAuth capability unavailable');
    const cleanup = new Error('workspace cleanup failed');
    const dispose = WorkspaceFilesystemOwner.prototype.dispose;
    const retired = new Set<WorkspaceFilesystemOwner>();
    const retirement = spyOn(
      WorkspaceFilesystemOwner.prototype,
      'dispose',
    ).mockImplementation(async function (this: WorkspaceFilesystemOwner) {
      await dispose.call(this);
      retired.add(this);
      throw cleanup;
    });
    const oauth = createTestOAuthBinding();
    try {
      const error: unknown = await agents
        .discoverAgentSkills(
          { workingDir: workspace, skillsEnabled: true, trustedFolder: true },
          {
            oauth: {
              ...oauth,
              get tokenStorage(): typeof oauth.tokenStorage {
                throw primary;
              },
            },
          },
        )
        .then(
          () => null,
          (failure: unknown) => failure,
        );
      const leaves = (failure: unknown): readonly unknown[] =>
        failure instanceof AggregateError ||
        failure instanceof AggregateDisposeError
          ? failure.errors.flatMap(leaves)
          : [failure];
      expect(leaves(error)).toContain(primary);
      expect(leaves(error)).toContain(cleanup);
      expect(retired.size).toBe(1);
      for (const filesystem of retired)
        await expect(
          filesystem.files.readTextFile(join(workspace, 'missing')),
        ).rejects.toThrow('disposed');
      expect(await oauth.tokenStorage.listServers()).toStrictEqual([]);
    } finally {
      retirement.mockRestore();
    }
  });
});
