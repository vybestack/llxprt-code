/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  writeFileSync,
  rmSync,
  mkdtempSync,
  symlinkSync,
  mkdirSync,
} from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRealToolHost as createRealHost } from './helpers/create-real-tool-host.js';
import { ReadManyFilesTool } from '../tools/read-many-files.js';
import type { ToolResult } from '../index.js';

function createTempDir(prefix = 'llxprt-rmf-bounded-'): {
  dir: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function stringifyLlmContent(result: ToolResult): string {
  return Array.isArray(result.llmContent)
    ? result.llmContent
        .map((part) => (typeof part === 'string' ? part : JSON.stringify(part)))
        .join('\n')
    : String(result.llmContent);
}

function createHostWithSettings(
  targetDir: string,
  settings: Readonly<Record<string, unknown>>,
) {
  const baseHost = createRealHost(targetDir, {
    respectGitIgnore: true,
    respectLlxprtIgnore: true,
  });
  return {
    ...baseHost,
    getEphemeralSettings: () => ({
      ...baseHost.getEphemeralSettings(),
      ...settings,
    }),
  };
}

describe('ReadManyFiles bounded file discovery (issue #3202)', () => {
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

  it('bounds discovery at the file-count hard cap and reports partial (one-over)', async () => {
    // Create 60 files — exceeds the default max-file-count of 50.
    for (let i = 0; i < 60; i++) {
      writeFileSync(join(tempDir, `f${i}.txt`), `content ${i}\n`, 'utf-8');
    }

    const host = createHostWithSettings(tempDir, {
      'tool-output-max-items': 50,
      'tool-output-max-tokens': 1_000_000,
      'tool-output-truncate-mode': 'truncate',
    });
    const tool = new ReadManyFilesTool(host);
    const result = await tool.execute(
      { paths: ['**/*.txt'] },
      new AbortController().signal,
    );
    const text = stringifyLlmContent(result);
    const display = result.returnDisplay as string;

    // Discovery was bounded — exactly 50 files retained from 60.
    // Count separator markers to verify file count is bounded at 50.
    const fileCount = (text.match(/--- \S+[\\/]f\d+\.txt ---/g) ?? []).length;
    expect(fileCount).toBe(50);
    // The display message must indicate the result is partial, not exhaustive.
    expect(display).toMatch(/truncat|limited|exceed|skipped|more/i);
  });

  it('reads retained files in warn mode when discovery truncates but files are within cap', async () => {
    for (let i = 0; i < 60; i++) {
      writeFileSync(join(tempDir, `f${i}.txt`), `content ${i}\n`, 'utf-8');
    }

    const host = createHostWithSettings(tempDir, {
      'tool-output-max-items': 50,
      'tool-output-max-tokens': 1_000_000,
      'tool-output-truncate-mode': 'warn',
    });
    const tool = new ReadManyFilesTool(host);
    const result = await tool.execute(
      { paths: ['**/*.txt'] },
      new AbortController().signal,
    );
    const text = stringifyLlmContent(result);

    // Warn mode reads retained files (not zero content) when discovery
    // truncated but unique files are within the cap.
    expect(text).not.toMatch(/limiting|File Count Limit Exceeded/i);
    // The retained files must be read and their content present.
    const fileCount = (text.match(/content \d+/g) ?? []).length;
    expect(fileCount).toBe(50);
  });

  it('hard-clamps a huge tool-output-max-items setting', async () => {
    for (let i = 0; i < 10; i++) {
      writeFileSync(join(tempDir, `f${i}.txt`), `content ${i}\n`, 'utf-8');
    }

    // A pathological max-items setting should be hard-clamped, not honored
    // as an unbounded file budget.
    const host = createHostWithSettings(tempDir, {
      'tool-output-max-items': 999_999_999,
      'tool-output-max-tokens': 1_000_000,
    });
    const tool = new ReadManyFilesTool(host);
    const result = await tool.execute(
      { paths: ['**/*.txt'] },
      new AbortController().signal,
    );
    // All 10 files should be read (under the hard cap), so no error.
    expect(result.error).toBeUndefined();
    const text = stringifyLlmContent(result);
    expect(text).toContain('f0.txt');
    expect(text).toContain('f9.txt');
  });
});

describe('ReadManyFiles aggregate byte budget (issue #3202)', () => {
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

  it('bounds total retained bytes independent of the permissive token limit', async () => {
    // Each file is ~1 MiB. With a very high token limit, the ONLY cap should
    // be the aggregate acquisition byte budget — the total must remain bounded.
    const big = 'A'.repeat(1024 * 1024); // 1 MiB
    for (let i = 0; i < 20; i++) {
      writeFileSync(join(tempDir, `f${i}.txt`), big, 'utf-8');
    }

    const host = createHostWithSettings(tempDir, {
      'tool-output-max-items': 50,
      'tool-output-max-tokens': 10_000_000, // very permissive
      'tool-output-truncate-mode': 'truncate',
      'tool-output-item-size-limit': 5 * 1024 * 1024, // allow each file individually
    });
    const tool = new ReadManyFilesTool(host);
    const result = await tool.execute(
      { paths: ['**/*.txt'] },
      new AbortController().signal,
    );
    const text = stringifyLlmContent(result);

    // The total content must be bounded — 20 MiB of data should NOT all
    // appear. The aggregate byte budget (several MiB) must trigger.
    expect(text.length).toBeLessThan(20 * 1024 * 1024);
    // Should indicate the result was bounded.
    expect(text).toMatch(/truncat|byte budget|exceeded|skipped|limited/i);
  });

  it('preserves per-file size gate (oversized files are skipped)', async () => {
    // A 6 MiB file exceeds the default per-file size limit (512 KB).
    const oversized = 'B'.repeat(6 * 1024 * 1024);
    writeFileSync(join(tempDir, 'big.txt'), oversized, 'utf-8');
    writeFileSync(join(tempDir, 'small.txt'), 'small content\n', 'utf-8');

    const host = createHostWithSettings(tempDir, {
      'tool-output-max-items': 50,
      'tool-output-max-tokens': 1_000_000,
    });
    const tool = new ReadManyFilesTool(host);
    const result = await tool.execute(
      { paths: ['**/*.txt'] },
      new AbortController().signal,
    );
    const text = stringifyLlmContent(result);
    const display = result.returnDisplay as string;

    // Small file is present; big file content is absent from llmContent.
    expect(text).toContain('small.txt');
    expect(text).toContain('small content');
    expect(text).not.toContain('big.txt');
    // The oversized file is reported as skipped in the display message.
    expect(display).toMatch(/big\.txt|exceeds|skipped|file size/i);
  });

  it('handles many tiny files within bounded memory', async () => {
    for (let i = 0; i < 40; i++) {
      writeFileSync(join(tempDir, `f${i}.txt`), `line ${i}\n`, 'utf-8');
    }

    const host = createHostWithSettings(tempDir, {
      'tool-output-max-items': 50,
      'tool-output-max-tokens': 50000,
    });
    const tool = new ReadManyFilesTool(host);
    const result = await tool.execute(
      { paths: ['**/*.txt'] },
      new AbortController().signal,
    );
    expect(result.error).toBeUndefined();
    const text = stringifyLlmContent(result);
    // All 40 files under the limit should be read.
    expect(text).toContain('f0.txt');
    expect(text).toContain('f39.txt');
    expect(text).toContain('line 0');
    expect(text).toContain('line 39');
  });
});

describe('ReadManyFiles discovery counts ignored and duplicate records (issue #3202)', () => {
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

  it('counts git-ignored files in discovery and reports them as skipped', async () => {
    execSync('git init', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email test@test.com', {
      cwd: tempDir,
      stdio: 'ignore',
    });
    execSync('git config user.name Test', { cwd: tempDir, stdio: 'ignore' });
    writeFileSync(join(tempDir, '.gitignore'), '*.log\n');
    writeFileSync(join(tempDir, 'readme.txt'), 'hello world\n');
    writeFileSync(join(tempDir, 'debug.log'), 'log entry\n');
    writeFileSync(join(tempDir, 'error.log'), 'error entry\n');

    const host = createHostWithSettings(tempDir, {
      'tool-output-max-items': 50,
      'tool-output-max-tokens': 1_000_000,
    });
    const tool = new ReadManyFilesTool(host);
    const result = await tool.execute(
      { paths: ['**/*'], exclude: ['.git/**'], useDefaultExcludes: false },
      new AbortController().signal,
    );
    const text = stringifyLlmContent(result);
    const display = result.returnDisplay as string;

    // The .txt file is read; .log files are skipped as git-ignored.
    expect(text).toContain('readme.txt');
    expect(text).not.toContain('debug.log');
    expect(text).not.toContain('error.log');
    // Display must report the ignored count.
    expect(display).toMatch(/git ignored/i);
  });

  it('deduplicates files discovered by overlapping glob patterns', async () => {
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(tempDir, `f${i}.txt`), `content ${i}\n`, 'utf-8');
    }

    const host = createHostWithSettings(tempDir, {
      'tool-output-max-items': 50,
      'tool-output-max-tokens': 1_000_000,
    });
    const tool = new ReadManyFilesTool(host);
    // Two overlapping patterns that match the same files.
    const result = await tool.execute(
      { paths: ['**/*.txt', 'f*.txt'] },
      new AbortController().signal,
    );
    const text = stringifyLlmContent(result);

    // Each file should appear exactly once despite overlapping patterns.
    for (let i = 0; i < 5; i++) {
      const occurrences = (text.match(new RegExp(`f${i}\\.txt`, 'g')) ?? [])
        .length;
      expect(occurrences).toBe(1);
    }
  });

  describe('ReadManyFiles security-skipped discovery metadata (issue #3202)', () => {
    let tempDir: string;
    let cleanup: () => void;

    beforeEach(() => {
      const tmp = createTempDir('llxprt-rmf-security-');
      tempDir = tmp.dir;
      cleanup = tmp.cleanup;
    });

    afterEach(() => {
      cleanup();
    });

    it('retains path/reason metadata for security-skipped records', async () => {
      const outsideDir = mkdtempSync(join(tmpdir(), 'llxprt-rmf-outside-'));
      try {
        writeFileSync(join(outsideDir, 'secret.txt'), 'TOP SECRET\n', 'utf-8');
        // A symlink inside the workspace pointing outside the workspace root
        // will fail validatePathWithinWorkspace during discovery.
        symlinkSync(join(outsideDir, 'secret.txt'), join(tempDir, 'link.txt'));
        // A normal in-workspace file for contrast.
        writeFileSync(join(tempDir, 'safe.txt'), 'safe content\n', 'utf-8');

        const host = createHostWithSettings(tempDir, {
          'tool-output-max-items': 50,
          'tool-output-max-tokens': 1_000_000,
        });
        const tool = new ReadManyFilesTool(host);
        const result = await tool.execute(
          { paths: ['**/*.txt'] },
          new AbortController().signal,
        );
        const text = stringifyLlmContent(result);
        const display = result.returnDisplay as string;

        // The safe file is read.
        expect(text).toContain('safe.txt');
        expect(text).toContain('safe content');
        // The security-skipped symlink content must NOT appear.
        expect(text).not.toContain('TOP SECRET');
        // The display message must report the security skip with the path.
        expect(display).toMatch(/link\.txt/i);
        expect(display).toMatch(/security|workspace/i);
      } finally {
        rmSync(outsideDir, { recursive: true, force: true });
      }
    });
  });
});

