/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IToolHost } from '../interfaces/index.js';
import {
  type SemanticBudget,
  createAggregateSemanticBudget,
  createGrepRetainState,
  retainGrepMatch,
} from '../tools/grep/grepBudget.js';
import { GrepTool, RipGrepTool } from '../index.js';
import type { ToolResult } from '../index.js';
import type { GrepToolParams } from '../tools/grep/types.js';
import type { RipGrepToolParams } from '../tools/ripGrep.js';

const itPosix = process.platform === 'win32' ? it.skip : it;
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
  itPosix(
    'restores the budget consumed by a failed git grep before system grep',
    async () => {
      const { performGrepSearch } = await import(
        '../tools/grep/search-strategies.js'
      );
      const workspace = createTempDir('llxprt-budget-rollback-');
      const fakeCommand = createTempDir('llxprt-fake-git-');
      const originalPath = process.env.PATH;
      try {
        initGitRepo(workspace.dir);
        for (let i = 0; i < 10; i++) {
          writeFileSync(join(workspace.dir, `f${i}.txt`), `match_line_${i}\n`);
        }
        gitAdd(workspace.dir);

        const fakeOutput = join(fakeCommand.dir, 'output.txt');
        const fakeGit = join(fakeCommand.dir, 'git');
        writeFileSync(fakeOutput, `f0.txt:1:match_line_${'x'.repeat(3000)}\n`);
        writeFileSync(
          fakeGit,
          `#!/bin/sh\nif [ "$1" = "--version" ]; then\n  echo "git version test"\n  exit 0\nfi\ncat ${JSON.stringify(fakeOutput)}\necho "forced failure" >&2\nexit 2\n`,
        );
        chmodSync(fakeGit, 0o755);
        process.env.PATH = `${fakeCommand.dir}:${originalPath ?? ''}`;

        const budget: SemanticBudget = {
          remainingBytes: 4000,
          remainingObjects: 100,
        };
        const result = await performGrepSearch(
          {
            pattern: 'match_line',
            path: workspace.dir,
            signal: new AbortController().signal,
            maxResults: 100,
            maxFiles: 100,
            maxPerFile: 50,
            semanticBudget: budget,
          },
          ['node_modules'],
        );

        expect(result.results).toHaveLength(10);
        expect(result.incomplete).not.toBe(true);
        expect(budget.remainingObjects).toBe(90);
        expect(budget.remainingBytes).toBeGreaterThan(0);
      } finally {
        if (originalPath === undefined) {
          delete process.env.PATH;
        } else {
          process.env.PATH = originalPath;
        }
        fakeCommand.cleanup();
        workspace.cleanup();
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
        createAggregateSemanticBudget(),
      );

      expect(result.results).toHaveLength(5);
      expect(new Set(result.results.map((match) => match.filePath)).size).toBe(
        5,
      );
      expect(result.incomplete).toBe(true);
      expect(result.wasLimited).toBe(true);
      expect(result.observedCount).toBe(6);
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
        createAggregateSemanticBudget(),
      );

      expect(result.results).toHaveLength(3);
      expect(new Set(result.results.map((match) => match.filePath)).size).toBe(
        3,
      );
      expect(result.incomplete).toBe(true);
      expect(result.observedCount).toBe(4);
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

  describe('JavaScript fallback consumes shared SemanticBudget (finding 1)', () => {
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
      'decrements semanticBudget.remainingBytes and remainingObjects after retaining matches',
      async () => {
        const { javascriptGrepFallback } = await import(
          '../tools/grep/javascriptFallback.js'
        );

        writeFileSync(join(tempDir, 'f1.txt'), 'match alpha\nmatch beta\n');
        writeFileSync(join(tempDir, 'f2.txt'), 'match gamma\n');

        const budget = createAggregateSemanticBudget();
        const initialBytes = budget.remainingBytes;
        const initialObjects = budget.remainingObjects;

        await javascriptGrepFallback(
          'match',
          tempDir,
          undefined,
          new AbortController().signal,
          1000,
          100,
          50,
          ['node_modules'],
          budget,
        );

        expect(budget.remainingBytes).toBeLessThan(initialBytes);
        expect(budget.remainingObjects).toBeLessThan(initialObjects);
      },
      { timeout: 15000 },
    );

    it(
      'marks incomplete and stops when semantic byte budget is exhausted',
      async () => {
        const { javascriptGrepFallback } = await import(
          '../tools/grep/javascriptFallback.js'
        );

        const longLine = 'Z'.repeat(10_000);
        for (let i = 0; i < 50; i++) {
          writeFileSync(join(tempDir, `f${i}.txt`), `match${longLine}\n`);
        }

        const tightBudget: SemanticBudget = {
          remainingBytes: 50_000,
          remainingObjects: 100_000,
        };

        const result = await javascriptGrepFallback(
          'match',
          tempDir,
          undefined,
          new AbortController().signal,
          100_000,
          100,
          50,
          ['node_modules'],
          tightBudget,
        );

        expect(result.incomplete).toBe(true);
        expect(result.results.length).toBeLessThan(50);
        expect(tightBudget.remainingBytes).toBeLessThan(50_000);
      },
      { timeout: 15000 },
    );
  });

  describe('JavaScript fallback maxResults early stop is proven-incomplete (finding 2)', () => {
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
      'exactly maxResults matches is NOT incomplete (exact-cap evidence)',
      async () => {
        const { javascriptGrepFallback } = await import(
          '../tools/grep/javascriptFallback.js'
        );

        for (let i = 0; i < 5; i++) {
          writeFileSync(join(tempDir, `f${i}.txt`), `match_line_${i}\n`);
        }

        const result = await javascriptGrepFallback(
          'match_line',
          tempDir,
          undefined,
          new AbortController().signal,
          5,
          100,
          50,
          ['node_modules'],
          createAggregateSemanticBudget(),
        );

        expect(result.results.length).toBe(5);
        expect(result.incomplete).toBe(false);
      },
      { timeout: 15000 },
    );

    it(
      'maxResults+1 matches IS incomplete (extra match proves omission)',
      async () => {
        const { javascriptGrepFallback } = await import(
          '../tools/grep/javascriptFallback.js'
        );

        for (let i = 0; i < 6; i++) {
          writeFileSync(join(tempDir, `f${i}.txt`), `match_line_${i}\n`);
        }

        const result = await javascriptGrepFallback(
          'match_line',
          tempDir,
          undefined,
          new AbortController().signal,
          5,
          100,
          50,
          ['node_modules'],
          createAggregateSemanticBudget(),
        );

        expect(result.results.length).toBe(5);
        expect(result.incomplete).toBe(true);
      },
      { timeout: 15000 },
    );
  });
});

