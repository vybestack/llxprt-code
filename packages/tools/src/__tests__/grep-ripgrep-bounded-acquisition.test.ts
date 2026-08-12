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

  it(
    'dominant-file maxPerFile stays bounded and reaches a later file',
    async () => {
      // File A has 500 matching lines; File B has 3 matching lines.
      // maxPerFile = 5, so File A should only contribute 5 matches.
      // File B should still be reached and contribute its 3 matches.
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
      // Both files must appear in results.
      expect(text).toContain('dominant.txt');
      expect(text).toContain('later.txt');
      // File B's matches must be present.
      expect(text).toContain('later match 1');
      expect(text).toContain('later match 3');
      // File A must not contribute more than 5 matches.
      const dominantCount = (text.match(/dominant match line/g) ?? []).length;
      expect(dominantCount).toBeLessThanOrEqual(5);
    },
    { timeout: 15000 },
  );

  it(
    'correctly parses CRLF line endings in search output',
    async () => {
      const content = 'café match\r\nworld match\r\nend';
      writeFileSync(join(tempDir, 'crlf.txt'), content);

      const result = await executeGrep(createToolHost(tempDir), {
        pattern: 'match',
        max_results: 100,
      });

      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      expect(text).toContain('café');
      expect(text).toContain('world');
      // Should not contain carriage return characters in the output.
      expect(text).not.toContain('\r');
    },
    { timeout: 15000 },
  );

  it(
    'handles multibyte UTF-8 content with exact expected characters',
    async () => {
      const content = '世界 match\nこんにちは match\nhello match';
      writeFileSync(join(tempDir, 'multibyte.txt'), content);

      const result = await executeGrep(createToolHost(tempDir), {
        pattern: 'match',
        max_results: 100,
      });

      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      expect(text).toContain('世界');
      expect(text).toContain('こんにちは');
      expect(text).not.toContain('\uFFFD');
    },
    { timeout: 15000 },
  );

  it(
    'handles one huge line within bounded memory',
    async () => {
      // One very large line that is still a valid match.
      const hugeLine = 'match ' + 'x'.repeat(100_000);
      writeFileSync(join(tempDir, 'huge.txt'), hugeLine);

      const result = await executeGrep(createToolHost(tempDir), {
        pattern: 'match',
        max_results: 100,
      });

      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      expect(text).toContain('huge.txt');
    },
    { timeout: 15000 },
  );

  it(
    'handles many small interleaved output producers across files',
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
      // All 20 files should have matches.
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

  it(
    'finds matches via git-grep in a real repository',
    async () => {
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

      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      expect(text).toContain('tracked.ts');
      expect(text).toContain('target_match');
      expect(text).not.toContain('unrelated');
    },
    { timeout: 15000 },
  );

  it(
    'abort does not trigger fallback — returns cancellation, not grep error',
    async () => {
      // Create many files with many matching lines so git grep takes time.
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
      // Must be cancellation, not a system-grep fallback error.
      expect(text).toMatch(/cancel|abort/i);
      // Must NOT contain evidence of fallback strategy execution.
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

  it(
    'grep with limited results uses "Showing" not "Found N total" wording',
    async () => {
      // Create enough files/matches to trigger max_results limiting.
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
      expect(result.error).toBeUndefined();
      expect(text).toMatch(
        /^(Showing \d+ matches|Found \d+ total matches, showing \d+)/m,
      );
      expect(text).not.toMatch(/^Found \d+ matches?$/m);
    },
    { timeout: 15000 },
  );

  it(
    'grep returns correct no-match wording for exhaustive search',
    async () => {
      writeFileSync(join(tempDir, 'test.txt'), 'hello world\nfoo bar');

      const result = await executeGrep(createToolHost(tempDir), {
        pattern: 'nonexistent',
        max_results: 100,
      });

      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
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

  it(
    'correctly parses CRLF line endings',
    async () => {
      const content = 'hello match\r\nworld match\r\nend';
      writeFileSync(join(tempDir, 'crlf.txt'), content);

      const result = await executeRipgrep(createToolHost(tempDir), {
        pattern: 'match',
      });

      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      expect(text).toContain('hello');
      expect(text).toContain('world');
      expect(text).not.toContain('\r');
    },
    { timeout: 15000 },
  );

  it(
    'handles multibyte UTF-8 content with exact expected characters',
    async () => {
      const content = '世界 match\n안녕 match\nhello match';
      writeFileSync(join(tempDir, 'multibyte.txt'), content);

      const result = await executeRipgrep(createToolHost(tempDir), {
        pattern: 'match',
      });

      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      expect(text).toContain('世界');
      expect(text).toContain('안녕');
      expect(text).not.toContain('\uFFFD');
    },
    { timeout: 15000 },
  );

  it(
    'stops early when match count exceeds the limit and uses incomplete wording',
    async () => {
      // Create a file with 25000 matching lines — exceeds DEFAULT_TOTAL_MAX_MATCHES (20000)
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
      // Must indicate incomplete results.
      expect(text).toMatch(/incomplete|showing/i);
      // Must NOT claim the full 25000 count.
      expect(text).not.toContain('25000');
      // Must NOT say "Found 20000 matches" as if exhaustive.
      expect(text).not.toMatch(/^Found 20000 matches?$/m);
    },
    { timeout: 30000 },
  );

  it(
    'returns exact no-match wording for exhaustive search',
    async () => {
      writeFileSync(join(tempDir, 'test.txt'), 'hello world\nfoo bar');

      const result = await executeRipgrep(createToolHost(tempDir), {
        pattern: 'nonexistent',
      });

      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      expect(text).toContain('No matches');
    },
    { timeout: 15000 },
  );

  it(
    'handles one huge line within bounded memory',
    async () => {
      const hugeLine = 'match ' + 'x'.repeat(100_000);
      writeFileSync(join(tempDir, 'huge.txt'), hugeLine);

      const result = await executeRipgrep(createToolHost(tempDir), {
        pattern: 'match',
      });

      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      expect(text).toContain('huge.txt');
    },
    { timeout: 15000 },
  );

  it(
    'handles many small interleaved files',
    async () => {
      for (let i = 0; i < 20; i++) {
        writeFileSync(
          join(tempDir, `f${i}.ts`),
          `line match ${i}\nother\nanother match ${i}`,
        );
      }

      const result = await executeRipgrep(createToolHost(tempDir), {
        pattern: 'match',
      });

      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
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

  it(
    'ripgrep retains bounded match bytes when lines are very long',
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
      expect(text).toMatch(/incomplete|limited|truncated/i);
      expect(text).not.toMatch(/200 (total )?match/);
    },
    { timeout: 30000 },
  );

  it(
    'grep retains bounded match bytes when lines are very long',
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
      // Retained match bytes must be bounded — either the semantic budget
      // stopped early (Showing/incomplete wording) or the token limiter
      // caught the bounded output. Either way, must NOT claim all 200
      // matches were found exhaustively.
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
    it(`rejects max_results=${label}`, async () => {
      const result = await executeGrep(createToolHost(tempDir), {
        pattern: 'match',
        max_results: value as number,
      });
      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      expect(result.error !== undefined || text).toBeTruthy();
      expect(text).toMatch(
        /finite positive integer|must be number|must be >= 1|exceeds the maximum|invalid/i,
      );
    });

    it(`rejects max_files=${label}`, async () => {
      const result = await executeGrep(createToolHost(tempDir), {
        pattern: 'match',
        max_files: value as number,
      });
      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      expect(result.error !== undefined || text).toBeTruthy();
      expect(text).toMatch(
        /finite positive integer|must be number|must be >= 1|exceeds the maximum|invalid/i,
      );
    });

    it(`rejects max_per_file=${label}`, async () => {
      const result = await executeGrep(createToolHost(tempDir), {
        pattern: 'match',
        max_per_file: value as number,
      });
      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      expect(result.error !== undefined || text).toBeTruthy();
      expect(text).toMatch(
        /finite positive integer|must be number|must be >= 1|exceeds the maximum|invalid/i,
      );
    });

    it(`rejects timeout_ms=${label}`, async () => {
      const result = await executeGrep(createToolHost(tempDir), {
        pattern: 'match',
        timeout_ms: value as number,
      });
      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      expect(result.error !== undefined || text).toBeTruthy();
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

  it(
    'reports exact observed total when producer is fully consumed with per-file limiting',
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
      expect(result.error).toBeUndefined();
      expect(text).toContain('dominant.txt');
      const dominantCount = (text.match(/match line/g) ?? []).length;
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

  it(
    'remains under the aggregate semantic budget across 6 workspace directories',
    async () => {
      const dirs: string[] = [];
      for (let i = 0; i < 6; i++) {
        const dir = join(tempDir, `ws${i}`);
        mkdirSync(dir, { recursive: true });
        const longLine = 'X'.repeat(900_000);
        writeFileSync(join(dir, `f${i}.txt`), `matchprefix${longLine}\n`);
        dirs.push(dir);
      }

      const host: IToolHost = {
        ...createToolHost(tempDir),
        getWorkspaceRoots: () => dirs,
      };

      const result = await executeGrep(host, {
        pattern: 'matchprefix',
        max_results: 10000,
      });

      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
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

  it(
    'remains under the aggregate semantic budget across 6 workspace directories',
    async () => {
      const dirs: string[] = [];
      for (let i = 0; i < 6; i++) {
        const dir = join(tempDir, `ws${i}`);
        mkdirSync(dir, { recursive: true });
        const longLine = 'X'.repeat(900_000);
        writeFileSync(join(dir, `f${i}.txt`), `matchprefix${longLine}\n`);
        dirs.push(dir);
      }

      const host: IToolHost = {
        ...createToolHost(tempDir),
        getWorkspaceRoots: () => dirs,
      };

      const result = await executeRipgrep(host, {
        pattern: 'matchprefix',
      });

      const text =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      expect(text).toMatch(/incomplete|showing|limited/i);
      expect(text).not.toContain('Found 6 matches');
    },
    { timeout: 30000 },
  );
});
