/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IToolHost } from '../interfaces/index.js';
import { RipGrepTool } from '../index.js';
import type { ToolResult } from '../index.js';
import type { RipGrepToolParams } from '../tools/ripGrep.js';
import {
  resolveRipgrepClose,
  createRipgrepAcquisitionState,
  processRipgrepStdoutChunk,
  createAggregateSemanticBudget,
} from '../tools/ripGrep.js';

function createTempDir(prefix = 'llxprt-raw-trunc-'): {
  dir: string;
  cleanup: () => void;
} {
  const dir = join(
    tmpdir(),
    `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

function createToolHost(targetDir: string): IToolHost {
  return {
    getTargetDir: () => targetDir,
    getWorkspaceRoots: () => [targetDir],
    getApprovalMode: () => 'auto',
    setApprovalMode: () => {},
    isInteractive: () => false,
    hasFeatureFlag: () => false,
    getFileService: () => ({
      shouldGitIgnoreFile: () => false,
      shouldLlxprtIgnoreFile: () => false,
      shouldIgnoreFile: () => false,
      filterFiles: (paths) => paths,
    }),
    getFileFilteringOptions: () => ({
      respectGitIgnore: true,
      respectLlxprtIgnore: true,
    }),
    getFileExclusions: () => [],
    getReadManyFilesExclusions: () => [],
    getFileFilteringRespectLlxprtIgnore: () => true,
    getLlxprtIgnoreFilePath: () => null,
    recordFileRead: () => {},
    getFileSystemService: () => undefined,
    getLlxprtIgnorePatterns: () => [],
    getEphemeralSettings: () => ({
      'tool-output-max-items': 50,
      'tool-output-max-tokens': 50000,
      'tool-output-item-size-limit': 524288,
    }),
    getDebugMode: () => false,
  };
}

async function executeRipgrep(
  host: IToolHost,
  params: RipGrepToolParams,
): Promise<ToolResult> {
  const tool = new RipGrepTool(host);
  try {
    return await tool.build(params).execute(new AbortController().signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { llmContent: message, returnDisplay: message };
  }
}

describe('resolveRipgrepClose: raw collector truncation vs semantic budget (finding 3)', () => {
  it('stderr-only overflow does NOT mark budgetTruncated (parsed results complete)', () => {
    const basePath = '/test';
    const budget = createAggregateSemanticBudget();
    const state = createRipgrepAcquisitionState(budget);

    const stdoutChunk = Buffer.from('file.txt\x005:match content\n');
    processRipgrepStdoutChunk(state, stdoutChunk, basePath, 20000);

    const largeStderr = Buffer.alloc(5 * 1024 * 1024, 0x45);
    state.collector.append(largeStderr, 'stderr');

    const outcome = resolveRipgrepClose(0, null, state, basePath, 20000, false);

    expect(outcome.error).toBeUndefined();
    expect(outcome.result).toBeDefined();
    expect(outcome.result!.budgetTruncated).toBe(false);
    expect(outcome.result!.rawTruncated).toBe(true);
    expect(outcome.result!.matches.length).toBe(1);
  });

  it('semantic budget exhaustion marks budgetTruncated (match data incomplete)', () => {
    const basePath = '/test';
    const budget = createAggregateSemanticBudget();
    budget.remainingBytes = 300;

    const state = createRipgrepAcquisitionState(budget);

    const stdoutChunk = Buffer.from(
      'file.txt\x001:short\nfile.txt\x002:another\nfile.txt\x003:third\n',
    );
    processRipgrepStdoutChunk(state, stdoutChunk, basePath, 20000);

    const outcome = resolveRipgrepClose(0, null, state, basePath, 20000, false);

    expect(outcome.result).toBeDefined();
    expect(outcome.result!.budgetTruncated).toBe(true);
  });

  it('stderr-only overflow with zero stdout matches is complete (no false incomplete)', () => {
    const basePath = '/test';
    const budget = createAggregateSemanticBudget();
    const state = createRipgrepAcquisitionState(budget);

    const largeStderr = Buffer.alloc(5 * 1024 * 1024, 0x57);
    state.collector.append(largeStderr, 'stderr');

    const outcome = resolveRipgrepClose(0, null, state, basePath, 20000, false);

    expect(outcome.error).toBeUndefined();
    expect(outcome.result).toBeDefined();
    expect(outcome.result!.budgetTruncated).toBe(false);
    expect(outcome.result!.rawTruncated).toBe(true);
    expect(outcome.result!.matches.length).toBe(0);
  });

  it('labels omitted diagnostic bytes when a failing ripgrep writes excessive stderr', () => {
    const basePath = '/test';
    const state = createRipgrepAcquisitionState(
      createAggregateSemanticBudget(),
    );

    state.collector.append(Buffer.alloc(5 * 1024 * 1024, 0x45), 'stderr');

    const outcome = resolveRipgrepClose(2, null, state, basePath, 20000, false);

    expect(outcome.result).toBeUndefined();
    expect(outcome.error?.message).toContain('ripgrep exited with code 2');
    expect(outcome.error?.message).toContain(
      '[LLXPRT output truncated: 1,048,576 bytes omitted]',
    );
  });
});

describe('Multi-root continuation despite verbose stderr (finding 3)', () => {
  let tempDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = createTempDir();
    tempDir = tmp.dir;
    cleanup = tmp.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it(
    'searches all roots and returns complete results when no semantic exhaustion',
    async () => {
      const dirs: string[] = [];
      for (let i = 0; i < 3; i++) {
        const dir = join(tempDir, `ws${i}`);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `f${i}.txt`), `uniquematch_${i}\n`);
        dirs.push(dir);
      }

      const host: IToolHost = {
        ...createToolHost(tempDir),
        getWorkspaceRoots: () => dirs,
      };

      const result = await executeRipgrep(host, {
        pattern: 'uniquematch',
      });

      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      expect(text).not.toMatch(/incomplete|showing/i);
      expect(text).toContain('uniquematch_0');
      expect(text).toContain('uniquematch_1');
      expect(text).toContain('uniquematch_2');
    },
    { timeout: 15000 },
  );
});
