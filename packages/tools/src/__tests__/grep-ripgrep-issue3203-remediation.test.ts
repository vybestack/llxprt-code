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
  DEFAULT_SOURCE_BUDGET_BYTES,
} from '../tools/grep/grepBudget.js';
import { GrepTool, RipGrepTool } from '../index.js';
import type { ToolResult } from '../index.js';
import type { GrepToolParams } from '../tools/grep/types.js';
import type { RipGrepToolParams } from '../tools/ripGrep.js';

const textOrEmpty = (value: string | null | undefined): string => value ?? '';

const stringContent = (value: unknown): string =>
  typeof value === 'string' ? value : '';

function restorePath(originalPath: string | undefined): void {
  if (originalPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = originalPath;
  }
}

function createTwoRootHost(root: string): {
  readonly rootA: string;
  readonly rootB: string;
  readonly host: IToolHost;
} {
  const rootA = join(root, 'rootA');
  const rootB = join(root, 'rootB');
  mkdirSync(rootA, { recursive: true });
  mkdirSync(rootB, { recursive: true });
  const host: IToolHost = {
    ...createToolHost(root),
    getWorkspaceRoots: () => [rootA, rootB],
  };
  return { rootA, rootB, host };
}

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

  const observeGrepWithExactlyMaxResultsMatchesIsNOTMarkedIncompleteAt133 =
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
      return { result, text };
    };

  it(
    'grep with exactly max_results matches is NOT marked incomplete',
    async () => {
      const { result, text } =
        await observeGrepWithExactlyMaxResultsMatchesIsNOTMarkedIncompleteAt133();
      expect(result.error).toBeUndefined();
      expect(text).not.toMatch(/incomplete|showing.*may be/i);
      expect(text).toMatch(/^Found 5 matches for pattern/m);
    },
    { timeout: 15000 },
  );

  const observeGrepWithMaxResults1MatchesISMarkedIncompleteAt156 = async () => {
    for (let i = 0; i < 6; i++) {
      writeFileSync(join(tempDir, `f${i}.txt`), `match_line_${i}\n`);
    }
    const result = await executeGrep(createToolHost(tempDir), {
      pattern: 'match_line',
      max_results: 5,
      max_files: 100,
      max_per_file: 1,
    });
    const text = typeof result.llmContent === 'string' ? result.llmContent : '';
    return { result, text };
  };

  it(
    'grep with max_results+1 matches IS marked incomplete',
    async () => {
      const { result, text } =
        await observeGrepWithMaxResults1MatchesISMarkedIncompleteAt156();
      expect(result.error).toBeUndefined();
      expect(text).toMatch(/incomplete|showing.*may be/i);
      expect(text).not.toMatch(/^Found 5 matches for pattern/m);
    },
    { timeout: 15000 },
  );

  const observeRipgrepWithFewerMatchesThanCapIsNOTMarkedIncompleteAt179 =
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
      return { text };
    };

  it(
    'ripgrep with fewer matches than cap is NOT marked incomplete',
    async () => {
      const { text } =
        await observeRipgrepWithFewerMatchesThanCapIsNOTMarkedIncompleteAt179();
      expect(text).not.toMatch(/incomplete|results may be incomplete/i);
      expect(text).toMatch(/Found 100 matches/);
    },
    { timeout: 15000 },
  );
});

