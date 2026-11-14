/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import {
  openUnlinkedFile,
  type UnlinkedFileDependencies,
} from './unlinkedFile.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

interface FakeOpen {
  flags: number;
  path: string;
}

/** Records what the helper asks of the file system on a platform this machine is not. */
function recordingDependencies(
  directory: string,
  platform: NodeJS.Platform,
  constants: Readonly<Record<string, number>>,
): {
  dependencies: UnlinkedFileDependencies;
  opens: FakeOpen[];
  unlinks: string[];
} {
  const opens: FakeOpen[] = [];
  const unlinks: string[] = [];
  const dependencies: UnlinkedFileDependencies = {
    platform,
    constants,
    directory,
    open: async (filePath, flags) => {
      opens.push({ path: filePath, flags });
      return fsp.open(
        filePath,
        fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL,
        0o600,
      );
    },
    unlink: async (filePath) => {
      unlinks.push(filePath);
      await fsp.unlink(filePath);
    },
  };
  return { dependencies, opens, unlinks };
}

describe('bare-store unlinked file', () => {
  const tempDir = useTempDir('journal-unlinked-');

  it('opens a read-write file that is already unlinked on POSIX', async () => {
    const handle = await openUnlinkedFile({ directory: tempDir() });
    try {
      const payload = Buffer.from('journal bytes');
      await handle.write(payload, 0, payload.length, 0);
      const back = Buffer.alloc(payload.length);
      await handle.read(back, 0, back.length, 0);

      expect(back.equals(payload)).toBe(true);
      expect(await fsp.readdir(tempDir())).toStrictEqual([]);
    } finally {
      await handle.close();
    }
  });

  it('gives each call its own file', async () => {
    const first = await openUnlinkedFile({ directory: tempDir() });
    const second = await openUnlinkedFile({ directory: tempDir() });
    try {
      await first.write(Buffer.from('a'), 0, 1, 0);

      expect((await second.stat()).size).toBe(0);
    } finally {
      await first.close();
      await second.close();
    }
  });

  it('creates no directory of its own', async () => {
    const handle = await openUnlinkedFile({ directory: tempDir() });
    await handle.close();

    expect(await fsp.readdir(tempDir())).toStrictEqual([]);
  });

  it('on win32 opens with UV_FS_O_TEMPORARY and never unlinks', async () => {
    const TEMPORARY = 0x0040_0000;
    const { dependencies, opens, unlinks } = recordingDependencies(
      tempDir(),
      'win32',
      {
        ...fs.constants,
        UV_FS_O_TEMPORARY: TEMPORARY,
      },
    );

    const handle = await openUnlinkedFile(dependencies);
    await handle.close();
    await fsp.rm(opens[0].path, { force: true });

    expect(opens).toHaveLength(1);
    expect(opens[0].flags & TEMPORARY).toBe(TEMPORARY);
    expect(opens[0].flags & fs.constants.O_EXCL).toBe(fs.constants.O_EXCL);
    expect(opens[0].flags & fs.constants.O_RDWR).toBe(fs.constants.O_RDWR);
    expect(unlinks).toStrictEqual([]);
  });

  it('throws on win32 when UV_FS_O_TEMPORARY is missing, before it touches any file', async () => {
    const withoutTemporary: Record<string, number> = { ...fs.constants };
    delete withoutTemporary.UV_FS_O_TEMPORARY;
    const { dependencies, opens } = recordingDependencies(
      tempDir(),
      'win32',
      withoutTemporary,
    );

    await expect(openUnlinkedFile(dependencies)).rejects.toThrow(
      /UV_FS_O_TEMPORARY/,
    );
    expect(opens).toStrictEqual([]);
  });

  it('does not need the constant on darwin or linux', async () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const { dependencies, opens, unlinks } = recordingDependencies(
        tempDir(),
        platform,
        {
          ...fs.constants,
        },
      );

      const handle = await openUnlinkedFile(dependencies);
      await handle.close();

      expect(opens).toHaveLength(1);
      expect(unlinks).toStrictEqual([opens[0].path]);
    }
  });
});
