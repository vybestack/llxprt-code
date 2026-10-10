/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { act } from 'react';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  Config,
  WorkspaceFilesystemOwner,
  assembleWorkspaceMemory,
} from '@vybestack/llxprt-code-core';
import {
  renderHook,
  createMockSettings,
} from '../../../../__tests__/render.js';
import { createMockCommandContext } from '../../../../__tests__/mockCommandContext.js';
import { MessageType, type HistoryItem } from '../../../types.js';
import { useMemoryRefreshAction } from './useMemoryRefreshAction.js';

describe('useMemoryRefreshAction', () => {
  let directory: string;
  let home: string | undefined;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'memory-refresh-hook-'));
    await mkdir(join(directory, '.git'));
    await mkdir(join(directory, 'global'));
    home = process.env.LLXPRT_CONFIG_HOME;
    process.env.LLXPRT_CONFIG_HOME = join(directory, 'global');
  });
  afterEach(async () => {
    if (home === undefined) delete process.env.LLXPRT_CONFIG_HOME;
    else process.env.LLXPRT_CONFIG_HOME = home;
    await rm(directory, { recursive: true, force: true });
  });
  it.each([true, false])(
    'reloads real instructions with JIT setting %s and publishes UI character and file counts',
    async (jit) => {
      const filesystem = new WorkspaceFilesystemOwner({
        targetDir: directory,
        isTrusted: () => true,
      });
      const memory = assembleWorkspaceMemory(
        new Config({
          sessionId: 'hook-memory',
          targetDir: directory,
          cwd: directory,
          debugMode: false,
          model: 'fake',
          jitContextEnabled: jit,
          contextFileName: 'LLXPRT.md',
        }),
        filesystem,
        { isTrustedFolder: () => true, getIdeTrust: () => undefined },
      );
      const context = createMockCommandContext();
      if (!context.services.config) throw new Error('Missing UI fixture');
      const runtime = {
        ...context.services.config,
        refreshMemory: async () => {
          const snapshot = await memory.operations.refresh();
          return {
            memoryContent: snapshot.memoryContent,
            fileCount: snapshot.fileCount,
            filePaths: [...snapshot.filePaths],
          };
        },
      };
      const items: Array<Omit<HistoryItem, 'id'>> = [];
      const counts: number[] = [];
      const { result, unmount } = renderHook(() =>
        useMemoryRefreshAction({
          config: runtime,
          settings: createMockSettings({}),
          addItem: (item) => {
            items.push(item);
            return items.length;
          },
          setLlxprtMdFileCount: (count) => {
            counts.push(count);
          },
        }),
      );
      const failures: unknown[] = [];
      try {
        await writeFile(
          join(directory, 'LLXPRT.md'),
          'Keep instruction channels separate.',
        );
        await act(async () => {
          await result.current();
        });
        const snapshot = memory.operations.snapshot();
        expect(snapshot.memoryContent).toContain(
          'Keep instruction channels separate.',
        );
        expect(counts).toStrictEqual([1]);
        expect(items).toContainEqual({
          type: MessageType.INFO,
          text: `Memory refreshed successfully. Loaded ${snapshot.memoryContent.length} characters from 1 file(s).`,
        });
      } catch (error) {
        failures.push(error);
      } finally {
        unmount();
        const memoryResults = await Promise.allSettled([memory.dispose()]);
        const fileResults = await Promise.allSettled([filesystem.dispose()]);
        failures.push(
          ...[...memoryResults, ...fileResults].flatMap((result) =>
            result.status === 'rejected' ? [result.reason] : [],
          ),
        );
      }
      if (failures.length > 0)
        throw new AggregateError(failures, 'Hook instruction cleanup failed');
    },
  );
});
