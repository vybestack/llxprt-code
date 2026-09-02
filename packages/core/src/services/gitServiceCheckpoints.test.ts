/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral checkpoint-semantics tests for GitService (#3464) with the REAL
 * git binary, a real project workspace, and a real isolated history root.
 *
 * Every assertion observes produced artifacts (snapshot commit trees, the
 * restored workspace contents, the initialized history directory); nothing
 * about GitService is mocked.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { GitService } from './gitService.js';
import { Storage } from '@vybestack/llxprt-code-settings';

interface Fixture {
  readonly root: string;
  readonly projectRoot: string;
  readonly dataHome: string;
  readonly storage: Storage;
  readonly historyDir: () => string;
}

async function writeFixtureFile(
  projectRoot: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const filePath = path.join(projectRoot, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

async function buildFixture(): Promise<Fixture> {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'issue3464-git-service-'),
  );
  const projectRoot = path.join(root, 'project');
  const dataHome = path.join(root, 'data-home');
  await fs.mkdir(projectRoot, { recursive: true });

  // A real git workspace, as production projects are: root .gitignore,
  // nested .gitignore, and repository-local exclude rules.
  execFileSync('git', ['init', '--initial-branch=main', projectRoot], {
    encoding: 'utf8',
  });
  await writeFixtureFile(projectRoot, '.gitignore', 'root-ignored.txt\n');
  await writeFixtureFile(
    projectRoot,
    '.git/info/exclude',
    'secret-local.txt\n',
  );
  await writeFixtureFile(
    projectRoot,
    'nested/.gitignore',
    'nested-ignored.txt\n',
  );
  await writeFixtureFile(projectRoot, 'tracked.txt', 'tracked v1\n');
  await writeFixtureFile(projectRoot, 'root-ignored.txt', 'ignored\n');
  await writeFixtureFile(projectRoot, 'secret-local.txt', 'ignored\n');
  await writeFixtureFile(projectRoot, 'nested/nested-ignored.txt', 'ignored\n');
  await writeFixtureFile(
    projectRoot,
    'nested/nested-tracked.txt',
    'nested tracked v1\n',
  );

  process.env.LLXPRT_DATA_HOME = dataHome;
  const storage = new Storage(projectRoot);
  return {
    root,
    projectRoot,
    dataHome,
    storage,
    historyDir: () => storage.getHistoryDir(),
  };
}

/** Reads the real snapshot commit tree through the shadow repository. */
function snapshotTree(historyDir: string, commitHash: string): string[] {
  const output = execFileSync(
    'git',
    ['ls-tree', '-r', '--name-only', commitHash],
    {
      env: {
        ...process.env,
        GIT_DIR: path.join(historyDir, '.git'),
        GIT_WORK_TREE: historyDir,
      },
      encoding: 'utf8',
    },
  );
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

describe('GitService checkpoint semantics (#3464)', () => {
  let fixture: Fixture;
  let savedDataHome: string | undefined;
  let savedSandbox: string | undefined;

  beforeEach(async () => {
    savedDataHome = process.env.LLXPRT_DATA_HOME;
    savedSandbox = process.env.SANDBOX;
    delete process.env.SANDBOX;
    fixture = await buildFixture();
  });

  afterEach(async () => {
    if (savedDataHome === undefined) {
      delete process.env.LLXPRT_DATA_HOME;
    } else {
      process.env.LLXPRT_DATA_HOME = savedDataHome;
    }
    if (savedSandbox === undefined) {
      delete process.env.SANDBOX;
    } else {
      process.env.SANDBOX = savedSandbox;
    }
    await fs.rm(fixture.root, { recursive: true, force: true });
  });

  it('snapshots honor root and nested .gitignore files', async () => {
    const service = new GitService(fixture.projectRoot, fixture.storage);
    await service.initialize();
    const hash = await service.createFileSnapshot('ignored rules snapshot');

    const tree = snapshotTree(fixture.historyDir(), hash);
    expect(tree).toContain('tracked.txt');
    expect(tree).toContain('nested/nested-tracked.txt');
    expect(tree).not.toContain('root-ignored.txt');
    expect(tree).not.toContain('nested/nested-ignored.txt');
  });

  it('snapshots honor repository exclude rules', async () => {
    const service = new GitService(fixture.projectRoot, fixture.storage);
    await service.initialize();
    const hash = await service.createFileSnapshot('exclude rules snapshot');

    const tree = snapshotTree(fixture.historyDir(), hash);
    expect(tree).not.toContain('secret-local.txt');
  });

  it('exclude edits between snapshots are honored without re-initializing', async () => {
    const service = new GitService(fixture.projectRoot, fixture.storage);
    await service.initialize();

    await writeFixtureFile(
      fixture.projectRoot,
      '.git/info/exclude',
      'secret-local.txt\nlater-secret.txt\n',
    );
    await writeFixtureFile(
      fixture.projectRoot,
      'later-secret.txt',
      'ignored later\n',
    );
    const hash = await service.createFileSnapshot('edited excludes snapshot');

    const tree = snapshotTree(fixture.historyDir(), hash);
    expect(tree).not.toContain('later-secret.txt');
    expect(tree).toContain('tracked.txt');
  });

  it('restore reverts tracked content and removes files added after the snapshot', async () => {
    const service = new GitService(fixture.projectRoot, fixture.storage);
    await service.initialize();
    const beforeHash = await service.createFileSnapshot('before edits');

    await writeFixtureFile(fixture.projectRoot, 'tracked.txt', 'tracked v2\n');
    await writeFixtureFile(
      fixture.projectRoot,
      'added-after-snapshot.txt',
      'new file\n',
    );
    await service.createFileSnapshot('after edits');

    await service.restoreProjectFromSnapshot(beforeHash);

    await expect(
      fs.readFile(path.join(fixture.projectRoot, 'tracked.txt'), 'utf8'),
    ).resolves.toBe('tracked v1\n');
    await expect(
      fs.access(path.join(fixture.projectRoot, 'added-after-snapshot.txt')),
    ).rejects.toThrow(/ENOENT/);
  });

  it('initialize succeeds without any global git identity (container-like HOME)', async () => {
    // A container sandbox has no ~/.gitconfig: the shadow repository's own
    // .gitconfig (written by setupShadowGitRepository) must be the identity
    // authority for the initial commit, or every first run inside a sandbox
    // dies with "Author identity unknown" (#3464).
    const emptyHome = path.join(fixture.root, 'container-like-home');
    await fs.mkdir(emptyHome, { recursive: true });
    const savedHome = process.env.HOME;
    const savedXdg = process.env.XDG_CONFIG_HOME;
    const savedGlobal = process.env.GIT_CONFIG_GLOBAL;
    const savedSystem = process.env.GIT_CONFIG_SYSTEM;
    const savedCount = process.env.GIT_CONFIG_COUNT;
    const savedKey0 = process.env.GIT_CONFIG_KEY_0;
    const savedValue0 = process.env.GIT_CONFIG_VALUE_0;
    process.env.HOME = emptyHome;
    process.env.XDG_CONFIG_HOME = emptyHome;
    delete process.env.GIT_CONFIG_GLOBAL;
    delete process.env.GIT_CONFIG_SYSTEM;
    // Containers cannot derive an identity from passwd/hostname the way the
    // macOS host git does; user.useConfigOnly reproduces that exactly — the
    // commit must take its identity from the shadow .gitconfig alone.
    process.env.GIT_CONFIG_COUNT = '1';
    process.env.GIT_CONFIG_KEY_0 = 'user.useConfigOnly';
    process.env.GIT_CONFIG_VALUE_0 = 'true';
    try {
      const service = new GitService(fixture.projectRoot, fixture.storage);
      await expect(service.initialize()).resolves.toBeUndefined();
      const hash = await service.createFileSnapshot('identity snapshot');
      const tree = snapshotTree(fixture.historyDir(), hash);
      expect(tree).toContain('tracked.txt');
    } finally {
      process.env.HOME = savedHome;
      if (savedXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = savedXdg;
      }
      if (savedGlobal === undefined) {
        delete process.env.GIT_CONFIG_GLOBAL;
      } else {
        process.env.GIT_CONFIG_GLOBAL = savedGlobal;
      }
      if (savedSystem === undefined) {
        delete process.env.GIT_CONFIG_SYSTEM;
      } else {
        process.env.GIT_CONFIG_SYSTEM = savedSystem;
      }
      if (savedCount === undefined) {
        delete process.env.GIT_CONFIG_COUNT;
      } else {
        process.env.GIT_CONFIG_COUNT = savedCount;
      }
      if (savedKey0 === undefined) {
        delete process.env.GIT_CONFIG_KEY_0;
      } else {
        process.env.GIT_CONFIG_KEY_0 = savedKey0;
      }
      if (savedValue0 === undefined) {
        delete process.env.GIT_CONFIG_VALUE_0;
      } else {
        process.env.GIT_CONFIG_VALUE_0 = savedValue0;
      }
    }
  });

  describe('inside a container sandbox', () => {
    it('initialize fails fast when the history dir has no persistent checkpoint store marker', async () => {
      process.env.SANDBOX = 'issue3464-sandbox-container';
      const service = new GitService(fixture.projectRoot, fixture.storage);
      await expect(service.initialize()).rejects.toThrow(
        /persistent checkpoint store/i,
      );
    });

    it('initialize succeeds when the persistent checkpoint store marker is present', async () => {
      process.env.SANDBOX = 'issue3464-sandbox-container';
      const historyDir = fixture.historyDir();
      await fs.mkdir(historyDir, { recursive: true });
      await fs.writeFile(
        path.join(historyDir, '.llxprt-checkpoint-store'),
        'llxprt-checkpoint-store v1\n',
      );
      const service = new GitService(fixture.projectRoot, fixture.storage);
      await expect(service.initialize()).resolves.toBeUndefined();
    });

    it('a seatbelt sandbox value does not require the marker', async () => {
      process.env.SANDBOX = 'sandbox-exec';
      const service = new GitService(fixture.projectRoot, fixture.storage);
      await expect(service.initialize()).resolves.toBeUndefined();
    });
  });
});