describe('Grep exact-cap evidence with per-file limits', () => {
  it('ignores unusable dominant-file matches until a later usable match proves omission', () => {
    const state = createGrepRetainState(createAggregateSemanticBudget());
    const limits = { maxResults: 2, maxFiles: 10, maxPerFile: 2 };

    retainGrepMatch(
      state,
      { filePath: 'dominant.txt', lineNumber: 1, line: 'match 1' },
      limits,
    );
    retainGrepMatch(
      state,
      { filePath: 'dominant.txt', lineNumber: 2, line: 'match 2' },
      limits,
    );
    const dominantOverflowStopped = retainGrepMatch(
      state,
      { filePath: 'dominant.txt', lineNumber: 3, line: 'match 3' },
      limits,
    );

    expect(dominantOverflowStopped).toBe(false);
    expect(state.earlyStopped).toBe(false);
    expect(state.matches).toHaveLength(2);

    const laterUsableMatchStopped = retainGrepMatch(
      state,
      { filePath: 'later.txt', lineNumber: 1, line: 'match later' },
      limits,
    );

    expect(laterUsableMatchStopped).toBe(true);
    expect(state.earlyStopped).toBe(true);
    expect(state.observedCount).toBe(4);
    expect(state.matches.map((match) => match.line)).toEqual([
      'match 1',
      'match 2',
    ]);
  });
});

