/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { performSingleFileSearch } from './single-file-search.js';
import { createAggregateSemanticBudget } from './grepBudget.js';

function createTempDir(prefix = 'llxprt-single-file-stream-'): {
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

describe('performSingleFileSearch — streaming acquisition', () => {
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

  it('reads all matches from a normal file', async () => {
    writeFileSync(join(tempDir, 'test.txt'), 'hello match\nworld\nfoo match\n');

    const result = await performSingleFileSearch(
      'match',
      join(tempDir, 'test.txt'),
      new AbortController().signal,
    );

    expect(result.matches).toHaveLength(2);
    expect(result.matches[0].lineNumber).toBe(1);
    expect(result.matches[1].lineNumber).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it('handles CRLF line endings correctly', async () => {
    writeFileSync(
      join(tempDir, 'crlf.txt'),
      'hello match\r\nworld\r\nfoo match\r\n',
    );

    const result = await performSingleFileSearch(
      'match',
      join(tempDir, 'crlf.txt'),
      new AbortController().signal,
    );

    expect(result.matches).toHaveLength(2);
    // Lines should not contain carriage returns.
    for (const match of result.matches) {
      expect(match.line).not.toContain('\r');
    }
  });

  it('handles multibyte UTF-8 content', async () => {
    writeFileSync(
      join(tempDir, 'mb.txt'),
      '世界 match\nこんにちは match\nhello\n',
    );

    const result = await performSingleFileSearch(
      'match',
      join(tempDir, 'mb.txt'),
      new AbortController().signal,
    );

    expect(result.matches).toHaveLength(2);
    expect(result.matches[0].line).toContain('世界');
    expect(result.matches[1].line).toContain('こんにちは');
  });

  it('does not materialize a huge line into memory (bounded by line framer)', async () => {
    // A single line of 5 MiB — far exceeding the default 1 MiB max line.
    const hugeLine = 'match ' + 'x'.repeat(5 * 1024 * 1024);
    writeFileSync(join(tempDir, 'huge.txt'), hugeLine);

    const result = await performSingleFileSearch(
      'match',
      join(tempDir, 'huge.txt'),
      new AbortController().signal,
    );

    // The overlong line is dropped by the line framer, so no match is retained.
    expect(result.matches).toHaveLength(0);
    // Line drop must be reported so the result is not presented as exhaustive.
    expect(result.lineDropped).toBe(true);
  });

  it('returns no matches for a non-matching pattern', async () => {
    writeFileSync(join(tempDir, 'test.txt'), 'hello\nworld\n');

    const result = await performSingleFileSearch(
      'nonexistent',
      join(tempDir, 'test.txt'),
      new AbortController().signal,
    );

    expect(result.matches).toHaveLength(0);
    expect(result.truncated).toBe(false);
  });

  it('truncates when record budget is exceeded (one-over sentinel)', async () => {
    // Create 100 matching lines.
    const lines = Array.from({ length: 100 }, (_, i) => `match line ${i}`).join(
      '\n',
    );
    writeFileSync(join(tempDir, 'many.txt'), lines);

    const budget = createAggregateSemanticBudget();
    const result = await performSingleFileSearch(
      'match',
      join(tempDir, 'many.txt'),
      new AbortController().signal,
      { maxResults: 10, maxPerFile: 10 },
      budget,
    );

    // Must retain at most 10 matches.
    expect(result.matches.length).toBeLessThanOrEqual(10);
    // must indicate truncation.
    expect(result.truncated).toBe(true);
    // observedCount must be greater than retained matches.
    expect(result.observedCount).toBeGreaterThan(result.matches.length);
  });

  it('truncates when byte budget is exhausted', async () => {
    // Create lines where each match is large enough to exhaust the budget.
    const longLine = 'match ' + 'Y'.repeat(10_000);
    const lines = Array.from({ length: 100 }, () => longLine).join('\n');
    writeFileSync(join(tempDir, 'big-matches.txt'), lines);

    // Give a tiny byte budget so only a few matches can be retained.
    const budget = createAggregateSemanticBudget();
    budget.remainingBytes = 5000;
    const result = await performSingleFileSearch(
      'match',
      join(tempDir, 'big-matches.txt'),
      new AbortController().signal,
      { maxResults: 1000, maxPerFile: 1000 },
      budget,
    );

    expect(result.truncated).toBe(true);
    expect(result.matches.length).toBeLessThan(100);
  });

  it('reports observedCount for exact tracking', async () => {
    writeFileSync(join(tempDir, 'test.txt'), 'match\nmatch\nmatch\n');

    const result = await performSingleFileSearch(
      'match',
      join(tempDir, 'test.txt'),
      new AbortController().signal,
    );

    expect(result.observedCount).toBe(3);
    expect(result.matches).toHaveLength(3);
    expect(result.truncated).toBe(false);
  });

  it('respects an already-aborted signal', async () => {
    writeFileSync(join(tempDir, 'test.txt'), 'match\nmatch\n');
    const controller = new AbortController();
    controller.abort();

    const result = await performSingleFileSearch(
      'match',
      join(tempDir, 'test.txt'),
      controller.signal,
    );

    // Pre-aborted acquisition is explicit partial/aborted metadata: no file
    // content was observed, and the result must not present as exhaustive.
    expect(result.matches).toHaveLength(0);
    expect(result.truncated).toBe(true);
    expect(result.sourcePartial).toBe(true);
  });

  it('streams a large file without materializing it whole', async () => {
    // Create a 2 MiB file with many matching lines.
    const lines: string[] = [];
    for (let i = 0; i < 20_000; i++) {
      lines.push(`match line ${i}`);
    }
    const filePath = join(tempDir, 'large.txt');
    writeFileSync(filePath, lines.join('\n'));
    const fileSize = statSync(filePath).size;

    const result = await performSingleFileSearch(
      'match',
      filePath,
      new AbortController().signal,
      { maxResults: 50, maxPerFile: 50 },
    );

    // Retained matches must be bounded.
    expect(result.matches.length).toBeLessThanOrEqual(50);
    expect(result.truncated).toBe(true);
    // The file is much larger than what we retained.
    expect(fileSize).toBeGreaterThan(result.matches.length * 100);
  });
});

describe('performSingleFileSearch — source-observation byte budget (issue #3202)', () => {
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

  it('charges every source chunk with one-over even when no matches', async () => {
    // 100 KiB of non-matching content, far above a small source budget.
    const noMatch = Array.from(
      { length: 2000 },
      () => 'nomatch line padding',
    ).join('\n');
    writeFileSync(join(tempDir, 'big.txt'), noMatch);

    const budget = createAggregateSemanticBudget();
    const result = await performSingleFileSearch(
      'zzz-no-such-pattern',
      join(tempDir, 'big.txt'),
      new AbortController().signal,
      { maxResults: 1000, maxPerFile: 1000, sourceBudgetBytes: 4096 },
      budget,
    );

    // Zero matches but the source budget must still be enforced: the result
    // is partial (truncated), proving the file was not exhaustively read.
    expect(result.matches).toHaveLength(0);
    expect(result.truncated).toBe(true);
  });

  it('stays complete when the source fits exactly within the budget', async () => {
    writeFileSync(join(tempDir, 'fit.txt'), 'match a\nmatch b\nmatch c\n');

    const budget = createAggregateSemanticBudget();
    const result = await performSingleFileSearch(
      'match',
      join(tempDir, 'fit.txt'),
      new AbortController().signal,
      { maxResults: 1000, maxPerFile: 1000, sourceBudgetBytes: 4096 },
      budget,
    );

    expect(result.matches).toHaveLength(3);
    expect(result.truncated).toBe(false);
  });
});

describe('performSingleFileSearch — invocation limits exact/one-over (issue #3202)', () => {
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

  it('exact maxResults stays complete', async () => {
    writeFileSync(
      join(tempDir, 'exact.txt'),
      'match\nmatch\nmatch\nmatch\nmatch\n',
    );

    const result = await performSingleFileSearch(
      'match',
      join(tempDir, 'exact.txt'),
      new AbortController().signal,
      { maxResults: 5, maxPerFile: 5, sourceBudgetBytes: 1_000_000 },
    );

    expect(result.matches).toHaveLength(5);
    expect(result.truncated).toBe(false);
    expect(result.observedCount).toBe(5);
  });

  it('one-over maxResults marks partial', async () => {
    writeFileSync(
      join(tempDir, 'over.txt'),
      'match\nmatch\nmatch\nmatch\nmatch\n',
    );

    const result = await performSingleFileSearch(
      'match',
      join(tempDir, 'over.txt'),
      new AbortController().signal,
      { maxResults: 3, maxPerFile: 10, sourceBudgetBytes: 1_000_000 },
    );

    expect(result.matches.length).toBeLessThanOrEqual(3);
    expect(result.truncated).toBe(true);
    expect(result.observedCount).toBeGreaterThan(result.matches.length);
    expect(result.sourcePartial).toBe(true);
  });
});

describe('performSingleFileSearch — guarded settlement (issue #3202)', () => {
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

  it('mid-read abort resolves as partial rather than rejecting', async () => {
    const big = Array.from({ length: 50000 }, (_, i) => 'match line ' + i).join(
      '\n',
    );
    writeFileSync(join(tempDir, 'stream.txt'), big);

    const controller = new AbortController();
    const promise = performSingleFileSearch(
      'match',
      join(tempDir, 'stream.txt'),
      controller.signal,
      {
        maxResults: 100_000,
        maxPerFile: 100_000,
        sourceBudgetBytes: 100_000_000,
      },
    );
    // Abort synchronously before the read stream can complete.
    controller.abort();
    const result = await promise;

    // Must settle as a partial result, NOT throw.
    expect(result.truncated).toBe(true);
  });

  it('a read error on a missing file is surfaced (no double settle)', async () => {
    const result = performSingleFileSearch(
      'match',
      join(tempDir, 'does-not-exist.txt'),
      new AbortController().signal,
    );
    await expect(result).rejects.toThrow('ENOENT');
  });
});
