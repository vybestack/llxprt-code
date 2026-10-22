/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  mkdtemp,
  open,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleIsPathEntry, lstatPathEntry } from './fileIdentity.js';

describe('file identity admission', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'llxprt-file-identity-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('reports a missing path as absent', async () => {
    expect(await lstatPathEntry(join(directory, 'missing'))).toBeUndefined();
  });

  it('reports a dangling symlink as an existing link entry', async () => {
    const link = join(directory, 'dangling');
    await symlink(join(directory, 'nonexistent-target'), link);

    const entry = await lstatPathEntry(link);

    expect(entry?.isSymbolicLink()).toBe(true);
  });

  it('accepts a handle opened on the regular file at the path', async () => {
    const file = join(directory, 'regular');
    await writeFile(file, 'data');
    const handle = await open(file, 'r');
    try {
      expect(await handleIsPathEntry(handle, file)).toBe(true);
    } finally {
      await handle.close();
    }
  });

  it('rejects a handle opened through a symlink at the path', async () => {
    const target = join(directory, 'target');
    const link = join(directory, 'link');
    await writeFile(target, 'data');
    await symlink(target, link);
    const handle = await open(link, 'r');
    try {
      expect(await handleIsPathEntry(handle, link)).toBe(false);
    } finally {
      await handle.close();
    }
  });

  it('rejects a handle whose file was replaced at the path after opening', async () => {
    const file = join(directory, 'swapped');
    const replacement = join(directory, 'replacement');
    await writeFile(file, 'original');
    await writeFile(replacement, 'replacement');
    const handle = await open(file, 'r');
    try {
      await rename(file, join(directory, 'original-moved'));
      await rename(replacement, file);

      expect(await handleIsPathEntry(handle, file)).toBe(false);
    } finally {
      await handle.close();
    }
  });
});
