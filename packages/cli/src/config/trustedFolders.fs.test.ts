/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  LoadedTrustedFolders,
  saveTrustedFolders,
  TrustLevel,
} from './trustedFolders.js';

const temporaryDirectories: string[] = [];

describe('saveTrustedFolders filesystem permissions', () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')(
    'repairs an existing permissive file to mode 0600',
    () => {
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'llxprt-trusted-folders-'),
      );
      temporaryDirectories.push(directory);
      const filePath = path.join(directory, 'trustedFolders.json');
      fs.writeFileSync(filePath, '{}', { mode: 0o644 });

      saveTrustedFolders({
        path: filePath,
        config: { '/workspace': TrustLevel.TRUST_FOLDER },
      });

      expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
      expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toStrictEqual({
        '/workspace': TrustLevel.TRUST_FOLDER,
      });
    },
  );

  it.skipIf(process.platform === 'win32')(
    'persists and resolves a workspace symlink under its canonical identity',
    () => {
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'llxprt-trusted-folders-'),
      );
      temporaryDirectories.push(directory);
      const target = path.join(directory, 'target');
      const workspaceLink = path.join(directory, 'workspace-link');
      const filePath = path.join(directory, 'trustedFolders.json');
      fs.mkdirSync(target);
      fs.symlinkSync(target, workspaceLink, 'dir');
      const canonicalTarget = fs.realpathSync(target);
      const folders = new LoadedTrustedFolders(
        { path: filePath, config: {} },
        [],
      );

      folders.setValue(workspaceLink, TrustLevel.TRUST_FOLDER);

      expect(folders.user.config).toStrictEqual({
        [canonicalTarget]: TrustLevel.TRUST_FOLDER,
      });
      expect(folders.isPathTrusted(workspaceLink)).toBe(true);
      expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toStrictEqual({
        [canonicalTarget]: TrustLevel.TRUST_FOLDER,
      });
    },
  );

  it.skipIf(process.platform === 'win32')(
    'does not inherit TRUST_PARENT through a symlink that escapes the canonical parent',
    () => {
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'llxprt-trusted-folders-'),
      );
      temporaryDirectories.push(directory);
      const trustedParent = path.join(directory, 'trusted-parent');
      const trustSource = path.join(trustedParent, 'source');
      const outside = path.join(directory, 'outside');
      const escape = path.join(trustedParent, 'escape');
      fs.mkdirSync(trustSource, { recursive: true });
      fs.mkdirSync(outside);
      fs.symlinkSync(outside, escape, 'dir');
      const folders = new LoadedTrustedFolders(
        {
          path: path.join(directory, 'trustedFolders.json'),
          config: { [trustSource]: TrustLevel.TRUST_PARENT },
        },
        [],
      );

      expect(folders.isPathTrusted(escape)).toBeUndefined();
    },
  );

  it.skipIf(process.platform === 'win32')(
    'replaces duplicate textual aliases and their denial with the explicit selection',
    () => {
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'llxprt-trusted-folders-'),
      );
      temporaryDirectories.push(directory);
      const target = path.join(directory, 'target');
      const alias = path.join(directory, 'alias');
      const filePath = path.join(directory, 'trustedFolders.json');
      fs.mkdirSync(target);
      fs.symlinkSync(target, alias, 'dir');
      const canonicalTarget = fs.realpathSync(target);
      const folders = new LoadedTrustedFolders(
        {
          path: filePath,
          config: {
            [alias]: TrustLevel.TRUST_FOLDER,
            [target]: TrustLevel.DO_NOT_TRUST,
          },
        },
        [],
      );

      folders.setValue(alias, TrustLevel.TRUST_FOLDER);

      expect(folders.user.config).toStrictEqual({
        [canonicalTarget]: TrustLevel.TRUST_FOLDER,
      });
    },
  );

  it.skipIf(process.platform === 'win32')(
    'snapshots and restores every exact textual alias after an explicit update',
    () => {
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'llxprt-trusted-folders-'),
      );
      temporaryDirectories.push(directory);
      const target = path.join(directory, 'target');
      const alias = path.join(directory, 'alias');
      const filePath = path.join(directory, 'trustedFolders.json');
      fs.mkdirSync(target);
      fs.symlinkSync(target, alias, 'dir');
      const originalConfig = {
        [alias]: TrustLevel.TRUST_FOLDER,
        [target]: TrustLevel.DO_NOT_TRUST,
      };
      const folders = new LoadedTrustedFolders(
        { path: filePath, config: { ...originalConfig } },
        [],
      );
      const snapshot = folders.snapshotValue(alias);

      folders.setValue(alias, TrustLevel.TRUST_PARENT);
      folders.restoreSnapshot(snapshot);

      expect(folders.user.config).toStrictEqual(originalConfig);
      expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toStrictEqual(
        originalConfig,
      );
    },
  );

  it.skipIf(process.platform === 'win32')(
    'deletes every textual alias for the same canonical identity',
    () => {
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'llxprt-trusted-folders-'),
      );
      temporaryDirectories.push(directory);
      const target = path.join(directory, 'target');
      const alias = path.join(directory, 'alias');
      const filePath = path.join(directory, 'trustedFolders.json');
      fs.mkdirSync(target);
      fs.symlinkSync(target, alias, 'dir');
      const folders = new LoadedTrustedFolders(
        {
          path: filePath,
          config: {
            [alias]: TrustLevel.TRUST_FOLDER,
            [target]: TrustLevel.TRUST_FOLDER,
          },
        },
        [],
      );

      folders.deleteValue(alias);

      expect(folders.user.config).toStrictEqual({});
    },
  );

  it('fails closed when a trust lookup cannot resolve canonical identity', () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'llxprt-trusted-folders-'),
    );
    temporaryDirectories.push(directory);
    const missing = path.join(directory, 'missing');
    const folders = new LoadedTrustedFolders(
      {
        path: path.join(directory, 'trustedFolders.json'),
        config: { [directory]: TrustLevel.TRUST_FOLDER },
      },
      [],
    );

    expect(folders.isPathTrusted(missing)).toBeUndefined();
  });

  it('does not mutate or write when canonical identity cannot be saved', () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'llxprt-trusted-folders-'),
    );
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'trustedFolders.json');
    const missing = path.join(directory, 'missing');
    const folders = new LoadedTrustedFolders(
      { path: filePath, config: {} },
      [],
    );

    expect(() => folders.setValue(missing, TrustLevel.TRUST_FOLDER)).toThrow(
      Error,
    );
    expect(folders.user.config).toStrictEqual({});
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('preserves the published config object when persistence rollback is required', () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'llxprt-trusted-folders-'),
    );
    temporaryDirectories.push(directory);
    const blockedParent = path.join(directory, 'blocked-parent');
    fs.writeFileSync(blockedParent, 'not a directory');
    const filePath = path.join(blockedParent, 'trustedFolders.json');
    const workspace = path.join(directory, 'workspace');
    fs.mkdirSync(workspace);
    const config = { [workspace]: TrustLevel.DO_NOT_TRUST };
    const folders = new LoadedTrustedFolders({ path: filePath, config }, []);

    expect(() => folders.setValue(workspace, TrustLevel.TRUST_FOLDER)).toThrow(
      Error,
    );

    expect(folders.user.config).toBe(config);
    expect(config).toStrictEqual({ [workspace]: TrustLevel.DO_NOT_TRUST });
  });
});

