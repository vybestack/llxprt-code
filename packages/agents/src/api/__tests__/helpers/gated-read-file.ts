/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spyOn } from 'bun:test';
import fs from 'node:fs/promises';
import type { ObjectEncodingOptions, OpenMode } from 'node:fs';

type ReadPath = Parameters<typeof fs.readFile>[0];
type ReadOptions = Parameters<typeof fs.readFile>[1];

export interface GatedRead {
  /** Resolves once a read of a matching path is in flight at fs.readFile. */
  readonly entered: Promise<void>;
  /** Lets every held read proceed to the real file system. */
  release(): void;
  /** Releases held reads and removes the spy. */
  restore(): void;
}

/**
 * Holds reads of matching paths at the fs.readFile boundary until released,
 * then performs the real read. A held read is genuinely in flight, on every
 * platform, without depending on POSIX-only blocking files such as FIFOs.
 */
export function gateReadFile(matches: (path: ReadPath) => boolean): GatedRead {
  let release!: () => void;
  let enter!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const read = fs.readFile;

  function gatedRead(
    path: ReadPath,
    options?: { encoding?: null; flag?: OpenMode; signal?: AbortSignal } | null,
  ): Promise<Buffer<ArrayBuffer>>;
  function gatedRead(
    path: ReadPath,
    options:
      | BufferEncoding
      | { encoding: BufferEncoding; flag?: OpenMode; signal?: AbortSignal },
  ): Promise<string>;
  function gatedRead(
    path: ReadPath,
    options?:
      | BufferEncoding
      | (ObjectEncodingOptions & { flag?: OpenMode; signal?: AbortSignal })
      | null,
  ): Promise<string | Buffer<ArrayBuffer>>;
  async function gatedRead(
    path: ReadPath,
    options?: ReadOptions,
  ): Promise<string | Buffer<ArrayBuffer>> {
    if (matches(path)) {
      enter();
      await gate;
    }
    return read(path, options);
  }

  const spy = spyOn(fs, 'readFile').mockImplementation(gatedRead);
  return {
    entered,
    release,
    restore: () => {
      release();
      spy.mockRestore();
    },
  };
}
