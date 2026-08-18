/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Real built-in tool integration tests for same-path mutation ordering in
 * CoreToolScheduler batches (issue #3239).
 *
 * The real replace, write_file, insert_at_line, delete_line_range,
 * apply_patch, and ast_edit tools perform whole-file read-modify-write
 * operations, so two concurrent calls on one file can both read the same
 * snapshot and overwrite each other. These tests prove two same-path
 * mutations requested together both persist with complete file content, that
 * ordering is path-based rather than tool-name-based, and that save_memory
 * additions to one memory file keep every fact while different memory files
 * stay parallel.
 */

import { describe, it, expect } from 'bun:test';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { CoreToolScheduler, type ToolCall } from './coreToolScheduler.js';
import {
  EditTool,
  WriteFileTool,
  InsertAtLineTool,
  DeleteLineRangeTool,
  ApplyPatchTool,
  ASTEditTool,
  MemoryTool,
} from '@vybestack/llxprt-code-tools';
import type { IStorageService } from '@vybestack/llxprt-code-tools';
import {
  deferred,
  nextMacrotask,
  useTempWorkspace,
  createToolHost,
  toolRequest,
  buildRegistry,
  buildScheduler,
  trackPublicationOrder,
} from '../test-utils/coreToolScheduler-same-path-mutations-helpers.js';

describe('CoreToolScheduler real file tools same-path ordering', () => {
  const workspaceFor = useTempWorkspace();

  function realToolScheduler(
    observers: {
      onToolCallsUpdate?: (calls: ToolCall[]) => void;
    } = {},
  ): CoreToolScheduler {
    const host = createToolHost(workspaceFor());
    const registry = buildRegistry([
      new EditTool(host),
      new WriteFileTool(host),
      new InsertAtLineTool(host),
      new DeleteLineRangeTool(host),
      new ApplyPatchTool(host),
      new ASTEditTool(host),
    ]);
    return buildScheduler(registry, observers);
  }

  it('preserves both replace edits to one file', async () => {
    const filePath = join(workspaceFor(), 'replace-target.txt');
    writeFileSync(
      filePath,
      [
        'HEADER',
        'alpha-marker',
        'MIDDLE',
        'beta-marker',
        'TAIL-ONE',
        'TAIL-TWO',
      ].join('\n'),
    );
    const scheduler = realToolScheduler();

    await scheduler.schedule(
      [
        toolRequest('e1', 'replace', {
          call: 'e1',
          absolute_path: filePath,
          old_string: 'alpha-marker',
          new_string: 'alpha-applied',
        }),
        toolRequest('e2', 'replace', {
          call: 'e2',
          absolute_path: filePath,
          old_string: 'beta-marker',
          new_string: 'beta-applied',
        }),
      ],
      new AbortController().signal,
    );

    const finalContent = readFileSync(filePath, 'utf-8');
    expect(finalContent).toContain('alpha-applied');
    expect(finalContent).toContain('beta-applied');
    expect(finalContent.endsWith('TAIL-ONE\nTAIL-TWO')).toBe(true);
  });

  it('ends with the request-order second complete write_file payload', async () => {
    const filePath = join(workspaceFor(), 'write-target.txt');
    writeFileSync(filePath, 'seed content\n');
    const scheduler = realToolScheduler();

    const firstPayload = 'first-complete-payload\nwith multiple lines\n';
    const secondPayload = 'second-complete-payload\nother lines\n';
    await scheduler.schedule(
      [
        toolRequest('w1', 'write_file', {
          call: 'w1',
          absolute_path: filePath,
          content: firstPayload,
        }),
        toolRequest('w2', 'write_file', {
          call: 'w2',
          absolute_path: filePath,
          content: secondPayload,
        }),
      ],
      new AbortController().signal,
    );

    expect(readFileSync(filePath, 'utf-8')).toBe(secondPayload);
  });

  it('preserves both insert_at_line insertions in request order', async () => {
    const filePath = join(workspaceFor(), 'insert-target.txt');
    writeFileSync(filePath, 'one\ntwo\nthree\nfour\n');
    const scheduler = realToolScheduler();

    await scheduler.schedule(
      [
        toolRequest('i1', 'insert_at_line', {
          call: 'i1',
          absolute_path: filePath,
          line_number: 2,
          content: 'INSERTED-ONE\n',
        }),
        toolRequest('i2', 'insert_at_line', {
          call: 'i2',
          absolute_path: filePath,
          line_number: 2,
          content: 'INSERTED-TWO\n',
        }),
      ],
      new AbortController().signal,
    );

    // Both inserts target line 2 and run sequentially in request order, so
    // the second insert lands above the first insert's line.
    expect(readFileSync(filePath, 'utf-8')).toBe(
      'one\nINSERTED-TWO\nINSERTED-ONE\ntwo\nthree\nfour\n',
    );
  });

  it('persists both delete_line_range deletions from sequential state', async () => {
    const filePath = join(workspaceFor(), 'delete-target.txt');
    writeFileSync(
      filePath,
      ['L1', 'D1A', 'D1B', 'KEEP1', 'D2A', 'D2B', 'KEEP2', 'L8'].join('\n') +
        '\n',
    );
    const scheduler = realToolScheduler();

    await scheduler.schedule(
      [
        toolRequest('d1', 'delete_line_range', {
          call: 'd1',
          absolute_path: filePath,
          start_line: 2,
          end_line: 3,
        }),
        toolRequest('d2', 'delete_line_range', {
          call: 'd2',
          absolute_path: filePath,
          start_line: 3,
          end_line: 4,
        }),
      ],
      new AbortController().signal,
    );

    expect(readFileSync(filePath, 'utf-8')).toBe('L1\nKEEP1\nKEEP2\nL8\n');
  });

  it('preserves two non-overlapping apply_patch patches', async () => {
    const fileName = 'patch-target.txt';
    const filePath = join(workspaceFor(), fileName);
    writeFileSync(
      filePath,
      [
        'line-01',
        'line-02',
        'line-03',
        'patch-one-target',
        'line-05',
        'line-06',
        'line-07',
        'line-08',
        'line-09',
        'patch-two-target',
        'line-11',
        'line-12',
      ].join('\n') + '\n',
    );
    const scheduler = realToolScheduler();

    const firstPatch = [
      `--- a/${fileName}`,
      `+++ b/${fileName}`,
      '@@ -1,5 +1,5 @@',
      ' line-01',
      ' line-02',
      ' line-03',
      '-patch-one-target',
      '+patch-one-applied',
      ' line-05',
    ].join('\n');
    const secondPatch = [
      `--- a/${fileName}`,
      `+++ b/${fileName}`,
      // Applied against the post-first-patch state: four context lines plus
      // one removal equals six old/new lines.
      '@@ -6,6 +6,6 @@',
      ' line-06',
      ' line-07',
      ' line-08',
      ' line-09',
      '-patch-two-target',
      '+patch-two-applied',
      ' line-11',
    ].join('\n');

    await scheduler.schedule(
      [
        toolRequest('p1', 'apply_patch', {
          call: 'p1',
          absolute_path: filePath,
          patch_content: firstPatch,
        }),
        toolRequest('p2', 'apply_patch', {
          call: 'p2',
          absolute_path: filePath,
          patch_content: secondPatch,
        }),
      ],
      new AbortController().signal,
    );

    const finalContent = readFileSync(filePath, 'utf-8');
    expect(finalContent).toContain('patch-one-applied');
    expect(finalContent).toContain('patch-two-applied');
    expect(finalContent.endsWith('line-11\nline-12\n')).toBe(true);
  });

  it('preserves two ast_edit replacements without last_modified', async () => {
    const filePath = join(workspaceFor(), 'ast-target.ts');
    writeFileSync(
      filePath,
      [
        'const one = 1;',
        'const two = 2;',
        'export const total = one + two;',
        'export const tail = "tail-marker";',
      ].join('\n') + '\n',
    );
    const scheduler = realToolScheduler();

    await scheduler.schedule(
      [
        toolRequest('a1', 'ast_edit', {
          call: 'a1',
          file_path: filePath,
          old_string: 'const one = 1;',
          new_string: 'const one = 11;',
          force: true,
        }),
        toolRequest('a2', 'ast_edit', {
          call: 'a2',
          file_path: filePath,
          old_string: 'const two = 2;',
          new_string: 'const two = 22;',
          force: true,
        }),
      ],
      new AbortController().signal,
    );

    const finalContent = readFileSync(filePath, 'utf-8');
    expect(finalContent).toContain('const one = 11;');
    expect(finalContent).toContain('const two = 22;');
    expect(finalContent.endsWith('export const tail = "tail-marker";\n')).toBe(
      true,
    );
  });

  it('orders a replace and an insert_at_line on one file by path', async () => {
    const filePath = join(workspaceFor(), 'mixed-target.txt');
    writeFileSync(filePath, 'alpha-marker\nline-two\nline-three\n');
    const publication = trackPublicationOrder();
    const scheduler = realToolScheduler({
      onToolCallsUpdate: publication.onToolCallsUpdate,
    });

    await scheduler.schedule(
      [
        toolRequest('r1', 'replace', {
          call: 'r1',
          absolute_path: filePath,
          old_string: 'alpha-marker',
          new_string: 'alpha-applied',
        }),
        toolRequest('i1', 'insert_at_line', {
          call: 'i1',
          absolute_path: filePath,
          line_number: 1,
          content: 'INSERTED-HEADER\n',
        }),
      ],
      new AbortController().signal,
    );

    const finalContent = readFileSync(filePath, 'utf-8');
    expect(finalContent).toContain('alpha-applied');
    expect(finalContent).toContain('INSERTED-HEADER');
    expect(finalContent.endsWith('line-two\nline-three\n')).toBe(true);
    expect(publication.order).toStrictEqual(['r1', 'i1']);
  });
});

// ── save_memory through the scheduler ──────────────────────────────────────

/**
 * Real-filesystem storage service that records each read synchronously and
 * holds the first read on an externally controlled gate. The gate
 * deterministically exposes whole-file read-modify-write overlap: with
 * same-path ordering only the first addition reads while the gate is held,
 * whereas a scheduler that launches both additions concurrently starts the
 * second read before control returns to the test. Reads capture their bytes
 * before waiting, so every read observes the state at request time.
 */
function createGatedFirstReadStorageService(globalMemoryDir: string): {
  storage: IStorageService;
  firstReadStarted: Promise<void>;
  releaseFirstRead: () => void;
  countReadsStarted: () => number;
} {
  const firstReadStarted = deferred<void>();
  const releaseFirstRead = deferred<void>();
  let readsStarted = 0;
  const storage: IStorageService = {
    getGlobalMemoryDir: () => globalMemoryDir,
    getGlobalDataDir: () => globalMemoryDir,
    readFile: async (filePath: string): Promise<string> => {
      readsStarted += 1;
      const isFirstRead = readsStarted === 1;
      const content = await fsp.readFile(filePath, 'utf-8');
      if (isFirstRead) {
        firstReadStarted.resolve();
        await releaseFirstRead.promise;
      }
      return content;
    },
    writeFile: (filePath: string, content: string): Promise<void> =>
      fsp.writeFile(filePath, content, 'utf-8'),
    ensureDir: async (dir: string): Promise<void> => {
      await fsp.mkdir(dir, { recursive: true });
    },
  };
  return {
    storage,
    firstReadStarted: firstReadStarted.promise,
    releaseFirstRead: () => releaseFirstRead.resolve(),
    countReadsStarted: () => readsStarted,
  };
}

/**
 * Real-filesystem storage service that releases each read only after reads
 * for every expected path have been requested, proving different memory
 * paths execute in parallel.
 */
function createParallelProbeStorageService(
  globalMemoryDir: string,
  expectedPaths: readonly string[],
): IStorageService {
  const allReadsRequested = deferred<void>();
  const requested = new Set<string>();
  return {
    getGlobalMemoryDir: () => globalMemoryDir,
    getGlobalDataDir: () => globalMemoryDir,
    readFile: async (filePath: string): Promise<string> => {
      requested.add(filePath);
      if (expectedPaths.every((expected) => requested.has(expected))) {
        allReadsRequested.resolve();
      }
      await allReadsRequested.promise;
      return fsp.readFile(filePath, 'utf-8');
    },
    writeFile: (filePath: string, content: string): Promise<void> =>
      fsp.writeFile(filePath, content, 'utf-8'),
    ensureDir: async (dir: string): Promise<void> => {
      await fsp.mkdir(dir, { recursive: true });
    },
  };
}

describe('save_memory same-path additions through the scheduler', () => {
  const workspaceFor = useTempWorkspace();

  function memoryScheduler(storageService: IStorageService): CoreToolScheduler {
    const workspace = workspaceFor();
    const registry = buildRegistry([
      new MemoryTool({
        storageService,
        getWorkingDir: () => workspace,
      }),
    ]);
    return buildScheduler(registry);
  }

  it('persists both facts added concurrently to one memory file', async () => {
    const workspace = workspaceFor();
    const projectMemoryPath = join(workspace, '.llxprt', 'LLXPRT.md');
    mkdirSync(join(workspace, '.llxprt'), { recursive: true });
    const sectionHeader = ['##', 'LLxprt Code Added Memories'].join(' ');
    writeFileSync(projectMemoryPath, sectionHeader);
    const gated = createGatedFirstReadStorageService(
      join(workspace, 'global-memory'),
    );
    const scheduler = memoryScheduler(gated.storage);

    const schedulePromise = scheduler.schedule(
      [
        toolRequest('s1', 'save_memory', {
          call: 's1',
          fact: 'alpha-fact',
          scope: 'project',
        }),
        toolRequest('s2', 'save_memory', {
          call: 's2',
          fact: 'beta-fact',
          scope: 'project',
        }),
      ],
      new AbortController().signal,
    );

    // The first addition is held mid-read; the scheduler has now launched
    // everything it will launch at this point. With same-path ordering only
    // one read has started — a second concurrent read is exactly the
    // lost-update race this ordering prevents.
    await gated.firstReadStarted;
    await nextMacrotask();
    expect(gated.countReadsStarted()).toBe(1);

    gated.releaseFirstRead();
    await schedulePromise;

    const memoryContent = readFileSync(projectMemoryPath, 'utf-8');
    expect(memoryContent).toContain('- alpha-fact');
    expect(memoryContent).toContain('- beta-fact');
  });

  it('keeps additions to different memory paths parallel', async () => {
    const workspace = workspaceFor();
    const projectMemoryPath = join(workspace, '.llxprt', 'LLXPRT.md');
    const globalMemoryPath = join(workspace, 'global-memory', 'LLXPRT.md');
    const scheduler = memoryScheduler(
      createParallelProbeStorageService(join(workspace, 'global-memory'), [
        projectMemoryPath,
        globalMemoryPath,
      ]),
    );

    await scheduler.schedule(
      [
        toolRequest('s1', 'save_memory', {
          call: 's1',
          fact: 'project-fact',
          scope: 'project',
        }),
        toolRequest('s2', 'save_memory', {
          call: 's2',
          fact: 'global-fact',
          scope: 'global',
        }),
      ],
      new AbortController().signal,
    );

    expect(readFileSync(projectMemoryPath, 'utf-8')).toContain(
      '- project-fact',
    );
    expect(readFileSync(globalMemoryPath, 'utf-8')).toContain('- global-fact');
  });
});
