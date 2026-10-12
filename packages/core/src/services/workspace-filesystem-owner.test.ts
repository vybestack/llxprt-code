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
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { StandardFileSystemService } from './fileSystemService.js';
import { WorkspaceFilesystemOwner } from './workspace-filesystem-owner.js';

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve = (): void => {
    throw new Error('Deferred is not initialized');
  };
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class PrefixedFilesystem extends StandardFileSystemService {
  override async readTextFile(filePath: string): Promise<string> {
    return (await super.readTextFile(filePath)).toUpperCase();
  }
  override async writeTextFile(
    filePath: string,
    content: string,
  ): Promise<void> {
    await super.writeTextFile(filePath, content.toLowerCase());
  }
}

class FailingHeldFilesystem extends StandardFileSystemService {
  readonly entered = deferred();
  readonly release = deferred();
  constructor(private readonly failure: Error) {
    super();
  }
  override async readTextFile(): Promise<string> {
    this.entered.resolve();
    await this.release.promise;
    throw this.failure;
  }
}

class HeldFilesystem extends StandardFileSystemService {
  readonly entered = deferred();
  readonly release = deferred();
  override async readTextFile(filePath: string): Promise<string> {
    this.entered.resolve();
    await this.release.promise;
    return super.readTextFile(filePath);
  }
}

