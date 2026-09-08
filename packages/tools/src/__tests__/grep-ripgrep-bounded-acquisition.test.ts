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

const countMatches = (value: string, pattern: RegExp): number =>
  (value.match(pattern) ?? []).length;

function hasErrorOrText(result: ToolResult, text: string): boolean {
  return result.error !== undefined || text.length > 0;
}

function createBudgetWorkspaceDirectories(root: string): string[] {
  const directories: string[] = [];
  for (let index = 0; index < 6; index++) {
    const directory = join(root, `ws${index}`);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, `f${index}.txt`),
      `matchprefix${'X'.repeat(900_000)}\n`,
    );
    directories.push(directory);
  }
  return directories;
}

function createTempDir(prefix = 'llxprt-grep-bounded-'): {
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

const gitAdd = (dir: string): void =>
  void execSync('git add -A', { cwd: dir, stdio: 'ignore' });

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
  signal?: AbortSignal,
): Promise<ToolResult> {
  const tool = new GrepTool(host);
  try {
    return await tool
      .build(params)
      .execute(signal ?? new AbortController().signal);
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

describe('Grep bounded acquisition and early stop', () => {
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

  const observeDominantFileMaxPerFileStaysBoundedAndReachesALaterFileAt129 =
    async () => {
      const linesA = Array.from(
        { length: 500 },
        (_, i) => `dominant match line ${i}`,
      ).join('\n');
      writeFileSync(join(tempDir, 'dominant.txt'), linesA);
      writeFileSync(
        join(tempDir, 'later.txt'),
        'later match 1\nlater match 2\nlater match 3',
      );
      const result = await executeGrep(createToolHost(tempDir), {
        pattern: 'match',
        max_results: 100,
        max_files: 100,
        max_per_file: 5,
      });
      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      return { text };
    };

  it(
    'dominant-file maxPerFile stays bounded and reaches a later file',
    async () => {
      const { text } =
        await observeDominantFileMaxPerFileStaysBoundedAndReachesALaterFileAt129();
      expect(text).toContain('dominant.txt');
      expect(text).toContain('later.txt');
      expect(text).toContain('later match 1');
      expect(text).toContain('later match 3');
      const dominantCount = countMatches(text, /dominant match line/g);
      expect(dominantCount).toBeLessThanOrEqual(5);
    },
    { timeout: 15000 },
  );

  const observeCorrectlyParsesCRLFLineEndingsInSearchOutputAt167 = async () => {
    const content = 'café match\r\nworld match\r\nend';
    writeFileSync(join(tempDir, 'crlf.txt'), content);
    const result = await executeGrep(createToolHost(tempDir), {
      pattern: 'match',
      max_results: 100,
    });
    const text = typeof result.llmContent === 'string' ? result.llmContent : '';
    return { text };
  };

  it(
    'correctly parses CRLF line endings in search output',
    async () => {
      const { text } =
        await observeCorrectlyParsesCRLFLineEndingsInSearchOutputAt167();
      expect(text).toContain('café');
      expect(text).toContain('world');
      expect(text).not.toContain('\r');
    },
    { timeout: 15000 },
  );

  const observeHandlesMultibyteUTF8ContentWithExactExpectedCharactersAt188 =
    async () => {
      const content = '世界 match\nこんにちは match\nhello match';
      writeFileSync(join(tempDir, 'multibyte.txt'), content);
      const result = await executeGrep(createToolHost(tempDir), {
        pattern: 'match',
        max_results: 100,
      });
      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      return { text };
    };

  it(
    'handles multibyte UTF-8 content with exact expected characters',
    async () => {
      const { text } =
        await observeHandlesMultibyteUTF8ContentWithExactExpectedCharactersAt188();
      expect(text).toContain('世界');
      expect(text).toContain('こんにちは');
      expect(text).not.toContain('\uFFFD');
    },
    { timeout: 15000 },
  );

  const observeHandlesOneHugeLineWithinBoundedMemoryAt208 = async () => {
    const hugeLine = 'match ' + 'x'.repeat(100_000);
    writeFileSync(join(tempDir, 'huge.txt'), hugeLine);
    const result = await executeGrep(createToolHost(tempDir), {
      pattern: 'match',
      max_results: 100,
    });
    const text = typeof result.llmContent === 'string' ? result.llmContent : '';
    return { text };
  };

  it(
    'handles one huge line within bounded memory',
    async () => {
      const { text } =
        await observeHandlesOneHugeLineWithinBoundedMemoryAt208();
      expect(text).toContain('huge.txt');
    },
    { timeout: 15000 },
  );

  const observeHandlesManySmallInterleavedOutputProducersAcrossFilesAt227 =
    async () => {
      for (let i = 0; i < 20; i++) {
        writeFileSync(
          join(tempDir, `f${i}.ts`),
          `line match ${i}\nother line\nanother match ${i}`,
        );
      }
      const result = await executeGrep(createToolHost(tempDir), {
        pattern: 'match',
        max_results: 100,
        max_files: 100,
      });
      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      return { text };
    };

  it(
    'handles many small interleaved output producers across files',
    async () => {
      const { text } =
        await observeHandlesManySmallInterleavedOutputProducersAcrossFilesAt227();
      for (let i = 0; i < 20; i++) {
        expect(text).toContain(`f${i}.ts`);
      }
    },
    { timeout: 15000 },
  );
});

describe('Git-grep with a real temporary git repository', () => {
  let tempDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = createTempDir('llxprt-gitgrep-');
    tempDir = tmp.dir;
    cleanup = tmp.cleanup;
    initGitRepo(tempDir);
  });

  afterEach(() => {
    cleanup();
  });

  const observeFindsMatchesViaGitGrepInARealRepositoryAt269 = async () => {
    writeFileSync(
      join(tempDir, 'tracked.ts'),
      'function target_match() {\n  return 1;\n}\n',
    );
    writeFileSync(join(tempDir, 'other.ts'), 'const x = "unrelated";\n');
    gitAdd(tempDir);
    const result = await executeGrep(createToolHost(tempDir), {
      pattern: 'target_match',
      max_results: 100,
    });
    const text = typeof result.llmContent === 'string' ? result.llmContent : '';
    return { text };
  };

  it(
    'finds matches via git-grep in a real repository',
    async () => {
      const { text } =
        await observeFindsMatchesViaGitGrepInARealRepositoryAt269();
      expect(text).toContain('tracked.ts');
      expect(text).toContain('target_match');
      expect(text).not.toContain('unrelated');
    },
    { timeout: 15000 },
  );

  const observeAbortDoesNotTriggerFallbackReturnsCancellationNotGrepErrorAt293 =
    async () => {
      for (let i = 0; i < 200; i++) {
        const lines: string[] = [];
        for (let j = 0; j < 100; j++) {
          lines.push(`match content ${i}_${j}`);
        }
        writeFileSync(join(tempDir, `f${i}.ts`), lines.join('\n'));
      }
      gitAdd(tempDir);
      const controller = new AbortController();
      const executePromise = executeGrep(
        createToolHost(tempDir),
        { pattern: 'match', max_results: 50000 },
        controller.signal,
      );
      setTimeout(() => controller.abort(), 10);
      const result = await executePromise;
      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      return { text };
    };

  it(
    'abort does not trigger fallback — returns cancellation, not grep error',
    async () => {
      const { text } =
        await observeAbortDoesNotTriggerFallbackReturnsCancellationNotGrepErrorAt293();
      expect(text).toMatch(/cancel|abort/i);
      expect(text).not.toMatch(/system grep|javascript fallback|grep failed/i);
    },
    { timeout: 30000 },
  );
});

