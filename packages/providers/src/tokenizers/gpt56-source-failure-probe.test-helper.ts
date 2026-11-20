/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { mock } from 'bun:test';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  readFileSync: realReadFile,
  openSync: realOpen,
  closeSync: realClose,
  readSync: realRead,
} = fs;
const mode = process.argv[2];
const openFiles = new Map<number, string>();
let openedReaders = 0;
const fault = new Error(`filesystem-${mode}`);
if (mode === 'codec-init-missing' || mode === 'codec-init-corrupt') {
  const native = await import('@dqbd/tiktoken');
  await mock.module('@dqbd/tiktoken', () => ({
    ...native,
    get_encoding(): never {
      if (mode === 'codec-init-corrupt')
        new WebAssembly.Module(Buffer.from('invalid wasm'));
      throw fault;
    },
  }));
}

function readFile(
  path: fs.PathOrFileDescriptor,
  options?: Parameters<typeof fs.readFileSync>[1],
): string | Buffer {
  if (typeof path === 'string' && path.endsWith('/encoders/o200k_base.json')) {
    if (mode === 'ranks-missing') throw fault;
    if (mode === 'ranks-corrupt') return Buffer.from('{}');
  }
  return realReadFile(path, options);
}

await mock.module('node:fs', () => ({
  ...fs,
  readFileSync: readFile,
  openSync(path: fs.PathLike, flags: string | number): number {
    const fd = realOpen(path, flags);
    openFiles.set(fd, String(path));
    openedReaders++;
    return fd;
  },
  closeSync(fd: number): void {
    realClose(fd);
    openFiles.delete(fd);
  },
  readSync(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null,
  ): number {
    if (
      mode === 'reader-io' &&
      openFiles.get(fd)?.includes('/o200k-piece-') === true
    )
      throw fault;
    return realRead(fd, buffer, offset, length, position);
  },
}));

const root = fs.mkdtempSync(join(tmpdir(), 'source-fault-'));
const directory = join(root, 'owned');
const workspaceDirectory = join(root, 'workspace');
fs.mkdirSync(directory);
fs.mkdirSync(workspaceDirectory);
const path = join(directory, 'input');
// reader-io needs a piece beyond the in-memory heap BPE bound so the source
// reaches the workspace disk counter whose reader the fault interrupts.
fs.writeFileSync(
  path,
  mode === 'reader-io' ? 'a'.repeat(300000) : 'secret-private-prompt',
);
if (mode === 'cancel-reader') {
  fs.writeFileSync(path, '');
  for (let index = 0; index < 512; index++)
    fs.appendFileSync(path, 'a'.repeat(65536));
}
const controller = new AbortController();
let timer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
try {
  const { Gpt56SourceProjection } = await import(
    './gpt56-source-projection.js'
  );
  const owner = new Gpt56SourceProjection({
    protocol: 'openai-responses',
    directory,
    segments: [{ promptKey: 'input', source: { path } }],
  });
  try {
    const { estimateGpt56PromptFromSources } = await import(
      './gpt56-source-prompt-estimator.js'
    );
    if (mode === 'cancel-reader')
      timer = setTimeout(() => controller.abort(fault), 1500);
    const pending = estimateGpt56PromptFromSources(
      {
        activeProvider: 'codex-alias',
        canonicalModel: 'gpt-5.6-sol',
        protocol: 'openai-responses',
        wireMethod: 'responses/v1',
        finalizedProjection: owner,
        projectionRevision: 4,
        legacyEstimate: () => Promise.reject(new Error('legacy forbidden')),
      },
      { workspaceDirectory, signal: controller.signal },
    );
    const disposal = owner.dispose();
    const error: unknown = await pending.then(
      () => {
        throw new Error('Expected filesystem failure');
      },
      (cause: unknown) => cause,
    );
    await disposal;
    disposed = true;
    fs.writeFileSync(
      process.argv[3],
      JSON.stringify({
        error,
        message: error instanceof Error ? error.message : String(error),
        disposed: !fs.existsSync(path),
        workspace: fs.readdirSync(workspaceDirectory),
        openFiles: [...openFiles.values()],
        openedReaders,
        aborted: controller.signal.aborted,
      }),
    );
  } finally {
    if (!disposed) await owner.dispose();
  }
} catch (error) {
  fs.writeFileSync(
    process.argv[3],
    JSON.stringify({
      importFailed: true,
      error,
      message: error instanceof Error ? error.message : String(error),
      disposed: !fs.existsSync(path),
      workspace: fs.readdirSync(workspaceDirectory),
      openFiles: [...openFiles.values()],
    }),
  );
} finally {
  clearTimeout(timer);
  fs.rmSync(root, { recursive: true, force: true });
}
