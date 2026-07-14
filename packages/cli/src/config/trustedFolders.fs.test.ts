/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
      fs.chmodSync(filePath, 0o644);

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
      'Unable to resolve canonical path',
    );
    expect(folders.user.config).toStrictEqual({});
    expect(fs.existsSync(filePath)).toBe(false);
  });
});
