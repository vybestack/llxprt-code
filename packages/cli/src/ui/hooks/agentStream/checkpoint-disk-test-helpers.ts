/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdir, rename, rm, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { GitService } from '@vybestack/llxprt-code-core';
import { withCleanupHistory } from '../../../utils/cleanup-history-test-helpers.js';
import { createToolCheckpoint } from './checkpointPersistence.js';
import type { FsOps } from './checkpointPersistence.js';
import { checkpointFs } from './checkpoint-disk-writer.js';
import type { HistoryItem } from '../../types.js';

export const checkpointTool = {
  request: {
    callId: 'checkpoint-test',
    name: 'write_file',
    args: { file_path: '/project/escaped-🐈.ts', text: '\n"\\\u0000' },
    prompt_id: 'checkpoint-prompt',
    isClientInitiated: false,
    agentId: 'primary',
  },
};
export const checkpointUiHistory: HistoryItem[] = [
  { id: 1, type: 'user', text: 'UI before save\n🐈' },
];
export const checkpointGit: Pick<
  GitService,
  'createFileSnapshot' | 'getCurrentCommitHash'
> = {
  createFileSnapshot: async () => 'checkpoint-snapshot',
  getCurrentCommitHash: async () => 'fallback-snapshot',
};

export function trackingFs(fault?: 'write' | 'rename' | 'sync' | 'close'): {
  ops: FsOps;
  chunks: () => { count: number; peakBytes: number };
} {
  let count = 0;
  let peakBytes = 0;
  return {
    chunks: () => ({ count, peakBytes }),
    ops: {
      mkdir,
      rename: async (from, to) => {
        if (fault === 'rename') throw new Error('checkpoint rename fault');
        await rename(from, to);
      },
      rm,
      open: async (file, flags, mode) => {
        const handle = await checkpointFs.open(file, flags, mode);
        return {
          writeFile: async (source, options) => {
            await handle.writeFile(
              (async function* () {
                for await (const chunk of source) {
                  count++;
                  peakBytes = Math.max(peakBytes, Buffer.byteLength(chunk));
                  if (fault === 'write' && count > 2)
                    throw new Error('checkpoint write fault');
                  yield chunk;
                }
              })(),
              options,
            );
          },
          sync: async () => {
            if (fault === 'sync') throw new Error('checkpoint sync fault');
            await handle.sync();
          },
          close: async () => {
            await handle.close();
            if (fault === 'close') throw new Error('checkpoint close fault');
          },
        };
      },
    },
  };
}

export async function withCheckpoint<T>(
  size: number,
  active: boolean,
  action: (
    fixture: Parameters<Parameters<typeof withCleanupHistory>[2]>[0],
    dir: string,
  ) => Promise<T>,
  bytes = 2048,
): Promise<T> {
  return withCleanupHistory(
    size,
    active,
    async (fixture) => {
      const dir = join(fixture.root, 'checkpoints');
      await mkdir(dir);
      return action(fixture, dir);
    },
    bytes,
  );
}

export async function savedCheckpoint(
  dir: string,
): Promise<{ path: string; bytes: string }> {
  const files = await readdir(dir);
  if (files.length !== 1 || !files[0].endsWith('.json'))
    throw new Error(
      'Checkpoint was not atomically published: ' + files.join(','),
    );
  const path = join(dir, files[0]);
  return { path, bytes: await readFile(path, 'utf8') };
}

export async function saveCheckpoint(
  fixture: Parameters<Parameters<typeof withCleanupHistory>[2]>[0],
  dir: string,
  ops?: FsOps,
  signal?: AbortSignal,
): Promise<void> {
  await createToolCheckpoint(
    checkpointTool,
    dir,
    checkpointGit,
    fixture.config.getAgentClient(),
    checkpointUiHistory,
    () => {},
    ops,
    signal,
  );
}