describe('Exact-cap multi-root completeness: skipped roots mark incomplete (item 3)', () => {
  let tempDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = createTempDir('llxprt-multicap-');
    tempDir = tmp.dir;
    cleanup = tmp.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it(
    'grep: first root fills exact cap, later root skipped => incomplete/non-exact',
    async () => {
      const rootA = join(tempDir, 'rootA');
      const rootB = join(tempDir, 'rootB');
      mkdirSync(rootA, { recursive: true });
      mkdirSync(rootB, { recursive: true });
      for (let i = 0; i < 5; i++) {
        writeFileSync(join(rootA, `f${i}.txt`), `capmatch_${i}\n`);
      }
      writeFileSync(join(rootB, 'extra.txt'), 'capmatch_extra\n');

      const host: IToolHost = {
        ...createToolHost(tempDir),
        getWorkspaceRoots: () => [rootA, rootB],
      };

      const result = await executeGrep(host, {
        pattern: 'capmatch',
        max_results: 5,
        max_files: 100,
        max_per_file: 1,
      });

      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      // Root A filled the cap; root B was skipped => incomplete
      expect(text).toMatch(/incomplete|showing.*may be/i);
      expect(text).not.toMatch(/^Found 5 matches for pattern/m);
    },
    { timeout: 15000 },
  );

  it(
    'grep: all roots fully exhausted at cap remains exact',
    async () => {
      const rootA = join(tempDir, 'rootA');
      const rootB = join(tempDir, 'rootB');
      mkdirSync(rootA, { recursive: true });
      mkdirSync(rootB, { recursive: true });
      // Root A: 2 matches, Root B: 3 matches, total = 5 = maxResults
      writeFileSync(join(rootA, 'f1.txt'), 'exactmatch_1\n');
      writeFileSync(join(rootA, 'f2.txt'), 'exactmatch_2\n');
      writeFileSync(join(rootB, 'f3.txt'), 'exactmatch_3\n');
      writeFileSync(join(rootB, 'f4.txt'), 'exactmatch_4\n');
      writeFileSync(join(rootB, 'f5.txt'), 'exactmatch_5\n');

      const host: IToolHost = {
        ...createToolHost(tempDir),
        getWorkspaceRoots: () => [rootA, rootB],
      };

      const result = await executeGrep(host, {
        pattern: 'exactmatch',
        max_results: 5,
        max_files: 100,
        max_per_file: 1,
      });

      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      // All 5 matches across both roots, no root skipped => exact
      expect(text).not.toMatch(/incomplete|showing.*may be/i);
      expect(text).toMatch(/^Found 5 matches for pattern/m);
    },
    { timeout: 15000 },
  );

  it(
    'ripgrep: first root fills exact cap, later root skipped => incomplete',
    async () => {
      const rootA = join(tempDir, 'rootA');
      const rootB = join(tempDir, 'rootB');
      mkdirSync(rootA, { recursive: true });
      mkdirSync(rootB, { recursive: true });

      // Root A: exactly 20000 matches (fills the default cap)
      const linesA: string[] = [];
      for (let i = 0; i < 20000; i++) {
        linesA.push(`rgcapmatch_${i}`);
      }
      writeFileSync(join(rootA, 'big.txt'), linesA.join('\n'));
      // Root B: at least one match
      writeFileSync(join(rootB, 'extra.txt'), 'rgcapmatch_extra\n');

      const host: IToolHost = {
        ...createToolHost(tempDir),
        getWorkspaceRoots: () => [rootA, rootB],
      };

      const result = await executeRipgrep(host, {
        pattern: 'rgcapmatch',
      });

      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      expect(text).toMatch(/incomplete|showing/i);
    },
    { timeout: 30000 },
  );

  it(
    'ripgrep: all roots fully exhausted remains exact',
    async () => {
      const rootA = join(tempDir, 'rootA');
      const rootB = join(tempDir, 'rootB');
      mkdirSync(rootA, { recursive: true });
      mkdirSync(rootB, { recursive: true });
      writeFileSync(join(rootA, 'f1.txt'), 'rgexact_1\nrgexact_2\n');
      writeFileSync(join(rootB, 'f2.txt'), 'rgexact_3\n');

      const host: IToolHost = {
        ...createToolHost(tempDir),
        getWorkspaceRoots: () => [rootA, rootB],
      };

      const result = await executeRipgrep(host, {
        pattern: 'rgexact',
      });

      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      expect(text).not.toMatch(/incomplete|showing/i);
      expect(text).toMatch(/Found 3 matches/);
    },
    { timeout: 15000 },
  );
});
