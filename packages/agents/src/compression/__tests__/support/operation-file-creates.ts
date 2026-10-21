/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { spyOn } from 'bun:test';
import * as fs from 'node:fs';
import * as promises from 'node:fs/promises';

export interface OperationFileCreates {
  readonly directories: string[];
  readonly files: string[];
}

function creates(flags: unknown): boolean {
  return typeof flags === 'number'
    ? (flags & fs.constants.O_CREAT) !== 0
    : typeof flags === 'string' && /[wa]/.test(flags);
}

function creationSpies(): {
  directories: ReturnType<typeof directorySpies>;
  writes: ReturnType<typeof writeSpies>;
  openSync: ReturnType<typeof spyOn<typeof fs, 'openSync'>>;
  open: ReturnType<typeof spyOn<typeof promises, 'open'>>;
  callbackOpen: ReturnType<typeof spyOn<typeof fs, 'open'>>;
} {
  return {
    directories: directorySpies(),
    writes: writeSpies(),
    openSync: spyOn(fs, 'openSync'),
    open: spyOn(promises, 'open'),
    callbackOpen: spyOn(fs, 'open'),
  };
}
function directorySpies(): [
  ReturnType<typeof spyOn<typeof fs, 'mkdirSync'>>,
  ReturnType<typeof spyOn<typeof fs, 'mkdtempSync'>>,
  ReturnType<typeof spyOn<typeof promises, 'mkdir'>>,
  ReturnType<typeof spyOn<typeof promises, 'mkdtemp'>>,
  ReturnType<typeof spyOn<typeof fs, 'mkdir'>>,
  ReturnType<typeof spyOn<typeof fs, 'mkdtemp'>>,
] {
  return [
    spyOn(fs, 'mkdirSync'),
    spyOn(fs, 'mkdtempSync'),
    spyOn(promises, 'mkdir'),
    spyOn(promises, 'mkdtemp'),
    spyOn(fs, 'mkdir'),
    spyOn(fs, 'mkdtemp'),
  ];
}
function writeSpies(): [
  ReturnType<typeof spyOn<typeof fs, 'writeFileSync'>>,
  ReturnType<typeof spyOn<typeof promises, 'writeFile'>>,
  ReturnType<typeof spyOn<typeof fs, 'appendFileSync'>>,
  ReturnType<typeof spyOn<typeof promises, 'appendFile'>>,
  ReturnType<typeof spyOn<typeof fs, 'writeFile'>>,
  ReturnType<typeof spyOn<typeof fs, 'appendFile'>>,
] {
  return [
    spyOn(fs, 'writeFileSync'),
    spyOn(promises, 'writeFile'),
    spyOn(fs, 'appendFileSync'),
    spyOn(promises, 'appendFile'),
    spyOn(fs, 'writeFile'),
    spyOn(fs, 'appendFile'),
  ];
}

function denyCreation(
  spies: ReturnType<typeof creationSpies>,
  originals: {
    readonly sync: typeof fs.openSync;
    readonly promise: typeof promises.open;
    readonly callback: typeof fs.open;
  },
): void {
  const denied = (): never => {
    throw new Error('Operation attempted to create a file or directory');
  };
  for (const spy of [...spies.directories, ...spies.writes])
    spy.mockImplementation(denied);
  spies.openSync.mockImplementation((path, flags, mode) => {
    if (creates(flags)) return denied();
    return originals.sync(path, flags, mode);
  });
  spies.open.mockImplementation(async (path, flags, mode) => {
    if (creates(flags)) return denied();
    return originals.promise(path, flags, mode);
  });
  spies.callbackOpen.mockImplementation(
    (...args: Parameters<typeof fs.open>) => {
      if (creates(args[1])) return denied();
      return originals.callback(...args);
    },
  );
}

export async function operationFileCreates(
  action: () => Promise<void>,
  deny = false,
): Promise<OperationFileCreates> {
  const originals = {
    sync: fs.openSync,
    promise: promises.open,
    callback: fs.open,
  };
  const spies = creationSpies();
  try {
    if (deny) denyCreation(spies, originals);
    await action();
    return {
      directories: spies.directories.flatMap((spy) =>
        spy.mock.calls.map(([path]) => String(path)),
      ),
      files: [
        ...spies.openSync.mock.calls.filter(([, flags]) => creates(flags)),
        ...spies.open.mock.calls.filter(([, flags]) => creates(flags)),
        ...spies.callbackOpen.mock.calls.filter(([, flags]) => creates(flags)),
        ...spies.writes.flatMap((spy) =>
          spy.mock.calls.map(([path]) => [path]),
        ),
      ].map(([path]) => String(path)),
    };
  } finally {
    for (const spy of [
      ...spies.directories,
      ...spies.writes,
      spies.openSync,
      spies.open,
      spies.callbackOpen,
    ])
      spy.mockRestore();
  }
}