describe('workspace filesystem authority @issue:2615', () => {
  function useWorkspace(): () => { target: string; outside: string } {
    let directory = '';
    let target = '';
    let outside = '';
    beforeEach(async () => {
      directory = await realpath(
        await mkdtemp(path.join(os.tmpdir(), 'filesystem-owner-2615-')),
      );
      target = path.join(directory, 'target');
      outside = path.join(directory, 'outside');
      await Promise.all([mkdir(target), mkdir(outside)]);
      await writeFile(path.join(outside, 'data.txt'), 'outside content');
    });
    afterEach(async () => {
      await rm(directory, { recursive: true, force: true });
    });
    return () => ({ target, outside });
  }

  const workspace = useWorkspace();

  it('keeps shared skill roots admitted until the last live reference is released', async () => {
    const { target, outside } = workspace();
    const owner = new WorkspaceFilesystemOwner({
      targetDir: target,
      isTrusted: () => true,
    });
    let firstApproved = true;
    const first = owner.admitSkillDirectory(outside, () => firstApproved);
    const second = owner.admitSkillDirectory(outside, () => true);
    firstApproved = false;
    expect(owner.paths.contains(outside)).toBe(true);
    first();
    expect(
      await owner.files.readTextFile(path.join(outside, 'data.txt')),
    ).toContain('outside');
    second();
    expect(owner.paths.contains(outside)).toBe(false);
    await owner.dispose();
  });

  it('preserves default UTF-16 and UTF-8 BOM text decoding', async () => {
    const { target } = workspace();
    const owner = new WorkspaceFilesystemOwner({
      targetDir: target,
      isTrusted: () => true,
    });
    const utf16 = path.join(target, 'utf16.txt');
    const utf8 = path.join(target, 'utf8.txt');
    await writeFile(
      utf16,
      Buffer.concat([
        Buffer.from([255, 254]),
        Buffer.from('alpha\nbeta', 'utf16le'),
      ]),
    );
    await writeFile(
      utf8,
      Buffer.concat([
        Buffer.from([239, 187, 191]),
        Buffer.from('gamma\ndelta'),
      ]),
    );
    expect(await owner.files.readTextFile(utf16)).toBe('alpha\nbeta');
    expect(await owner.files.readTextFile(utf8)).toBe('gamma\ndelta');
    await owner.dispose();
  });

  it('uses the exact borrowed implementation and leaves it usable after closing', async () => {
    const { target } = workspace();
    const service = new PrefixedFilesystem();
    const owner = new WorkspaceFilesystemOwner({
      targetDir: target,
      isTrusted: () => true,
      fileSystem: { service, ownership: 'caller' },
    });
    const file = path.join(target, 'data.txt');
    await owner.files.writeTextFile(file, 'Mixed Case');
    expect(await readFile(file, 'utf8')).toBe('mixed case');
    expect(await owner.files.readTextFile(file)).toBe('MIXED CASE');
    await owner.dispose();
    await service.writeTextFile(file, 'Still Alive');
    expect(await service.readTextFile(file)).toBe('STILL ALIVE');
  });

  it('adds and removes live directory membership without changing declaration inputs', async () => {
    const { target, outside } = workspace();
    const includes: string[] = [];
    const owner = new WorkspaceFilesystemOwner({
      targetDir: target,
      includeDirectories: includes,
      isTrusted: () => true,
    });
    expect(owner.paths.contains(path.join(outside, 'data.txt'))).toBe(false);
    owner.addDirectory(outside);
    expect(
      await owner.files.readTextFile(path.join(outside, 'data.txt')),
    ).toContain('outside');
    owner.setDirectories([target]);
    await expect(
      owner.files.readTextFile(path.join(outside, 'data.txt')),
    ).rejects.toThrow('workspace');
    expect(includes).toHaveLength(0);
    await owner.dispose();
  });

  it('revokes expansion immediately on the next operation and restores it when trusted', async () => {
    const { target, outside } = workspace();
    let trusted = true;
    const owner = new WorkspaceFilesystemOwner({
      targetDir: target,
      includeDirectories: [outside],
      isTrusted: () => trusted,
    });
    const retained = owner.files;
    expect(
      await retained.readTextFile(path.join(outside, 'data.txt')),
    ).toContain('outside');
    trusted = false;
    expect(owner.paths.directories()).toStrictEqual([target]);
    await expect(
      retained.writeTextFile(path.join(outside, 'data.txt'), 'forbidden'),
    ).rejects.toThrow('workspace');
    expect(await readFile(path.join(outside, 'data.txt'), 'utf8')).toBe(
      'outside content',
    );
    trusted = true;
    expect(
      await retained.readTextFile(path.join(outside, 'data.txt')),
    ).toContain('outside');
    await owner.dispose();
  });

  it('does not admit new external roots or resource roots while trust is denied', async () => {
    const { target, outside } = workspace();
    let trusted = false;
    const owner = new WorkspaceFilesystemOwner({
      targetDir: target,
      isTrusted: () => trusted,
    });
    expect(() => owner.addDirectory(outside)).toThrow('trusted');
    expect(() => owner.admitSkillDirectory(outside, () => false)).toThrow(
      'approved',
    );
    trusted = true;
    expect(owner.paths.contains(outside)).toBe(false);
    await owner.dispose();
  });

  it('rejects denied skill admission even in a trusted workspace', async () => {
    const { target, outside } = workspace();
    const owner = new WorkspaceFilesystemOwner({
      targetDir: target,
      isTrusted: () => true,
    });
    expect(() => owner.admitSkillDirectory(outside, () => false)).toThrow(
      'approved',
    );
    expect(owner.paths.contains(outside)).toBe(false);
    owner.admitSkillDirectory(outside, () => true);
    expect(owner.paths.contains(outside)).toBe(true);
    await owner.dispose();
  });

  it('normalizes relative includes and prevents symlink escapes for nonexistent writes', async () => {
    const { target, outside } = workspace();
    await symlink(outside, path.join(target, 'escape'));
    const owner = new WorkspaceFilesystemOwner({
      targetDir: target,
      isTrusted: () => true,
    });
    expect(
      owner.paths.contains(path.join(target, 'escape', 'new', 'file.txt')),
    ).toBe(false);
    await expect(
      owner.files.writeTextFile(
        path.join(target, 'escape', 'data.txt'),
        'overwrite',
      ),
    ).rejects.toThrow('workspace');
    owner.addDirectory('../outside');
    expect(owner.paths.directories()).toContain(outside);
    await owner.dispose();
  });

  it('keeps independently constructed same-label workspaces isolated', async () => {
    const { target, outside } = workspace();
    const first = new WorkspaceFilesystemOwner({
      targetDir: target,
      isTrusted: () => true,
    });
    const second = new WorkspaceFilesystemOwner({
      targetDir: target,
      isTrusted: () => true,
    });
    first.addDirectory(outside);
    await first.dispose();
    expect(second.paths.contains(outside)).toBe(false);
    await second.files.writeTextFile(
      path.join(target, 'sibling.txt'),
      'sibling',
    );
    expect(await readFile(path.join(target, 'sibling.txt'), 'utf8')).toBe(
      'sibling',
    );
    await second.dispose();
  });

  it('joins admitted operations and closes new admission synchronously', async () => {
    const { target } = workspace();
    const file = path.join(target, 'held.txt');
    await writeFile(file, 'accepted');
    const service = new HeldFilesystem();
    const owner = new WorkspaceFilesystemOwner({
      targetDir: target,
      isTrusted: () => true,
      fileSystem: { service, ownership: 'workspace' },
    });
    const pending = owner.files.readTextFile(file);
    await service.entered.promise;
    const closing = owner.dispose();
    let closed = false;
    void closing.then(() => {
      closed = true;
    });
    await expect(owner.files.readTextFile(file)).rejects.toThrow('disposed');
    expect(closed).toBe(false);
    expect(new Set([closing, owner.dispose()]).size).toBe(1);
    service.release.resolve();
    expect(await pending).toBe('accepted');
    await closing;
    expect(closed).toBe(true);
    expect(() => owner.paths.directories()).toThrow('disposed');
  });

  it('replaces the filesystem only after admitted work joins and retained operations use the replacement', async () => {
    const { target } = workspace();
    const file = path.join(target, 'replace.txt');
    await writeFile(file, 'Mixed');
    const service = new HeldFilesystem();
    const owner = new WorkspaceFilesystemOwner({
      targetDir: target,
      isTrusted: () => true,
      fileSystem: { service, ownership: 'caller' },
    });
    const pending = owner.files.readTextFile(file);
    await service.entered.promise;
    const replacementOptions: {
      service: StandardFileSystemService;
      ownership: 'caller';
    } = {
      service: new PrefixedFilesystem(),
      ownership: 'caller',
    };
    const replacement = owner.replaceFileSystem(replacementOptions);
    replacementOptions.service = new StandardFileSystemService();
    await expect(owner.files.readTextFile(file)).rejects.toThrow('replacement');
    service.release.resolve();
    expect(await pending).toBe('Mixed');
    await replacement;
    expect(await owner.files.readTextFile(file)).toBe('MIXED');
    await owner.dispose();
  });

  it('publishes current directories to subscribers and releases them on disposal', async () => {
    const { target, outside } = workspace();
    const owner = new WorkspaceFilesystemOwner({
      targetDir: target,
      isTrusted: () => true,
    });
    let observed: readonly string[] = [];
    const unsubscribe = owner.subscribeDirectories(() => {
      observed = owner.paths.directories();
    });
    owner.addDirectory(outside);
    expect(observed).toContain(outside);
    unsubscribe();
    owner.setDirectories([target]);
    expect(observed).toContain(outside);
    await owner.dispose();
  });
  it('copies adoption metadata while retaining the exact caller service instance', async () => {
    const { target } = workspace();
    const file = path.join(target, 'identity.txt');
    await writeFile(file, 'Mixed');
    const adoption: {
      service: StandardFileSystemService;
      ownership: 'caller';
    } = {
      service: new PrefixedFilesystem(),
      ownership: 'caller',
    };
    const owner = new WorkspaceFilesystemOwner({
      targetDir: target,
      isTrusted: () => true,
      fileSystem: adoption,
    });
    adoption.service = new StandardFileSystemService();
    expect(await owner.files.readTextFile(file)).toBe('MIXED');
    await owner.dispose();
  });

  it('releases an owned implementation once after admitted work completes', async () => {
    const { target } = workspace();
    const file = path.join(target, 'accepted.txt');
    const marker = path.join(target, 'released.txt');
    await writeFile(file, 'accepted');
    const service = new HeldFilesystem();
    const owner = new WorkspaceFilesystemOwner({
      targetDir: target,
      isTrusted: () => true,
      fileSystem: {
        service,
        ownership: 'workspace',
        release: async () => {
          await writeFile(marker, 'released', { flag: 'wx' });
        },
      },
    });
    const accepted = owner.files.readTextFile(file);
    await service.entered.promise;
    const closing = owner.dispose();
    await expect(readFile(marker)).rejects.toThrow('ENOENT');
    service.release.resolve();
    expect(await accepted).toBe('accepted');
    await closing;
    await owner.dispose();
    expect(await readFile(marker, 'utf8')).toBe('released');
  });

  it('reports failed admitted work during disposal even when the release succeeds', async () => {
    const { target } = workspace();
    const file = path.join(target, 'accepted.txt');
    await writeFile(file, 'accepted');
    const failure = new Error('held read failed');
    const service = new FailingHeldFilesystem(failure);
    let released = 0;
    const owner = new WorkspaceFilesystemOwner({
      targetDir: target,
      isTrusted: () => true,
      fileSystem: {
        service,
        ownership: 'workspace',
        release: async () => {
          released += 1;
        },
      },
    });
    const accepted = owner.files.readTextFile(file).catch((e: unknown) => e);
    await service.entered.promise;
    const closing = owner.dispose().then(
      () => undefined,
      (error: unknown) => error,
    );
    service.release.resolve();
    expect(await accepted).toBe(failure);
    const reported = await closing;
    expect(reported).toBeInstanceOf(AggregateError);
    if (!(reported instanceof AggregateError))
      throw new Error('Disposal did not reject');
    expect(reported.errors).toStrictEqual([failure]);
    expect(released).toBe(1);
  });

  it('reports a release failure and still completes disposal', async () => {
    const { target } = workspace();
    const failure = new Error('release failed');
    const owner = new WorkspaceFilesystemOwner({
      targetDir: target,
      isTrusted: () => true,
      fileSystem: {
        service: new StandardFileSystemService(),
        ownership: 'workspace',
        release: async () => {
          throw failure;
        },
      },
    });
    const first = owner.dispose();
    const reported = await first.then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(reported).toBeInstanceOf(AggregateError);
    if (!(reported instanceof AggregateError))
      throw new Error('Disposal did not reject');
    expect(reported.errors).toStrictEqual([failure]);
    expect(owner.dispose()).toBe(first);
  });

  it('withdraws an admitted skill resource as soon as its live policy denies it', async () => {
    const { target, outside } = workspace();
    let approved = true;
    const owner = new WorkspaceFilesystemOwner({
      targetDir: target,
      isTrusted: () => true,
    });
    owner.admitSkillDirectory(outside, () => approved);
    expect(
      await owner.files.readTextFile(path.join(outside, 'data.txt')),
    ).toContain('outside');
    approved = false;
    expect(owner.paths.directories()).not.toContain(outside);
    await expect(
      owner.files.readTextFile(path.join(outside, 'data.txt')),
    ).rejects.toThrow('workspace');
    await owner.dispose();
  });

  it('delivers trust withdrawal to every directory listener before reporting publication failures', async () => {
    const { target, outside } = workspace();
    let trusted = true;
    const owner = new WorkspaceFilesystemOwner({
      targetDir: target,
      includeDirectories: [outside],
      isTrusted: () => trusted,
    });
    let published: readonly string[] = [];
    owner.subscribeDirectories(() => {
      throw new Error('publication failed');
    });
    owner.subscribeDirectories(() => {
      published = owner.paths.directories();
    });
    trusted = false;
    expect(() => owner.notifyTrustChanged()).toThrow('publication');
    expect(published).toStrictEqual([target]);
    await owner.dispose();
  });

  it('copies the directory resolution base instead of retaining caller declaration authority', async () => {
    const { target, outside } = workspace();
    await mkdir(path.join(outside, 'child'));
    const declarations = { targetDir: target, isTrusted: () => true };
    const owner = new WorkspaceFilesystemOwner(declarations);
    declarations.targetDir = outside;
    owner.addDirectory('child');
    expect(owner.paths.contains(path.join(outside, 'child'))).toBe(false);
    await owner.dispose();
  });
});
