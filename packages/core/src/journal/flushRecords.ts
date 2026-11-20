/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as nodeFs from 'node:fs';
import { createRequire } from 'node:module';
import { isBunRuntime } from '../utils/runtime.js';
import { JournalFlushError } from './errors.js';

/** The Apple `fcntl` command that empties the drive's write cache (design 15.1). */
export const F_FULLFSYNC = 51;

/**
 * Which platform call `flushRecords` makes. Bun's own `fdatasync` on macOS does
 * not empty the drive cache, so under Bun on darwin the call goes to `fcntl`.
 * Node's `fs.fdatasync` on Apple platforms is libuv's `F_FULLFSYNC`.
 */
export type FlushMechanism =
  | 'fcntl(F_FULLFSYNC)'
  | 'fs.fdatasyncSync (libuv F_FULLFSYNC)'
  | 'fdatasync'
  | 'FlushFileBuffers';

export function selectFlushMechanism(
  platform: NodeJS.Platform,
  bun: boolean,
): FlushMechanism {
  if (platform === 'darwin') {
    return bun ? 'fcntl(F_FULLFSYNC)' : 'fs.fdatasyncSync (libuv F_FULLFSYNC)';
  }
  // `fs.fdatasync` on Windows is libuv's FlushFileBuffers.
  return platform === 'win32' ? 'FlushFileBuffers' : 'fdatasync';
}

export type Fcntl = (fd: number, command: number, argument: number) => number;

/** Everything `flushRecords` can reach. A weaker call than these is not available to it. */
export interface FlushDependencies {
  readonly platform: NodeJS.Platform;
  readonly bun: boolean;
  readonly fs: { fdatasyncSync(fd: number): void };
  /** Needed when the mechanism is `fcntl(F_FULLFSYNC)`. */
  readonly fcntl: Fcntl | undefined;
}

/** Empties the drive's write cache for the data written through `fd`, or throws. */
export type FlushRecords = (fd: number) => void;

function flushWithFcntl(fcntl: Fcntl): FlushRecords {
  return (fd) => {
    const result = fcntl(fd, F_FULLFSYNC, 0);
    if (result !== 0) {
      throw new JournalFlushError(
        `fcntl(${fd}, F_FULLFSYNC) returned ${result}; no weaker flush is tried`,
      );
    }
  };
}

function flushWithFdatasync(
  hostFs: FlushDependencies['fs'],
  mechanism: FlushMechanism,
): FlushRecords {
  return (fd) => {
    try {
      hostFs.fdatasyncSync(fd);
    } catch (cause) {
      throw new JournalFlushError(
        `${mechanism} failed for descriptor ${fd}; no weaker flush is tried`,
        { cause },
      );
    }
  };
}

export function createFlushRecords(
  dependencies: FlushDependencies,
): FlushRecords {
  const mechanism = selectFlushMechanism(
    dependencies.platform,
    dependencies.bun,
  );
  if (mechanism !== 'fcntl(F_FULLFSYNC)') {
    return flushWithFdatasync(dependencies.fs, mechanism);
  }
  if (dependencies.fcntl === undefined) {
    throw new JournalFlushError(
      'Flushing on darwin under Bun needs the fcntl binding; none was supplied',
    );
  }
  return flushWithFcntl(dependencies.fcntl);
}

const LIBC_BY_PLATFORM: Readonly<Partial<Record<NodeJS.Platform, string>>> = {
  darwin: 'libc.dylib',
  linux: 'libc.so.6',
};

interface BunFcntlLibrary {
  readonly symbols: { readonly fcntl: Fcntl };
}

interface BunFcntlFfi {
  dlopen(
    path: string,
    symbols: {
      readonly fcntl: {
        readonly args: readonly ['i32', 'i32', 'i32'];
        readonly returns: 'i32';
      };
    },
  ): BunFcntlLibrary;
}

const BUN_FFI_MODULE = 'bun:ffi';

/** The real libc `fcntl` through `bun:ffi`. Only meaningful under Bun on a POSIX host. */
export async function loadBunFcntl(
  platform: NodeJS.Platform = process.platform,
): Promise<Fcntl> {
  const library = LIBC_BY_PLATFORM[platform];
  if (library === undefined) {
    throw new JournalFlushError(`No libc is known for platform ${platform}`);
  }
  const ffi: BunFcntlFfi = await import(BUN_FFI_MODULE);
  const { symbols } = ffi.dlopen(library, {
    fcntl: { args: ['i32', 'i32', 'i32'], returns: 'i32' },
  });
  // The library stays open for the life of the process; the symbol is called on every flush.
  return (fd, command, argument) => symbols.fcntl(fd, command, argument);
}

export interface LoadFlushOptions {
  readonly platform?: NodeJS.Platform;
  readonly bun?: boolean;
  readonly fs?: FlushDependencies['fs'];
  readonly loadFcntl?: () => Promise<Fcntl>;
}

/** The flush of this process: its platform, its runtime and its `fs`, unless a seam is replaced. */
export async function loadFlushRecords(
  options: LoadFlushOptions = {},
): Promise<FlushRecords> {
  const platform = options.platform ?? process.platform;
  const bun = options.bun ?? isBunRuntime();
  const needsFcntl =
    selectFlushMechanism(platform, bun) === 'fcntl(F_FULLFSYNC)';
  const load = options.loadFcntl ?? (() => loadBunFcntl(platform));
  return createFlushRecords({
    platform,
    bun,
    fs: options.fs ?? nodeFs,
    fcntl: needsFcntl ? await load() : undefined,
  });
}

export function loadSynchronousFlushRecords(): FlushRecords {
  const platform = process.platform;
  const bun = isBunRuntime();
  let fcntl: Fcntl | undefined;
  if (selectFlushMechanism(platform, bun) === 'fcntl(F_FULLFSYNC)') {
    const library = LIBC_BY_PLATFORM[platform];
    if (library === undefined)
      throw new JournalFlushError(`No libc is known for platform ${platform}`);
    const ffi: BunFcntlFfi = createRequire(import.meta.url)(BUN_FFI_MODULE);
    const { symbols } = ffi.dlopen(library, {
      fcntl: { args: ['i32', 'i32', 'i32'], returns: 'i32' },
    });
    fcntl = (fd, command, argument) => symbols.fcntl(fd, command, argument);
  }
  return createFlushRecords({ platform, bun, fs: nodeFs, fcntl });
}
