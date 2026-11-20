/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { isBunRuntime } from '../utils/runtime.js';
import { JournalFlushError } from './errors.js';
import {
  F_FULLFSYNC,
  createFlushRecords,
  loadBunFcntl,
  loadFlushRecords,
  selectFlushMechanism,
  type FlushDependencies,
  type FlushMechanism,
} from './flushRecords.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

function failureOf(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

interface RecordedCall {
  readonly call: string;
  readonly args: readonly number[];
}

interface Recorder {
  readonly calls: RecordedCall[];
  readonly dependencies: (
    platform: NodeJS.Platform,
    bun: boolean,
  ) => FlushDependencies;
}

/**
 * Fakes for the two seams `flushRecords` may call. Every entry the host could
 * reach, weaker calls included, is recorded, so a fallback shows up in the list.
 */
function recorder(failures: {
  fdatasync?: Error;
  fcntlResult?: number;
}): Recorder {
  const calls: RecordedCall[] = [];
  const hostFs = {
    fdatasyncSync(fd: number): void {
      calls.push({ call: 'fdatasyncSync', args: [fd] });
      if (failures.fdatasync !== undefined) throw failures.fdatasync;
    },
    fsyncSync(fd: number): void {
      calls.push({ call: 'fsyncSync', args: [fd] });
    },
  };
  const fcntl = (fd: number, command: number, argument: number): number => {
    calls.push({ call: 'fcntl', args: [fd, command, argument] });
    return failures.fcntlResult ?? 0;
  };
  return {
    calls,
    dependencies: (platform, bun) => ({
      platform,
      bun,
      fs: hostFs,
      fcntl,
    }),
  };
}

describe('which call empties the drive cache', () => {
  const cases: ReadonlyArray<
    readonly [NodeJS.Platform, boolean, FlushMechanism]
  > = [
    ['darwin', true, 'fcntl(F_FULLFSYNC)'],
    ['darwin', false, 'fs.fdatasyncSync (libuv F_FULLFSYNC)'],
    ['linux', true, 'fdatasync'],
    ['linux', false, 'fdatasync'],
    ['win32', true, 'FlushFileBuffers'],
    ['win32', false, 'FlushFileBuffers'],
  ];

  for (const [platform, bun, expected] of cases) {
    it(`uses ${expected} on ${platform} under ${bun ? 'Bun' : 'Node'}`, () => {
      expect(selectFlushMechanism(platform, bun)).toBe(expected);
    });
  }

  it('defines F_FULLFSYNC as the Apple fcntl command 51', () => {
    expect(F_FULLFSYNC).toBe(51);
  });
});

describe('flushRecords on darwin under Bun', () => {
  it('calls fcntl with F_FULLFSYNC and nothing else', () => {
    const { calls, dependencies } = recorder({});
    const flush = createFlushRecords(dependencies('darwin', true));

    flush(17);

    expect(calls).toStrictEqual([{ call: 'fcntl', args: [17, 51, 0] }]);
  });

  it('throws when fcntl reports failure and calls no weaker flush afterwards', () => {
    const { calls, dependencies } = recorder({ fcntlResult: -1 });
    const flush = createFlushRecords(dependencies('darwin', true));

    expect(() => flush(17)).toThrow(JournalFlushError);
    expect(calls).toStrictEqual([{ call: 'fcntl', args: [17, 51, 0] }]);
  });

  it('refuses to be built without the fcntl binding', () => {
    const { dependencies } = recorder({});

    expect(() =>
      createFlushRecords({ ...dependencies('darwin', true), fcntl: undefined }),
    ).toThrow(JournalFlushError);
  });
});

describe('flushRecords on darwin under Node', () => {
  it('uses fs.fdatasyncSync, which libuv implements with F_FULLFSYNC', () => {
    const { calls, dependencies } = recorder({});
    const flush = createFlushRecords(dependencies('darwin', false));

    flush(9);

    expect(calls).toStrictEqual([{ call: 'fdatasyncSync', args: [9] }]);
  });

  it('throws on error and does not retry with plain fsync or fcntl', () => {
    const { calls, dependencies } = recorder({
      fdatasync: new Error('EIO: i/o error'),
    });
    const flush = createFlushRecords(dependencies('darwin', false));

    const caught = failureOf(() => flush(9));

    expect(caught).toBeInstanceOf(JournalFlushError);
    expect(caught instanceof Error && caught.cause).toBeInstanceOf(Error);
    expect(calls).toStrictEqual([{ call: 'fdatasyncSync', args: [9] }]);
  });
});

describe('flushRecords on Linux and Windows', () => {
  const targets: ReadonlyArray<readonly [NodeJS.Platform, boolean]> = [
    ['linux', true],
    ['linux', false],
    ['win32', true],
    ['win32', false],
  ];

  for (const [platform, bun] of targets) {
    it(`calls fdatasyncSync once on ${platform} under ${bun ? 'Bun' : 'Node'}`, () => {
      const { calls, dependencies } = recorder({});

      createFlushRecords(dependencies(platform, bun))(4);

      expect(calls).toStrictEqual([{ call: 'fdatasyncSync', args: [4] }]);
    });

    it(`throws without trying fsync on ${platform} under ${bun ? 'Bun' : 'Node'}`, () => {
      const { calls, dependencies } = recorder({
        fdatasync: new Error('EIO'),
      });

      expect(() => createFlushRecords(dependencies(platform, bun))(4)).toThrow(
        JournalFlushError,
      );
      expect(calls.map((entry) => entry.call)).toStrictEqual(['fdatasyncSync']);
    });
  }
});

describe('the real flushRecords of this machine', () => {
  const tempDir = useTempDir('journal-flush-');

  it('flushes a descriptor with written data without error', async () => {
    const flush = await loadFlushRecords();
    const handle = await fsp.open(path.join(tempDir(), 'data'), 'w+');
    try {
      await handle.write(Buffer.from('records'), 0, 7, 0);

      expect(() => flush(handle.fd)).not.toThrow();
    } finally {
      await handle.close();
    }
  });

  it('throws for a descriptor that is not open', async () => {
    const flush = await loadFlushRecords();
    const descriptor = fs.openSync(path.join(tempDir(), 'closed'), 'w+');
    fs.closeSync(descriptor);

    expect(() => flush(descriptor)).toThrow(JournalFlushError);
  });

  it('reaches the real fcntl symbol with F_FULLFSYNC where the host needs it, and no other command', async () => {
    const needsFcntl =
      selectFlushMechanism(process.platform, isBunRuntime()) ===
      'fcntl(F_FULLFSYNC)';
    const commands: number[] = [];
    const flush = await loadFlushRecords({
      loadFcntl: async () => {
        const realFcntl = await loadBunFcntl();
        return (fd, command, argument) => {
          commands.push(command);
          return realFcntl(fd, command, argument);
        };
      },
    });
    const handle = await fsp.open(path.join(tempDir(), 'real'), 'w+');
    try {
      await handle.write(Buffer.from('x'), 0, 1, 0);
      flush(handle.fd);

      expect(commands).toStrictEqual(needsFcntl ? [F_FULLFSYNC] : []);
    } finally {
      await handle.close();
    }
  });
});
