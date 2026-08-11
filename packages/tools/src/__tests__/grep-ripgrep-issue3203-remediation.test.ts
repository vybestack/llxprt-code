/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IToolHost } from '../interfaces/index.js';
import { GrepTool, RipGrepTool } from '../index.js';
import type { ToolResult } from '../index.js';
import type { GrepToolParams } from '../tools/grep/types.js';
import type { RipGrepToolParams } from '../tools/ripGrep.js';

function createTempDir(prefix = 'llxprt-grep-remediation-'): {
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

function initGitRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email test@test.com', {
    cwd: dir,
    stdio: 'ignore',
  });
  execSync('git config user.name Test', { cwd: dir, stdio: 'ignore' });
}

function gitAdd(dir: string): void {
  execSync('git add -A', { cwd: dir, stdio: 'ignore' });
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

async function executeGrep(
  host: IToolHost,
  params: GrepToolParams,
): Promise<ToolResult> {
  const tool = new GrepTool(host);
  try {
    return await tool.build(params).execute(new AbortController().signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { llmContent: message, returnDisplay: message };
  }
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

describe('Exact-limit evidence: producer at exactly the cap is exhaustive (item 1)', () => {
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
    'grep with exactly max_results matches is NOT marked incomplete',
    async () => {
      for (let i = 0; i < 5; i++) {
        writeFileSync(join(tempDir, `f${i}.txt`), `match_line_${i}\n`);
      }

      const result = await executeGrep(createToolHost(tempDir), {
        pattern: 'match_line',
        max_results: 5,
        max_files: 100,
        max_per_file: 1,
      });

      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      expect(result.error).toBeUndefined();
      expect(text).not.toMatch(/incomplete|showing.*may be/i);
      expect(text).toMatch(/^Found 5 matches for pattern/m);
    },
    { timeout: 15000 },
  );

  it(
    'grep with max_results+1 matches IS marked incomplete',
    async () => {
      for (let i = 0; i < 6; i++) {
        writeFileSync(join(tempDir, `f${i}.txt`), `match_line_${i}\n`);
      }

      const result = await executeGrep(createToolHost(tempDir), {
        pattern: 'match_line',
        max_results: 5,
        max_files: 100,
        max_per_file: 1,
      });

      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      expect(result.error).toBeUndefined();
      expect(text).toMatch(/incomplete|showing.*may be/i);
      expect(text).not.toMatch(/^Found 5 matches for pattern/m);
    },
    { timeout: 15000 },
  );

  it(
    'ripgrep with fewer matches than cap is NOT marked incomplete',
    async () => {
      const lines: string[] = [];
      for (let i = 0; i < 100; i++) {
        lines.push(`match_${i}`);
      }
      writeFileSync(join(tempDir, 'big.txt'), lines.join('\n'));

      const result = await executeRipgrep(createToolHost(tempDir), {
        pattern: 'match_',
      });

      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      expect(text).not.toMatch(/incomplete|results may be incomplete/i);
      expect(text).toMatch(/Found 100 matches/);
    },
    { timeout: 15000 },
  );
});

describe('Strategy budget rollback: failed strategy does not starve fallback (item 4)', () => {
  it(
    'git grep failure restores budget for system grep',
    async () => {
      const { performGrepSearch, createAggregateSemanticBudget } = await import(
        '../tools/grep/search-strategies.js'
      );
      const tmp = createTempDir('llxprt-budget-rollback-');
      try {
        initGitRepo(tmp.dir);
        for (let i = 0; i < 10; i++) {
          writeFileSync(join(tmp.dir, `f${i}.txt`), `match_line_${i}\n`);
        }
        gitAdd(tmp.dir);

        const budget = createAggregateSemanticBudget();
        const initialBytes = budget.remainingBytes;
        const initialObjects = budget.remainingObjects;

        const result = await performGrepSearch(
          {
            pattern: 'match_line',
            path: tmp.dir,
            signal: new AbortController().signal,
            maxResults: 100,
            maxFiles: 100,
            maxPerFile: 50,
            semanticBudget: budget,
          },
          ['node_modules'],
        );

        expect(result.results.length).toBeGreaterThan(0);
        expect(budget.remainingBytes).toBeLessThanOrEqual(initialBytes);
        expect(budget.remainingObjects).toBeLessThanOrEqual(initialObjects);
      } finally {
        tmp.cleanup();
      }
    },
    { timeout: 15000 },
  );
});

describe('JavaScript fallback maxFiles prompt stop (item 5)', () => {
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
    'stops promptly when maxFiles is exceeded and marks incomplete',
    async () => {
      const { javascriptGrepFallback } = await import(
        '../tools/grep/javascriptFallback.js'
      );

      for (let i = 0; i < 20; i++) {
        writeFileSync(join(tempDir, `f${i}.txt`), `match_in_file_${i}\n`);
      }

      const result = await javascriptGrepFallback(
        'match_in_file',
        tempDir,
        undefined,
        new AbortController().signal,
        10000,
        5,
        50,
        ['node_modules'],
      );

      expect(result.results.length).toBeLessThanOrEqual(5);
      expect(result.incomplete).toBe(true);
      expect(result.wasLimited).toBe(true);
      expect(result.observedCount).toBeGreaterThanOrEqual(
        result.results.length,
      );
    },
    { timeout: 15000 },
  );

  it(
    'does not claim exhaustive total when files limit is hit',
    async () => {
      const { javascriptGrepFallback } = await import(
        '../tools/grep/javascriptFallback.js'
      );

      for (let i = 0; i < 10; i++) {
        writeFileSync(join(tempDir, `f${i}.txt`), `unique_match_${i}\n`);
      }

      const result = await javascriptGrepFallback(
        'unique_match',
        tempDir,
        undefined,
        new AbortController().signal,
        10000,
        3,
        50,
        ['node_modules'],
      );

      expect(result.results.length).toBeLessThanOrEqual(3);
      expect(result.incomplete).toBe(true);
      expect(result.totalFound).toBeUndefined();
    },
    { timeout: 15000 },
  );
});

describe('Ripgrep multi-root budget exhaustion stops further spawns (item 11)', () => {
  it(
    'does not spawn ripgrep for later directories after budget exhaustion',
    async () => {
      const dirs: string[] = [];
      const tmp = createTempDir('llxprt-multi-root-budget-');
      try {
        for (let i = 0; i < 6; i++) {
          const dir = join(tmp.dir, `ws${i}`);
          mkdirSync(dir, { recursive: true });
          const longLine = 'X'.repeat(900_000);
          writeFileSync(join(dir, `f${i}.txt`), `matchprefix${longLine}\n`);
          dirs.push(dir);
        }

        const host: IToolHost = {
          ...createToolHost(tmp.dir),
          getWorkspaceRoots: () => dirs,
        };

        const result = await executeRipgrep(host, {
          pattern: 'matchprefix',
        });

        const text =
          typeof result.llmContent === 'string' ? result.llmContent : '';
        expect(text).toMatch(/incomplete|showing|limited/i);
        expect(text).not.toContain('Found 6 matches');
      } finally {
        tmp.cleanup();
      }
    },
    { timeout: 30000 },
  );
});