describe('Strategy budget rollback: failed strategy does not starve fallback (item 4)', () => {
  describe.skipIf(process.platform === 'win32')(
    'POSIX grep strategy budget rollback',
    () => {
      it(
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
              writeFileSync(
                join(workspace.dir, `f${i}.txt`),
                `match_line_${i}\n`,
              );
            }
            gitAdd(workspace.dir);

            const fakeOutput = join(fakeCommand.dir, 'output.txt');
            const fakeGit = join(fakeCommand.dir, 'git');
            writeFileSync(
              fakeOutput,
              `f0.txt:1:match_line_${'x'.repeat(3000)}\n`,
            );
            writeFileSync(
              fakeGit,
              `#!/bin/sh\nif [ "$1" = "--version" ]; then\n  echo "git version test"\n  exit 0\nfi\ncat ${JSON.stringify(fakeOutput)}\necho "forced failure" >&2\nexit 2\n`,
            );
            chmodSync(fakeGit, 0o755);
            process.env.PATH = `${fakeCommand.dir}:${textOrEmpty(originalPath)}`;

            const budget: SemanticBudget = {
              remainingBytes: 4000,
              remainingObjects: 100,
              sourceBytes: DEFAULT_SOURCE_BUDGET_BYTES,
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
            restorePath(originalPath);
            fakeCommand.cleanup();
            workspace.cleanup();
          }
        },
        { timeout: 15000 },
      );
    },
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

        const text = stringContent(result.llmContent);
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
          sourceBytes: DEFAULT_SOURCE_BUDGET_BYTES,
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

    it(
      'charges source chunks against the aggregate sourceBytes across no-match files (not a fresh per-file budget)',
      async () => {
        const { javascriptGrepFallback } = await import(
          '../tools/grep/javascriptFallback.js'
        );

        // 10 no-match files, 1000 bytes each. The tight source budget (3500)
        // allows three full files; the fourth file's first chunk (1000)
        // exceeds the remaining 500 bytes and must prove partiality against
        // the SHARED aggregate budget — not a fresh per-file allowance.
        for (let i = 0; i < 10; i++) {
          writeFileSync(join(tempDir, `nomatch${i}.txt`), 'x'.repeat(1000));
        }

        const budget: SemanticBudget = {
          remainingBytes: 1_000_000,
          remainingObjects: 100_000,
          sourceBytes: 3_500,
        };

        const result = await javascriptGrepFallback(
          'definitely_no_such_match',
          tempDir,
          undefined,
          new AbortController().signal,
          1000,
          100,
          50,
          ['node_modules'],
          budget,
        );

        // Bounded: the aggregate budget was actually consumed across files
        // (three files = 3000 charged, 500 remain) — multiple no-match files
        // did NOT each receive a fresh budget.
        expect(budget.sourceBytes).toBe(500);
        // Truthful: the run is marked incomplete because the fourth file
        // could not be fully observed.
        expect(result.incomplete).toBe(true);
        expect(result.wasLimited).toBe(true);
        expect(result.results).toHaveLength(0);
        expect(result.totalFound).toBeUndefined();
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
    expect(state.matches.map((match) => match.line)).toStrictEqual([
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

  const observeGrepFirstRootFillsExactCapLaterRootSkippedIncompleteNonExactAt653 =
    async () => {
      const { rootA, rootB, host } = createTwoRootHost(tempDir);
      for (let i = 0; i < 5; i++) {
        writeFileSync(join(rootA, `f${i}.txt`), `capmatch_${i}\n`);
      }
      writeFileSync(join(rootB, 'extra.txt'), 'capmatch_extra\n');
      const result = await executeGrep(host, {
        pattern: 'capmatch',
        max_results: 5,
        max_files: 100,
        max_per_file: 1,
      });
      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      return { text };
    };

  it(
    'grep: first root fills exact cap, later root skipped => incomplete/non-exact',
    async () => {
      const { text } =
        await observeGrepFirstRootFillsExactCapLaterRootSkippedIncompleteNonExactAt653();
      expect(text).toMatch(/incomplete|showing.*may be/i);
      expect(text).not.toMatch(/^Found 5 matches for pattern/m);
    },
    { timeout: 15000 },
  );

  const observeGrepAllRootsFullyExhaustedAtCapRemainsExactAt686 = async () => {
    const { rootA, rootB, host } = createTwoRootHost(tempDir);
    writeFileSync(join(rootA, 'f1.txt'), 'exactmatch_1\n');
    writeFileSync(join(rootA, 'f2.txt'), 'exactmatch_2\n');
    writeFileSync(join(rootB, 'f3.txt'), 'exactmatch_3\n');
    writeFileSync(join(rootB, 'f4.txt'), 'exactmatch_4\n');
    writeFileSync(join(rootB, 'f5.txt'), 'exactmatch_5\n');
    const result = await executeGrep(host, {
      pattern: 'exactmatch',
      max_results: 5,
      max_files: 100,
      max_per_file: 1,
    });
    const text = typeof result.llmContent === 'string' ? result.llmContent : '';
    return { text };
  };

  it(
    'grep: all roots fully exhausted at cap remains exact',
    async () => {
      const { text } =
        await observeGrepAllRootsFullyExhaustedAtCapRemainsExactAt686();
      expect(text).not.toMatch(/incomplete|showing.*may be/i);
      expect(text).toMatch(/^Found 5 matches for pattern/m);
    },
    { timeout: 15000 },
  );

  const observeRipgrepFirstRootFillsExactCapLaterRootSkippedIncompleteAt721 =
    async () => {
      const { rootA, rootB, host } = createTwoRootHost(tempDir);
      const linesA: string[] = [];
      for (let i = 0; i < 20000; i++) {
        linesA.push(`rgcapmatch_${i}`);
      }
      writeFileSync(join(rootA, 'big.txt'), linesA.join('\n'));
      writeFileSync(join(rootB, 'extra.txt'), 'rgcapmatch_extra\n');
      const result = await executeRipgrep(host, {
        pattern: 'rgcapmatch',
      });
      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      return { text };
    };

  it(
    'ripgrep: first root fills exact cap, later root skipped => incomplete',
    async () => {
      const { text } =
        await observeRipgrepFirstRootFillsExactCapLaterRootSkippedIncompleteAt721();
      expect(text).toMatch(/incomplete|showing/i);
    },
    { timeout: 30000 },
  );

  const observeRipgrepAllRootsFullyExhaustedRemainsExactAt754 = async () => {
    const { rootA, rootB, host } = createTwoRootHost(tempDir);
    writeFileSync(join(rootA, 'f1.txt'), 'rgexact_1\nrgexact_2\n');
    writeFileSync(join(rootB, 'f2.txt'), 'rgexact_3\n');
    const result = await executeRipgrep(host, {
      pattern: 'rgexact',
    });
    const text = typeof result.llmContent === 'string' ? result.llmContent : '';
    return { text };
  };

  it(
    'ripgrep: all roots fully exhausted remains exact',
    async () => {
      const { text } =
        await observeRipgrepAllRootsFullyExhaustedRemainsExactAt754();
      expect(text).not.toMatch(/incomplete|showing/i);
      expect(text).toMatch(/Found 3 matches/);
    },
    { timeout: 15000 },
  );
});

describe('javascriptGrepFallback mid-file abort (issue #3202)', () => {
  let tempDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = createTempDir('llxprt-fallback-abort-');
    tempDir = tmp.dir;
    cleanup = tmp.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it(
    'rejects promptly on mid-file abort without reading the entire file',
    async () => {
      const { javascriptGrepFallback } = await import(
        '../tools/grep/javascriptFallback.js'
      );

      // A large file with many matching lines so the read stream is still
      // active when we abort.
      const lines: string[] = [];
      for (let i = 0; i < 50_000; i++) {
        lines.push(`abort_match_${i}`);
      }
      writeFileSync(join(tempDir, 'big.txt'), lines.join('\n'));

      const controller = new AbortController();
      const promise = javascriptGrepFallback(
        'abort_match',
        tempDir,
        undefined,
        controller.signal,
        100_000,
        100,
        100_000,
        ['node_modules'],
        createAggregateSemanticBudget(),
      );

      // Abort while the first file is still being streamed. The per-file
      // read stream is destroyed promptly by the abort wiring, and the glob
      // stream sees the aborted signal — the function must reject without
      // hanging or reading the entire file to EOF.
      controller.abort();
      await expect(promise).rejects.toThrow(/abort/i);
    },
    { timeout: 15000 },
  );
});

describe('grep directory partial metadata.outputTruncation consistency (issue #3202)', () => {
  let tempDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = createTempDir();
    tempDir = tmp.dir;
    cleanup = tmp.cleanup;
  });

  afterEach(() => cleanup());

  it('partial directory result (max_results+1) includes metadata.outputTruncation', async () => {
    for (let i = 0; i < 6; i++) {
      writeFileSync(join(tempDir, `f${i}.txt`), `match_line_${i}\n`);
    }

    const result = await executeGrep(createToolHost(tempDir), {
      pattern: 'match_line',
      max_results: 5,
      max_files: 100,
      max_per_file: 1,
    });

    expect(result.error).toBeUndefined();
    // The directory partial path MUST carry metadata.outputTruncation.
    expect(result.metadata).toBeDefined();
    expect(result.metadata).toHaveProperty('outputTruncation');
    expect(
      (result.metadata as Record<string, unknown>).outputTruncation,
    ).toStrictEqual({ truncated: true });
  });

  it('exact directory result does NOT include metadata.outputTruncation', async () => {
    for (let i = 0; i < 3; i++) {
      writeFileSync(join(tempDir, `f${i}.txt`), `match_line_${i}\n`);
    }

    const result = await executeGrep(createToolHost(tempDir), {
      pattern: 'match_line',
      max_results: 100,
      max_files: 100,
      max_per_file: 10,
    });

    expect(result.error).toBeUndefined();
    // An exact result should NOT carry outputTruncation metadata.
    expect(result.metadata?.outputTruncation).toBeUndefined();
  });
});

describe('grep singular wording on partial paths (issue #3202)', () => {
  let tempDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = createTempDir();
    tempDir = tmp.dir;
    cleanup = tmp.cleanup;
  });

  afterEach(() => cleanup());

  it('directory partial with 1 retained match uses singular "match" not "matches"', async () => {
    // 2 matches across 2 files with max_results=1: only 1 is retained.
    writeFileSync(join(tempDir, 'a.txt'), 'unique_line\n');
    writeFileSync(join(tempDir, 'b.txt'), 'unique_line\n');

    const result = await executeGrep(createToolHost(tempDir), {
      pattern: 'unique_line',
      max_results: 1,
      max_files: 100,
      max_per_file: 1,
    });

    const display = String(result.returnDisplay);

    // The result is partial/incomplete (2 matches found, 1 retained).
    // The display must use singular "match" when count is 1.
    expect(display).toContain('Showing 1 match');
    expect(display).not.toMatch(/Showing 1 matches/);
  });
});