/**
 * Real-filesystem coverage for literal-key rule removal. `deleteValue`
 * canonicalizes through realpath first, so it can never remove a rule whose
 * folder has since been deleted; these tests pin the stale-rule case.
 */
describe('LoadedTrustedFolders.removeRule', () => {
  let tempDir: string;
  let trustedFoldersPath: string;
  let userConfig: Record<string, TrustLevel>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-trust-delete-'));
    trustedFoldersPath = path.join(tempDir, 'trustedFolders.json');
    userConfig = {};
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const load = (): LoadedTrustedFolders =>
    new LoadedTrustedFolders(
      { path: trustedFoldersPath, config: userConfig },
      [],
    );

  const readPersisted = (): Record<string, string> =>
    JSON.parse(fs.readFileSync(trustedFoldersPath, 'utf8')) as Record<
      string,
      string
    >;

  it('removes an existing rule and persists the removal', () => {
    const folder = path.join(tempDir, 'real-folder');
    fs.mkdirSync(folder);
    userConfig[folder] = TrustLevel.TRUST_FOLDER;

    load().removeRule(folder);

    expect(userConfig[folder]).toBeUndefined();
    expect(readPersisted()[folder]).toBeUndefined();
  });

  it('removes a stale rule whose folder no longer exists on disk', () => {
    const staleFolder = path.join(tempDir, 'deleted-folder');
    userConfig[staleFolder] = TrustLevel.TRUST_FOLDER;

    load().removeRule(staleFolder);

    expect(userConfig[staleFolder]).toBeUndefined();
    expect(readPersisted()[staleFolder]).toBeUndefined();
  });

  it('leaves unrelated rules intact', () => {
    const kept = path.join(tempDir, 'kept');
    const removed = path.join(tempDir, 'removed');
    fs.mkdirSync(kept);
    userConfig[kept] = TrustLevel.TRUST_FOLDER;
    userConfig[removed] = TrustLevel.DO_NOT_TRUST;

    load().removeRule(removed);

    expect(userConfig).toStrictEqual({ [kept]: TrustLevel.TRUST_FOLDER });
    expect(readPersisted()).toStrictEqual({ [kept]: TrustLevel.TRUST_FOLDER });
  });

  // Skipped on Windows with the rest of this file's filesystem-semantics tests:
  // renaming onto an existing directory fails with a different, version-dependent
  // error there, so the failure this test depends on is not reproducible.
  it.skipIf(process.platform === 'win32')(
    'restores the in-memory rule when persistence fails',
    () => {
      const removed = path.join(tempDir, 'removed');
      userConfig[removed] = TrustLevel.TRUST_FOLDER;
      // A directory at the destination makes the atomic rename commit fail.
      fs.mkdirSync(trustedFoldersPath, { recursive: true });

      expect(() => load().removeRule(removed)).toThrow(Error);

      expect(userConfig[removed]).toBe(TrustLevel.TRUST_FOLDER);
    },
  );

  it('removes a stale rule whose stored key is not lexically normalized', () => {
    // A hand-edited trustedFolders.json can hold a key like /a/b/../c. Once the
    // folder is gone realpath cannot resolve either side, so the fallback has
    // to compare the paths lexically or the rule becomes unremovable.
    const staleFolder = path.join(tempDir, 'gone');
    // Built by concatenation: path.join would collapse the dot-dot segment and
    // the key would already be normalized, which is not the case under test.
    const unnormalizedKey = [tempDir, 'sibling', '..', 'gone'].join(path.sep);
    userConfig[unnormalizedKey] = TrustLevel.TRUST_FOLDER;

    load().removeRule(staleFolder);

    expect(userConfig[unnormalizedKey]).toBeUndefined();
    expect(readPersisted()[unnormalizedKey]).toBeUndefined();
  });

  it('does not write anything when the key is absent', () => {
    const existing = path.join(tempDir, 'existing');
    userConfig[existing] = TrustLevel.TRUST_FOLDER;

    load().removeRule(path.join(tempDir, 'never-existed'));

    expect(userConfig).toStrictEqual({ [existing]: TrustLevel.TRUST_FOLDER });
    expect(fs.existsSync(trustedFoldersPath)).toBe(false);
  });
});

describe('LoadedTrustedFolders rule removal via a symlinked spelling', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')(
    'removes the canonical rule when asked with a symlinked path spelling',
    () => {
      const directory = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-trust-alias-')),
      );
      temporaryDirectories.push(directory);
      const target = path.join(directory, 'target');
      const link = path.join(directory, 'link');
      fs.mkdirSync(target);
      fs.symlinkSync(target, link, 'dir');
      const filePath = path.join(directory, 'trustedFolders.json');
      const folders = new LoadedTrustedFolders(
        { path: filePath, config: {} },
        [],
      );
      folders.setValue(target, TrustLevel.TRUST_FOLDER);
      expect(folders.user.config[fs.realpathSync(target)]).toBe(
        TrustLevel.TRUST_FOLDER,
      );

      // The dialog resolves but does not realpath the active target path, so a
      // symlinked spelling must still remove the canonically-stored rule.
      folders.removeRule(link);

      expect(folders.user.config).toStrictEqual({});
      expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toStrictEqual({});
    },
  );
});
