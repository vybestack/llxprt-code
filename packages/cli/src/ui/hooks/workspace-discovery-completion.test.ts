/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core';
import { findFilesWithGlob } from './atCompletionUtils.js';

describe('completion through workspace discovery authority', () => {
  let directory = '';
  let root: WorkspaceFilesystemOwner;
  beforeEach(async () => {
    directory = await realpath(
      await mkdtemp(join(tmpdir(), 'discovery-completion-')),
    );
    await mkdir(join(directory, '.git'));
    await mkdir(join(directory, 'nested'));
    await writeFile(
      join(directory, 'nested', 'candidate.txt'),
      'completion input',
    );
    root = new WorkspaceFilesystemOwner({
      targetDir: directory,
      isTrusted: () => true,
    });
  });
  afterEach(async () => {
    await root.dispose();
    await rm(directory, { recursive: true, force: true });
  });
  const options = { respectGitIgnore: true, respectLlxprtIgnore: true };
  function complete(): Promise<string[]> {
    return findFilesWithGlob(
      'candidate',
      root.search.search,
      options,
      directory,
      directory,
    ).then((suggestions) => suggestions.map((suggestion) => suggestion.label));
  }
  it('uses current nested git and llxprt rules on every completion request', async () => {
    expect(await complete()).toStrictEqual(['nested/candidate.txt']);
    await writeFile(join(directory, 'nested', '.gitignore'), 'candidate.txt\n');
    expect(await complete()).toStrictEqual([]);
    await writeFile(
      join(directory, '.llxprtignore'),
      '!nested/candidate.txt\n',
    );
    expect(await complete()).toStrictEqual(['nested/candidate.txt']);
    await writeFile(join(directory, '.llxprtignore'), 'nested/candidate.txt\n');
    await writeFile(join(directory, 'nested', '.gitignore'), '');
    expect(await complete()).toStrictEqual([]);
    await writeFile(join(directory, '.llxprtignore'), '');
    expect(await complete()).toStrictEqual(['nested/candidate.txt']);
  });
  it('does not publish completions after live skill authority is withdrawn', async () => {
    const skill = join(directory, 'skill');
    await mkdir(skill);
    await writeFile(join(skill, 'candidate.txt'), 'skill input');
    const outer = new WorkspaceFilesystemOwner({
      targetDir: join(directory, 'nested'),
      isTrusted: () => true,
    });
    let approved = true;
    const release = outer.admitSkillDirectory(skill, () => approved);
    try {
      const accepted = findFilesWithGlob(
        'candidate',
        outer.search.search,
        options,
        skill,
        directory,
      );
      approved = false;
      await expect(accepted).rejects.toThrow('workspace');
    } finally {
      release();
      await outer.dispose();
    }
  });
});