describe('Incomplete output never uses exact/exhaustive wording', () => {
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

  const observeGrepWithLimitedResultsUsesShowingNotFoundNTotalWordingAt341 =
    async () => {
      for (let i = 0; i < 50; i++) {
        writeFileSync(
          join(tempDir, `file${i}.txt`),
          `match content ${i}\nsecond match ${i}`,
        );
      }
      const result = await executeGrep(createToolHost(tempDir), {
        pattern: 'match',
        max_results: 5,
        max_files: 100,
        max_per_file: 50,
      });
      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      return { result, text };
    };

  it(
    'grep with limited results uses "Showing" not "Found N total" wording',
    async () => {
      const { result, text } =
        await observeGrepWithLimitedResultsUsesShowingNotFoundNTotalWordingAt341();
      expect(result.error).toBeUndefined();
      expect(text).toMatch(
        /^(Showing \d+ matches|Found \d+ total matches, showing \d+)/m,
      );
      expect(text).not.toMatch(/^Found \d+ matches?$/m);
    },
    { timeout: 15000 },
  );

  const observeGrepReturnsCorrectNoMatchWordingForExhaustiveSearchAt370 =
    async () => {
      writeFileSync(join(tempDir, 'test.txt'), 'hello world\nfoo bar');
      const result = await executeGrep(createToolHost(tempDir), {
        pattern: 'nonexistent',
        max_results: 100,
      });
      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      return { text };
    };

  it(
    'grep returns correct no-match wording for exhaustive search',
    async () => {
      const { text } =
        await observeGrepReturnsCorrectNoMatchWordingForExhaustiveSearchAt370();
      expect(text).toContain('No matches found');
    },
    { timeout: 15000 },
  );
});

