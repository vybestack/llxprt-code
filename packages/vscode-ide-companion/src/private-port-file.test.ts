/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ensurePrivateDirectory,
  writePrivateFile,
} from './private-port-file.js';

const posixOnly = process.platform === 'win32' ? it.skip : it;

describe('private port file helpers', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'llxprt-port-file-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  describe('writePrivateFile', () => {
    it('creates the file with the given content', async () => {
      const file = path.join(root, 'port.json');

      await writePrivateFile(file, '{"port":1}');

      expect(await fs.readFile(file, 'utf8')).toBe('{"port":1}');
    });

    posixOnly('creates the file readable only by its owner', async () => {
      const file = path.join(root, 'port.json');

      await writePrivateFile(file, 'secret');

      expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    });

    posixOnly('replaces a previous world-readable file', async () => {
      const file = path.join(root, 'port.json');
      await fs.writeFile(file, 'old', { mode: 0o644 });
      await fs.chmod(file, 0o644);

      await writePrivateFile(file, 'new');

      expect(await fs.readFile(file, 'utf8')).toBe('new');
      expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    });

    posixOnly(
      'does not write through a symlink planted at the target path',
      async () => {
        const victim = path.join(root, 'victim.txt');
        await fs.writeFile(victim, 'untouched');
        const file = path.join(root, 'port.json');
        await fs.symlink(victim, file);

        await writePrivateFile(file, 'secret');

        expect(await fs.readFile(victim, 'utf8')).toBe('untouched');
        expect((await fs.lstat(file)).isSymbolicLink()).toBe(false);
        expect(await fs.readFile(file, 'utf8')).toBe('secret');
      },
    );
  });

  describe('ensurePrivateDirectory', () => {
    it('creates a missing directory', async () => {
      const dir = path.join(root, 'ide');

      await ensurePrivateDirectory(dir);

      expect((await fs.stat(dir)).isDirectory()).toBe(true);
    });

    posixOnly(
      'creates the directory accessible only by its owner',
      async () => {
        const dir = path.join(root, 'ide');

        await ensurePrivateDirectory(dir);

        expect((await fs.stat(dir)).mode & 0o777).toBe(0o700);
      },
    );

    posixOnly(
      'tightens an existing directory that others can read',
      async () => {
        const dir = path.join(root, 'ide');
        await fs.mkdir(dir, { mode: 0o755 });
        await fs.chmod(dir, 0o755);

        await ensurePrivateDirectory(dir);

        expect((await fs.stat(dir)).mode & 0o777).toBe(0o700);
      },
    );

    posixOnly('rejects a symlink in place of the directory', async () => {
      const elsewhere = path.join(root, 'elsewhere');
      await fs.mkdir(elsewhere);
      const dir = path.join(root, 'ide');
      await fs.symlink(elsewhere, dir);

      await expect(ensurePrivateDirectory(dir)).rejects.toThrow(
        /not a directory/i,
      );
    });

    it('rejects a regular file in place of the directory', async () => {
      const dir = path.join(root, 'ide');
      await fs.writeFile(dir, 'not a dir');

      await expect(ensurePrivateDirectory(dir)).rejects.toThrow(
        /not a directory/i,
      );
    });
  });
});
