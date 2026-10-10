/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceFilesystemOwner } from './workspace-filesystem-owner.js';

describe('workspace discovery ownership', () => {
  let directory = '';
  let roots: readonly WorkspaceFilesystemOwner[] = [];
  beforeEach(async () => {
    directory = await realpath(
      await mkdtemp(join(tmpdir(), 'discovery-2616-')),
    );
  });
  afterEach(async () => {
    await Promise.all(roots.map((root) => root.dispose()));
    roots = [];
    await rm(directory, { recursive: true, force: true });
  });
  async function workspace(
    name: string,
    trusted: () => boolean = () => true,
  ): Promise<WorkspaceFilesystemOwner> {
    const targetDir = join(directory, name);
    await mkdir(targetDir, { recursive: true });
    await mkdir(join(targetDir, '.git'));
    await writeFile(join(targetDir, 'visible.txt'), 'visible');
    await writeFile(join(targetDir, 'hidden.txt'), 'hidden');
    const root = new WorkspaceFilesystemOwner({
      targetDir,
      isTrusted: trusted,
    });
    roots = [...roots, root];
    return root;
  }
  it('joins a queued external scan and closes later admission', async () => {
    const root = await workspace('queued-scan');
    let release = (): void => {
      throw new Error('Scan release absent');
    };
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const accepted = root.scans.run(root.paths.directories(), async () => {
      await gate;
      return (
        await readFile(join(directory, 'queued-scan', 'visible.txt'), 'utf8')
      ).toUpperCase();
    });
    let closed = false;
    const disposal = root.dispose().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    await expect(
      root.scans.run([join(directory, 'queued-scan')], async () => 1),
    ).rejects.toThrow('disposed');
    release();
    expect(await accepted).toBe('VISIBLE');
    await disposal;
    expect(closed).toBe(true);
  });
  it('refreshes both physical ignore sources and honors selected filtering between searches', async () => {
    const root = await workspace('same-label');
    const target = root.paths.directories()[0];
    await writeFile(join(target, '.gitignore'), 'hidden.txt\n');
    expect(await root.search.search(target, '*.txt')).toStrictEqual([
      'visible.txt',
    ]);
    await writeFile(
      join(target, '.llxprtignore'),
      '!hidden.txt\nvisible.txt\n',
    );
    expect(await root.search.search(target, '*.txt')).toStrictEqual([
      'hidden.txt',
    ]);
    expect(
      await root.search.search(target, '*.txt', { respectLlxprtIgnore: false }),
    ).toStrictEqual(['visible.txt']);
    await writeFile(join(target, '.gitignore'), 'visible.txt\n');
    await writeFile(join(target, '.llxprtignore'), '');
    expect(await root.search.search(target, '*.txt')).toStrictEqual([
      'hidden.txt',
    ]);
    await writeFile(join(target, '.gitignore'), '');
    expect(await root.search.search(target, '*.txt')).toStrictEqual([
      'hidden.txt',
      'visible.txt',
    ]);
  });
  it('refreshes physical Git excludes between admitted searches', async () => {
    const root = await workspace('git-excludes');
    const target = root.paths.directories()[0];
    await mkdir(join(target, '.git', 'info'));
    const excludes = join(target, '.git', 'info', 'exclude');
    await writeFile(excludes, 'hidden.txt\n');
    expect(await root.search.search(target, '*.txt')).toStrictEqual([
      'visible.txt',
    ]);
    await writeFile(excludes, 'visible.txt\n');
    expect(await root.search.search(target, '*.txt')).toStrictEqual([
      'hidden.txt',
    ]);
  });
  it('keeps conflicting root ignore caches independent', async () => {
    const first = await workspace('first/same-label');
    const second = await workspace('second/same-label');
    const a = first.paths.directories()[0];
    const b = second.paths.directories()[0];
    await writeFile(join(a, '.llxprtignore'), 'hidden.txt\n');
    await writeFile(join(b, '.llxprtignore'), 'visible.txt\n');
    expect(await first.search.search(a, '*.txt')).toStrictEqual([
      'visible.txt',
    ]);
    expect(await second.search.search(b, '*.txt')).toStrictEqual([
      'hidden.txt',
    ]);
    await first.dispose();
    expect(await second.search.search(b, '*.txt')).toStrictEqual([
      'hidden.txt',
    ]);
  });
  for (const withdrawal of ['trust', 'skill']) {
    it(`rechecks ${withdrawal} authority during an admitted search`, async () => {
      let trusted = true;
      let approved = true;
      const root = await workspace('primary', () => trusted);
      const external = await workspace('external');
      const outside = external.paths.directories()[0];
      const release = root.admitSkillDirectory(outside, () => approved);
      const accepted = root.search.search(outside, '*.txt');
      if (withdrawal === 'trust') trusted = false;
      else approved = false;
      await expect(accepted).rejects.toThrow('workspace');
      release();
    });
  }
  it('joins accepted scans and closes queued admission on disposal', async () => {
    const root = await workspace('primary');
    const target = root.paths.directories()[0];
    const first = root.search.search(target, '*.txt');
    const second = root.search.search(target, '*.txt');
    const closing = root.dispose();
    await expect(root.search.search(target, '*.txt')).rejects.toThrow(
      'disposed',
    );
    expect(await first).toStrictEqual(['hidden.txt', 'visible.txt']);
    expect(await second).toStrictEqual(['hidden.txt', 'visible.txt']);
    await closing;
    expect(() =>
      root.ignore.shouldIgnoreFile(join(target, 'hidden.txt')),
    ).toThrow('disposed');
  });
});