describe('Ripgrep bounded acquisition and early stop', () => {
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

  const observeCorrectlyParsesCRLFLineEndingsAt402 = async () => {
    const content = 'hello match\r\nworld match\r\nend';
    writeFileSync(join(tempDir, 'crlf.txt'), content);
    const result = await executeRipgrep(createToolHost(tempDir), {
      pattern: 'match',
    });
    const text = typeof result.llmContent === 'string' ? result.llmContent : '';
    return { text };
  };

  it(
    'correctly parses CRLF line endings',
    async () => {
      const { text } = await observeCorrectlyParsesCRLFLineEndingsAt402();
      expect(text).toContain('hello');
      expect(text).toContain('world');
      expect(text).not.toContain('\r');
    },
    { timeout: 15000 },
  );

  const observeHandlesMultibyteUTF8ContentWithExactExpectedCharactersAt421 =
    async () => {
      const content = '世界 match\n안녕 match\nhello match';
      writeFileSync(join(tempDir, 'multibyte.txt'), content);
      const result = await executeRipgrep(createToolHost(tempDir), {
        pattern: 'match',
      });
      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      return { text };
    };

  it(
    'handles multibyte UTF-8 content with exact expected characters',
    async () => {
      const { text } =
        await observeHandlesMultibyteUTF8ContentWithExactExpectedCharactersAt421();
      expect(text).toContain('世界');
      expect(text).toContain('안녕');
      expect(text).not.toContain('\uFFFD');
    },
    { timeout: 15000 },
  );

  const observeStopsEarlyWhenMatchCountExceedsTheLimitAndUsesIncompleteWordingAt440 =
    async () => {
      const lines: string[] = [];
      for (let i = 0; i < 25000; i++) {
        lines.push(`matchline${i}`);
      }
      writeFileSync(join(tempDir, 'huge.txt'), lines.join('\n'));
      const result = await executeRipgrep(createToolHost(tempDir), {
        pattern: 'matchline',
      });
      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      return { text };
    };

  it(
    'stops early when match count exceeds the limit and uses incomplete wording',
    async () => {
      const { text } =
        await observeStopsEarlyWhenMatchCountExceedsTheLimitAndUsesIncompleteWordingAt440();
      expect(text).toMatch(/incomplete|showing/i);
      expect(text).not.toContain('25000');
      expect(text).not.toMatch(/^Found 20000 matches?$/m);
    },
    { timeout: 30000 },
  );

  const observeReturnsExactNoMatchWordingForExhaustiveSearchAt466 =
    async () => {
      writeFileSync(join(tempDir, 'test.txt'), 'hello world\nfoo bar');
      const result = await executeRipgrep(createToolHost(tempDir), {
        pattern: 'nonexistent',
      });
      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      return { text };
    };

  it(
    'returns exact no-match wording for exhaustive search',
    async () => {
      const { text } =
        await observeReturnsExactNoMatchWordingForExhaustiveSearchAt466();
      expect(text).toContain('No matches');
    },
    { timeout: 15000 },
  );

  const observeHandlesOneHugeLineWithinBoundedMemoryAt482 = async () => {
    const hugeLine = 'match ' + 'x'.repeat(100_000);
    writeFileSync(join(tempDir, 'huge.txt'), hugeLine);
    const result = await executeRipgrep(createToolHost(tempDir), {
      pattern: 'match',
    });
    const text = typeof result.llmContent === 'string' ? result.llmContent : '';
    return { text };
  };

  it(
    'handles one huge line within bounded memory',
    async () => {
      const { text } =
        await observeHandlesOneHugeLineWithinBoundedMemoryAt482();
      expect(text).toContain('huge.txt');
    },
    { timeout: 15000 },
  );

  const observeHandlesManySmallInterleavedFilesAt499 = async () => {
    for (let i = 0; i < 20; i++) {
      writeFileSync(
        join(tempDir, `f${i}.ts`),
        `line match ${i}\nother\nanother match ${i}`,
      );
    }
    const result = await executeRipgrep(createToolHost(tempDir), {
      pattern: 'match',
    });
    const text = typeof result.llmContent === 'string' ? result.llmContent : '';
    return { text };
  };

  it(
    'handles many small interleaved files',
    async () => {
      const { text } = await observeHandlesManySmallInterleavedFilesAt499();
      for (let i = 0; i < 20; i++) {
        expect(text).toContain(`f${i}.ts`);
      }
    },
    { timeout: 15000 },
  );
});