describe('ReadManyFiles UTF-8-safe byte-budget truncation (issue #3202)', () => {
  let tempDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = createTempDir('llxprt-rmf-utf8-trunc-');
    tempDir = tmp.dir;
    cleanup = tmp.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it('truncates multibyte content without splitting a character and includes marker + terminator', async () => {
    // Multibyte content sized to exceed the 4 MiB aggregate byte budget
    // while staying within per-file line-length (2000 chars) and line-count
    // (2000 lines) limits, so the AGGREGATE budget is what truncates.
    // Each '世' (U+4E16) is 3 UTF-8 bytes: 1000 lines x 1999 chars x 3
    // bytes ≈ 5.7 MiB > 4 MiB budget.
    const line = '世'.repeat(1999);
    const content = Array.from({ length: 1000 }, () => line).join('\n');
    writeFileSync(join(tempDir, 'f0.txt'), content, 'utf-8');

    const host = createHostWithSettings(tempDir, {
      'tool-output-max-items': 50,
      'tool-output-max-tokens': 100_000_000,
      'tool-output-truncate-mode': 'truncate',
      'tool-output-item-size-limit': 10 * 1024 * 1024,
    });
    const tool = new ReadManyFilesTool(host);
    const result = await tool.execute(
      { paths: ['**/*.txt'] },
      new AbortController().signal,
    );
    const text = stringifyLlmContent(result);
    const display = result.returnDisplay as string;

    // The truncation marker is present.
    expect(text).toContain('[CONTENT TRUNCATED DUE TO AGGREGATE BYTE BUDGET]');
    // The output terminator is present.
    expect(text).toContain('--- End of content ---');
    // No replacement character from a split multibyte sequence.
    expect(text).not.toContain('\uFFFD');
    // The total output is bounded within a reasonable margin of the budget.
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(5 * 1024 * 1024);
    // Display acknowledges the truncation and includes the retained token count.
    expect(display).toMatch(/truncat|byte budget/i);
    expect(display).toContain('approximately');
  });

  it('preserves exact multibyte content when it fits within the byte budget', async () => {
    // Small multibyte content well within the 4 MiB budget.
    const content = '世界\nこんにちは\n'.repeat(1000);
    writeFileSync(join(tempDir, 'fit.txt'), content, 'utf-8');

    const host = createHostWithSettings(tempDir, {
      'tool-output-max-items': 50,
      'tool-output-max-tokens': 1_000_000,
    });
    const tool = new ReadManyFilesTool(host);
    const result = await tool.execute(
      { paths: ['**/*.txt'] },
      new AbortController().signal,
    );
    const text = stringifyLlmContent(result);

    // Content must be complete, not truncated.
    expect(text).not.toMatch(/TRUNCATED/i);
    expect(text).toContain('世界');
    expect(text).toContain('こんにちは');
  });
});

describe('ReadManyFiles content/terminator budget correctness (issue #3202)', () => {
  let tempDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = createTempDir('llxprt-rmf-terminator-');
    tempDir = tmp.dir;
    cleanup = tmp.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it('final complete output including terminator does not exceed aggregate byte budget', async () => {
    // Content that exceeds the 4 MiB aggregate byte budget so truncation
    // triggers.
    const line = 'A'.repeat(2000);
    const content = Array.from({ length: 2200 }, () => line).join('\n');
    writeFileSync(join(tempDir, 'f0.txt'), content, 'utf-8');

    const host = createHostWithSettings(tempDir, {
      'tool-output-max-items': 50,
      'tool-output-max-tokens': 100_000_000,
      'tool-output-truncate-mode': 'truncate',
      'tool-output-item-size-limit': 10 * 1024 * 1024,
    });
    const tool = new ReadManyFilesTool(host);
    const result = await tool.execute(
      { paths: ['**/*.txt'] },
      new AbortController().signal,
    );
    const text = stringifyLlmContent(result);

    // The terminator must be present (proves the output is complete).
    expect(text).toContain('--- End of content ---');
    // The complete assembled output must not exceed the aggregate byte budget.
    // The default budget is 4 MiB (4 * 1024 * 1024 = 4194304).
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(
      4 * 1024 * 1024,
    );
  });

  it('token truncation does not split surrogate pairs', async () => {
    // Content with surrogate pairs (emoji) that exceeds the token limit but
    // NOT the byte budget, so token overflow triggers. Multi-line content so
    // each line stays under the 2000-char file-read line cap; the 'x' prefix
    // shifts emoji alignment so a naive char-based cut could split a pair.
    const lines: string[] = [];
    for (let i = 0; i < 4; i++) {
      lines.push('x' + '😀'.repeat(999)); // 1999 UTF-16 chars per line
    }
    writeFileSync(join(tempDir, 'f0.txt'), lines.join('\n'), 'utf-8');

    const host = createHostWithSettings(tempDir, {
      'tool-output-max-items': 50,
      // Small token limit to trigger token overflow (content has ~8000 chars
      // > 1000 tokens at 4 chars/token).
      'tool-output-max-tokens': 1000,
      'tool-output-truncate-mode': 'truncate',
      'tool-output-item-size-limit': 10 * 1024 * 1024,
    });
    const tool = new ReadManyFilesTool(host);
    const result = await tool.execute(
      { paths: ['**/*.txt'] },
      new AbortController().signal,
    );
    const text = stringifyLlmContent(result);

    // Token truncation must have triggered.
    expect(text).toContain('[CONTENT TRUNCATED DUE TO TOKEN LIMIT]');
    // No replacement character from a split surrogate pair.
    expect(text).not.toContain('\uFFFD');
    // The terminator must be present.
    expect(text).toContain('--- End of content ---');
  });

  it('token truncation with multibyte content charges actual UTF-8 bytes', async () => {
    // Multibyte BMP content that exceeds token limit but not byte budget.
    // Each '世' (U+4E16) is 1 UTF-16 code unit but 3 UTF-8 bytes. Multi-line
    // content so each line stays under the 2000-char file-read line cap.
    const lines: string[] = [];
    for (let i = 0; i < 4; i++) {
      lines.push('世'.repeat(1900));
    }
    writeFileSync(join(tempDir, 'f0.txt'), lines.join('\n'), 'utf-8');

    const host = createHostWithSettings(tempDir, {
      'tool-output-max-items': 50,
      'tool-output-max-tokens': 1000,
      'tool-output-truncate-mode': 'truncate',
      'tool-output-item-size-limit': 10 * 1024 * 1024,
    });
    const tool = new ReadManyFilesTool(host);
    const result = await tool.execute(
      { paths: ['**/*.txt'] },
      new AbortController().signal,
    );
    const text = stringifyLlmContent(result);

    // Token truncation must have triggered.
    expect(text).toContain('[CONTENT TRUNCATED DUE TO TOKEN LIMIT]');
    // No replacement character from a split multibyte sequence.
    expect(text).not.toContain('\uFFFD');
    // The output (including terminator) must not exceed the byte budget.
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(
      4 * 1024 * 1024,
    );
  });

  it('exact-fit content with terminator stays within budget', async () => {
    // Content that exactly fills the byte budget when accounting for the
    // separator, trailing newlines, and the pre-charged terminator. Multi-line
    // ASCII content so each line stays under the 2000-char file-read line cap.
    const filePath = join(tempDir, 'f0.txt');
    const prefix = `--- ${filePath} ---\n\n`;
    const suffix = '\n\n';
    const terminator = '\n--- End of content ---';
    const prefixBytes = Buffer.byteLength(prefix, 'utf8');
    const suffixBytes = Buffer.byteLength(suffix, 'utf8');
    const terminatorBytes = Buffer.byteLength(terminator, 'utf8');
    const budget = 4 * 1024 * 1024;
    const targetContentBytes =
      budget - prefixBytes - suffixBytes - terminatorBytes - 1; // -1: file-read adds a trailing \n
    // Build multi-line ASCII content of exactly targetContentBytes bytes.
    const lineLen = 1900;
    const lineCount = Math.max(
      1,
      Math.ceil((targetContentBytes + 1) / (lineLen + 1)),
    );
    const lastLen = targetContentBytes - (lineCount - 1) * (lineLen + 1);
    const lines: string[] = [];
    for (let i = 0; i < lineCount - 1; i++) lines.push('A'.repeat(lineLen));
    lines.push('A'.repeat(lastLen));
    writeFileSync(join(tempDir, 'f0.txt'), lines.join('\n'), 'utf-8');

    const host = createHostWithSettings(tempDir, {
      'tool-output-max-items': 50,
      'tool-output-max-tokens': 100_000_000,
      'tool-output-item-size-limit': 10 * 1024 * 1024,
      'file-read-max-lines': lineCount + 100,
    });
    const tool = new ReadManyFilesTool(host);
    const result = await tool.execute(
      { paths: ['**/*.txt'] },
      new AbortController().signal,
    );
    const text = stringifyLlmContent(result);

    // Content must NOT be truncated — it fits exactly.
    expect(text).not.toMatch(/TRUNCATED/i);
    // Terminator is present.
    expect(text).toContain('--- End of content ---');
    // The total output is at most the budget.
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(budget);
  });
});