describe('Retained match bytes are bounded for huge matched lines', () => {
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

  const observeRipgrepRetainsBoundedMatchBytesWhenLinesAreVeryLongAt537 =
    async () => {
      const longLine = 'X'.repeat(100 * 1024);
      const lines: string[] = [];
      for (let i = 0; i < 200; i++) {
        lines.push(`matchprefix${longLine}`);
      }
      writeFileSync(join(tempDir, 'huge_matches.txt'), lines.join('\n'));
      const result = await executeRipgrep(createToolHost(tempDir), {
        pattern: 'matchprefix',
      });
      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      return { text };
    };

  it(
    'ripgrep retains bounded match bytes when lines are very long',
    async () => {
      const { text } =
        await observeRipgrepRetainsBoundedMatchBytesWhenLinesAreVeryLongAt537();
      expect(text).toMatch(/incomplete|limited|truncated/i);
      expect(text).not.toMatch(/200 (total )?match/);
    },
    { timeout: 30000 },
  );

  const observeGrepRetainsBoundedMatchBytesWhenLinesAreVeryLongAt559 =
    async () => {
      const longLine = 'Y'.repeat(100 * 1024);
      const lines: string[] = [];
      for (let i = 0; i < 200; i++) {
        lines.push(`grepword${longLine}`);
      }
      writeFileSync(join(tempDir, 'huge_matches.txt'), lines.join('\n'));
      initGitRepo(tempDir);
      gitAdd(tempDir);
      const result = await executeGrep(createToolHost(tempDir), {
        pattern: 'grepword',
        max_results: 1000,
      });
      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      return { text };
    };

  it(
    'grep retains bounded match bytes when lines are very long',
    async () => {
      const { text } =
        await observeGrepRetainsBoundedMatchBytesWhenLinesAreVeryLongAt559();
      expect(text).toMatch(
        /incomplete|limited|showing|too large|exceeded token/i,
      );
      expect(text).not.toContain('Found 200 matches');
    },
    { timeout: 30000 },
  );
});

describe('Grep limit validation rejects invalid values (C.3)', () => {
  let tempDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = createTempDir();
    tempDir = tmp.dir;
    cleanup = tmp.cleanup;
    writeFileSync(join(tempDir, 'test.txt'), 'match\nmatch\n');
  });

  afterEach(() => {
    cleanup();
  });

  const invalidValues: Array<[string, unknown]> = [
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
  ];

  for (const [label, value] of invalidValues) {
    const observeRejectsMaxResultsLabelAt616 = async () => {
      const result = await executeGrep(createToolHost(tempDir), {
        pattern: 'match',
        max_results: value as number,
      });
      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      return { result, text };
    };

    it(`rejects max_results=${label}`, async () => {
      const { result, text } = await observeRejectsMaxResultsLabelAt616();
      expect(hasErrorOrText(result, text)).toBe(true);
      expect(text).toMatch(
        /finite positive integer|must be number|must be >= 1|exceeds the maximum|invalid/i,
      );
    });

    const observeRejectsMaxFilesLabelAt629 = async () => {
      const result = await executeGrep(createToolHost(tempDir), {
        pattern: 'match',
        max_files: value as number,
      });
      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      return { result, text };
    };

    it(`rejects max_files=${label}`, async () => {
      const { result, text } = await observeRejectsMaxFilesLabelAt629();
      expect(hasErrorOrText(result, text)).toBe(true);
      expect(text).toMatch(
        /finite positive integer|must be number|must be >= 1|exceeds the maximum|invalid/i,
      );
    });

    const observeRejectsMaxPerFileLabelAt642 = async () => {
      const result = await executeGrep(createToolHost(tempDir), {
        pattern: 'match',
        max_per_file: value as number,
      });
      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      return { result, text };
    };

    it(`rejects max_per_file=${label}`, async () => {
      const { result, text } = await observeRejectsMaxPerFileLabelAt642();
      expect(hasErrorOrText(result, text)).toBe(true);
      expect(text).toMatch(
        /finite positive integer|must be number|must be >= 1|exceeds the maximum|invalid/i,
      );
    });

    const observeRejectsTimeoutMsLabelAt655 = async () => {
      const result = await executeGrep(createToolHost(tempDir), {
        pattern: 'match',
        timeout_ms: value as number,
      });
      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      return { result, text };
    };

    it(`rejects timeout_ms=${label}`, async () => {
      const { result, text } = await observeRejectsTimeoutMsLabelAt655();
      expect(hasErrorOrText(result, text)).toBe(true);
      expect(text).toMatch(
        /finite positive integer|must be number|must be >= 1|exceeds the maximum|invalid/i,
      );
    });
  }
});