describe('ReadManyFiles discovery records are bounded before filtering/dedup (issue #3202 coordinator)', () => {
  let tempDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = createTempDir('llxprt-rmf-records-');
    tempDir = tmp.dir;
    cleanup = tmp.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it('ignored no-match discovery records consume the record cap and trigger partiality', async () => {
    execSync('git init', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email test@test.com', {
      cwd: tempDir,
      stdio: 'ignore',
    });
    execSync('git config user.name Test', { cwd: tempDir, stdio: 'ignore' });
    writeFileSync(join(tempDir, '.gitignore'), 'ignored/**\n');
    // 55 git-ignored records + 3 accepted records + .gitignore itself = 59
    // raw glob emissions — far above the 50-record cap, even though at most
    // 4 unique accepted paths could ever be retained.
    mkdirSync(join(tempDir, 'ignored'), { recursive: true });
    for (let i = 0; i < 55; i++) {
      writeFileSync(
        join(tempDir, 'ignored', `i${i}.txt`),
        `ignored ${i}\n`,
        'utf-8',
      );
    }
    for (let i = 0; i < 3; i++) {
      writeFileSync(join(tempDir, `a${i}.txt`), `accepted ${i}\n`, 'utf-8');
    }

    const host = createHostWithSettings(tempDir, {
      'tool-output-max-items': 50,
      'tool-output-max-tokens': 1_000_000,
      'tool-output-truncate-mode': 'truncate',
    });
    const tool = new ReadManyFilesTool(host);
    const result = await tool.execute(
      { paths: ['**/*'], exclude: ['.git/**'], useDefaultExcludes: false },
      new AbortController().signal,
    );
    const text = stringifyLlmContent(result);
    const display = result.returnDisplay as string;

    // Discovery stopped at the record cap: the (cap+1)-th raw record proved
    // partiality even though accepted unique paths are far below the cap.
    expect(display).toMatch(/discovery stopped at 51 discovery record/i);
    // Ignored records within the budget are still reported (compressed count).
    expect(display).toMatch(/git ignored/i);
    // Only accepted unique paths within the record budget can be read; the
    // ignored records' content must never appear in the output.
    const readCount = (text.match(/accepted \d+/g) ?? []).length;
    expect(readCount).toBeLessThanOrEqual(3);
    expect(text).not.toContain('ignored 54');
  });

  it('duplicate records across repeated workspace roots consume the shared record cap (deduplicated output)', async () => {
    for (let i = 0; i < 30; i++) {
      writeFileSync(join(tempDir, `f${i}.txt`), `unique ${i}\n`, 'utf-8');
    }

    const baseHost = createHostWithSettings(tempDir, {
      'tool-output-max-items': 50,
      'tool-output-max-tokens': 1_000_000,
      'tool-output-truncate-mode': 'truncate',
    });
    // The same workspace root listed twice: the second pass re-emits every
    // path as a fresh discovery record, consuming the shared invocation cap
    // even though the accepted path set is fully deduplicated.
    const host = { ...baseHost, getWorkspaceRoots: () => [tempDir, tempDir] };
    const tool = new ReadManyFilesTool(host);
    const result = await tool.execute(
      { paths: ['**/*.txt'] },
      new AbortController().signal,
    );
    const text = stringifyLlmContent(result);
    const display = result.returnDisplay as string;

    // All 30 unique files are retained and deduplicated in the output...
    const readCount = (text.match(/unique \d+/g) ?? []).length;
    expect(readCount).toBe(30);
    // ...yet the shared record cap (50) was exceeded by the duplicate
    // emissions from the repeated root: 30 + 20 = 50 stored, the 51st raw
    // emission proves one-over partiality even though accepted output paths
    // remain deduplicated.
    expect(display).toMatch(/discovery stopped at 51 discovery record/i);
  });

  it('preserves 60-unique/cap-50 behavior: retain exactly 50 and report partial', async () => {
    for (let i = 0; i < 60; i++) {
      writeFileSync(join(tempDir, `f${i}.txt`), `content ${i}\n`, 'utf-8');
    }

    const host = createHostWithSettings(tempDir, {
      'tool-output-max-items': 50,
      'tool-output-max-tokens': 1_000_000,
      'tool-output-truncate-mode': 'truncate',
    });
    const tool = new ReadManyFilesTool(host);
    const result = await tool.execute(
      { paths: ['**/*.txt'] },
      new AbortController().signal,
    );
    const text = stringifyLlmContent(result);
    const display = result.returnDisplay as string;

    // Exactly 50 files retained from 60; the 51st raw record proved partiality.
    const fileCount = (text.match(/--- \S+[\\/]f\d+\.txt ---/g) ?? []).length;
    expect(fileCount).toBe(50);
    expect(display).toMatch(/discovery stopped at 51 discovery record/i);
  });
});

describe('read-many-files warn-mode discovery truncation (issue #3202)', () => {
  let tempDir: { dir: string; cleanup: () => void };

  beforeEach(() => {
    tempDir = createTempDir('llxprt-rmf-warn-trunc-');
  });

  afterEach(() => tempDir.cleanup());

  it('warn mode reads retained files when discovery truncated but unique files are within cap', async () => {
    // 10 unique files; a repeated workspace root (3x) produces 30 discovery
    // records — exceeding the 20-record cap — but only 10 unique files are
    // retained, which is within the 20-file cap. Warn mode must NOT return
    // an empty "File Count Limit Exceeded" result.
    for (let i = 0; i < 10; i++) {
      writeFileSync(join(tempDir.dir, `u${i}.txt`), `unique ${i}\n`, 'utf-8');
    }

    const baseHost = createHostWithSettings(tempDir.dir, {
      'tool-output-max-items': 20,
      'tool-output-max-tokens': 1_000_000,
      'tool-output-truncate-mode': 'warn',
    });
    const host = {
      ...baseHost,
      getWorkspaceRoots: () => [tempDir.dir, tempDir.dir, tempDir.dir],
    };
    const tool = new ReadManyFilesTool(host);
    const result = await tool.execute(
      { paths: ['**/*.txt'] },
      new AbortController().signal,
    );
    const text = stringifyLlmContent(result);
    const display = result.returnDisplay as string;

    // All 10 unique files must be read — NOT an empty "limit exceeded" result.
    expect(text).not.toContain('File Count Limit Exceeded');
    const readCount = (text.match(/unique \d+/g) ?? []).length;
    expect(readCount).toBe(10);
    // Discovery truncation should be reported truthfully.
    expect(display).toMatch(/discovery stopped at \d+ discovery record/i);
  });
});