describe('Grep maxPerFile exact total tracking (C.1)', () => {
  let tempDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = createTempDir('llxprt-exact-total-');
    tempDir = tmp.dir;
    cleanup = tmp.cleanup;
    initGitRepo(tempDir);
  });

  afterEach(() => {
    cleanup();
  });

  const observeReportsExactObservedTotalWhenProducerIsFullyConsumedWithPerFileLimitingAt685 =
    async () => {
      const lines = Array.from(
        { length: 20 },
        (_, i) => `match line ${i}`,
      ).join('\n');
      writeFileSync(join(tempDir, 'dominant.txt'), lines);
      gitAdd(tempDir);
      const result = await executeGrep(createToolHost(tempDir), {
        pattern: 'match',
        max_results: 1000,
        max_files: 100,
        max_per_file: 5,
      });
      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      return { result, text };
    };

  it(
    'reports exact observed total when producer is fully consumed with per-file limiting',
    async () => {
      const { result, text } =
        await observeReportsExactObservedTotalWhenProducerIsFullyConsumedWithPerFileLimitingAt685();
      expect(result.error).toBeUndefined();
      expect(text).toContain('dominant.txt');
      const dominantCount = countMatches(text, /match line/g);
      expect(dominantCount).toBe(5);
      expect(text).toContain('Found 20 total');
      expect(text).toContain('showing 5');
    },
    { timeout: 15000 },
  );
});

describe('Grep aggregate budget across multiple workspaces (C.2, C.4)', () => {
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

  const observeRemainsUnderTheAggregateSemanticBudgetAcross6WorkspaceDirectoriesAt729 =
    async () => {
      const directories = createBudgetWorkspaceDirectories(tempDir);
      const host: IToolHost = {
        ...createToolHost(tempDir),
        getWorkspaceRoots: () => directories,
      };
      const result = await executeGrep(host, {
        pattern: 'matchprefix',
        max_results: 10000,
      });
      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      return { text };
    };

  it(
    'remains under the aggregate semantic budget across 6 workspace directories',
    async () => {
      const { text } =
        await observeRemainsUnderTheAggregateSemanticBudgetAcross6WorkspaceDirectoriesAt729();
      expect(text).toMatch(
        /incomplete|showing|limited|exceeded token|too large/i,
      );
      expect(text).not.toContain('Found 6 matches');
    },
    { timeout: 30000 },
  );
});

describe('Ripgrep aggregate budget across multiple workspaces (C.2, C.4)', () => {
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

  const observeRemainsUnderTheAggregateSemanticBudgetAcross6WorkspaceDirectoriesAt776 =
    async () => {
      const directories = createBudgetWorkspaceDirectories(tempDir);
      const host: IToolHost = {
        ...createToolHost(tempDir),
        getWorkspaceRoots: () => directories,
      };
      const result = await executeRipgrep(host, {
        pattern: 'matchprefix',
      });
      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      return { text };
    };

  it(
    'remains under the aggregate semantic budget across 6 workspace directories',
    async () => {
      const { text } =
        await observeRemainsUnderTheAggregateSemanticBudgetAcross6WorkspaceDirectoriesAt776();
      expect(text).toMatch(/incomplete|showing|limited/i);
      expect(text).not.toContain('Found 6 matches');
    },
    { timeout: 30000 },
  );
});
