/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for ast_grep bounded acquisition (issue #3202):
 * - maxResults hard validation and cap
 * - pre-read file-size gate (single file and directory traversal)
 * - oversized-file partial metadata
 * - abort partial metadata
 *
 * Drives the REAL AstGrepTool end-to-end against real fixture files.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import type { IToolHost } from '../interfaces/index.js';
import { AstGrepTool, type AstGrepToolParams } from './ast-grep.js';
import type { ToolResult } from './tools.js';

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
      filterFiles: (paths: string[]) => paths,
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
    getLlxprtIgnorePatterns: () => [],
    getEphemeralSettings: () => ({}),
    getDebugMode: () => false,
  };
}

interface AstGrepMetadata {
  truncated?: boolean;
  matchesRetained?: number;
  matchesObserved?: number;
  countInexact?: boolean;
  totalMatches?: number;
  partialReason?: string;
  skippedFiles?: number;
  oversizedFiles?: number;
  filesObserved?: number;
  discoveryTruncated?: boolean;
}

function readMetadata(result: ToolResult): AstGrepMetadata {
  const meta = result.metadata as AstGrepMetadata | undefined;
  if (meta === undefined) {
    throw new Error(`Expected metadata in ToolResult, got: undefined`);
  }
  return meta;
}

async function runAstGrep(
  host: IToolHost,
  params: AstGrepToolParams,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const tool = new AstGrepTool(host);
  return tool.build(params).execute(signal ?? new AbortController().signal);
}

describe('ast_grep maxResults hard validation and cap (issue #3202)', () => {
  let tempDir = '';

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-astgrep-cap-'));
    writeFileSync(
      join(tempDir, 'f.ts'),
      'function alpha() {}\nfunction beta() {}\n',
    );
  });

  afterAll(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('rejects a fractional maxResults', async () => {
    const host = createToolHost(tempDir);
    const result = await runAstGrep(host, {
      pattern: 'function $NAME() {}',
      language: 'typescript',
      maxResults: 1.5,
    });
    const text = String(result.llmContent);
    expect(text).toMatch(/maxResults must be|error/i);
  });

  it('rejects maxResults exceeding the hard cap', async () => {
    const host = createToolHost(tempDir);
    const result = await runAstGrep(host, {
      pattern: 'function $NAME() {}',
      language: 'typescript',
      maxResults: 10_000_000,
    });
    const text = String(result.llmContent);
    expect(text).toMatch(/maxResults .* (exceeds|hard)|hard (maximum|cap)/i);
  });

  it('accepts maxResults at the hard cap', async () => {
    const host = createToolHost(tempDir);
    const result = await runAstGrep(host, {
      pattern: 'function $NAME() {}',
      language: 'typescript',
      maxResults: 10_000,
    });
    expect(String(result.llmContent)).toMatch(/Found \d+/);
    const meta = readMetadata(result);
    expect(meta.truncated).toBe(false);
  });

  it('rejects a negative maxResults', async () => {
    const host = createToolHost(tempDir);
    const result = await runAstGrep(host, {
      pattern: 'function $NAME() {}',
      language: 'typescript',
      maxResults: -5,
    });
    const text = String(result.llmContent);
    expect(text).toMatch(/maxResults must be|error/i);
  });
});

describe('ast_grep pre-read file-size gate (issue #3202)', () => {
  let tempDir = '';

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-astgrep-gate-'));
    // An oversized file (>20 MiB) that would otherwise be fully read.
    // 21 MiB of padding inside a comment = ~22 MiB total, safely over the
    // 20 MiB (20,971,520 byte) limit.
    const huge = `/* ${'x'.repeat(21 * 1024 * 1024)} */\nconst x = 1;\n`;
    writeFileSync(join(tempDir, 'huge.ts'), huge);
    writeFileSync(join(tempDir, 'small.ts'), 'const y = 2;\n');
  });

  afterAll(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('skips an oversized file in directory traversal and reports it', async () => {
    const host = createToolHost(tempDir);
    const result = await runAstGrep(host, {
      pattern: 'const $VAR = $$$REST',
      language: 'typescript',
    });
    const meta = readMetadata(result);
    // small.ts is searched; huge.ts is gated out.
    expect(meta.oversizedFiles).toBe(1);
    // Count cannot be exact since huge.ts was never searched.
    expect(meta.countInexact).toBe(true);
    // The small file match is present.
    const text = String(result.llmContent);
    expect(text).toContain('small.ts');
  });

  it('returns a size-gate error for a single oversized file', async () => {
    const host = createToolHost(tempDir);
    const result = await runAstGrep(host, {
      pattern: 'const $VAR = $$$REST',
      path: 'huge.ts',
    });
    const text = String(result.llmContent);
    expect(text).toMatch(/exceeds the 20MB limit|file size/i);
    // No error means we searched it — that would be wrong.
  });
});

describe('ast_grep abort metadata (issue #3202)', () => {
  let tempDir = '';

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-astgrep-abort-'));
    writeFileSync(join(tempDir, 'f.ts'), 'const x = 1;\n');
  });

  afterAll(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('reports aborted partial metadata for a pre-aborted signal (single file)', async () => {
    const host = createToolHost(tempDir);
    const controller = new AbortController();
    controller.abort();
    const result = await runAstGrep(
      host,
      { pattern: 'const $X = $$$R', path: 'f.ts' },
      controller.signal,
    );
    const meta = readMetadata(result);
    expect(meta.truncated).toBe(true);
    expect(meta.partialReason).toBe('aborted');
    expect(meta.countInexact).toBe(true);
  });

  it('reports aborted partial metadata for a pre-aborted signal (directory)', async () => {
    const host = createToolHost(tempDir);
    const controller = new AbortController();
    controller.abort();
    const result = await runAstGrep(
      host,
      { pattern: 'const $X = $$$R', language: 'typescript' },
      controller.signal,
    );
    const meta = readMetadata(result);
    expect(meta.truncated).toBe(true);
    expect(meta.partialReason).toBe('aborted');
  });
});

describe('ast_grep observed-file budget (issue #3202)', () => {
  let tempDir = '';

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-astgrep-filebudget-'));
    // 21 no-match files: with a file budget of 20 (max-items 5 x 4) the
    // traversal must stop one-over and report discovery partiality.
    for (let i = 0; i < 21; i++) {
      writeFileSync(
        join(tempDir, 'f' + i + '.ts'),
        'const noop' + i + ' = ' + i + ';\n',
      );
    }
  });

  afterAll(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  function createBudgetHost(maxItems: number): IToolHost {
    const base = createToolHost(tempDir);
    return {
      ...base,
      getEphemeralSettings: () => ({ 'tool-output-max-items': maxItems }),
    };
  }

  it('charges every observed file even with zero matches (one-over)', async () => {
    const host = createBudgetHost(5); // file budget = 20
    const result = await runAstGrep(host, {
      pattern: 'function $NAME() {}',
      language: 'typescript',
    });
    const meta = readMetadata(result);
    expect(meta.truncated).toBe(true);
    expect(meta.partialReason).toBe('file-budget');
    expect(meta.countInexact).toBe(true);
    expect(meta.filesObserved).toBe(21);
    expect(meta.matchesRetained).toBe(0);
    const text = String(result.llmContent);
    expect(text).toMatch(/file|truncat|incomplete|more/i);
  });

  it('hard-clamps a huge max-items setting', async () => {
    const hardCapDir = mkdtempSync(join(tmpdir(), 'llxprt-astgrep-hardcap-'));
    try {
      for (let i = 0; i < 10_001; i++) {
        writeFileSync(join(hardCapDir, `h${i}.ts`), '');
      }
      const base = createToolHost(hardCapDir);
      const host: IToolHost = {
        ...base,
        getEphemeralSettings: () => ({
          'tool-output-max-items': 999_999_999,
        }),
      };
      const result = await runAstGrep(host, {
        pattern: 'function $NAME() {}',
        language: 'typescript',
      });
      const meta = readMetadata(result);
      expect(meta.filesObserved).toBe(10_001);
      expect(meta.truncated).toBe(true);
      expect(meta.partialReason).toBe('file-budget');
    } finally {
      rmSync(hardCapDir, { recursive: true, force: true });
    }
  }, 120_000);

  it('stays complete when the observed-file count is exactly at budget', async () => {
    const exactDir = mkdtempSync(join(tmpdir(), 'llxprt-astgrep-exact-'));
    try {
      for (let i = 0; i < 20; i++) {
        writeFileSync(
          join(exactDir, 'g' + i + '.ts'),
          'const noop' + i + ' = ' + i + ';\n',
        );
      }
      const base = createToolHost(exactDir);
      const host: IToolHost = {
        ...base,
        getEphemeralSettings: () => ({ 'tool-output-max-items': 5 }), // budget = 20
      };
      const result = await runAstGrep(host, {
        pattern: 'function $NAME() {}',
        language: 'typescript',
      });
      const meta = readMetadata(result);
      expect(meta.filesObserved).toBe(20);
      expect(meta.truncated).toBe(false);
      expect(meta.partialReason).toBeUndefined();
    } finally {
      rmSync(exactDir, { recursive: true, force: true });
    }
  });

  it('uses the 1000-file default budget when no setting is supplied', async () => {
    const defaultDir = mkdtempSync(join(tmpdir(), 'llxprt-astgrep-default-'));
    try {
      for (let i = 0; i < 1001; i++) {
        writeFileSync(join(defaultDir, `d${i}.ts`), `const d${i} = ${i};\n`);
      }
      const base = createToolHost(defaultDir);
      const host: IToolHost = {
        ...base,
        getEphemeralSettings: () => ({}),
      };
      const result = await runAstGrep(host, {
        pattern: 'function $NAME() {}',
        language: 'typescript',
      });
      const meta = readMetadata(result);
      expect(meta.filesObserved).toBe(1001);
      expect(meta.truncated).toBe(true);
      expect(meta.partialReason).toBe('file-budget');
    } finally {
      rmSync(defaultDir, { recursive: true, force: true });
    }
  });
});

describe('ast_grep glob filtering during bounded traversal (issue #3202)', () => {
  let tempDir = '';
  let outsideDir = '';

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-astgrep-globs-'));
    outsideDir = mkdtempSync(join(tmpdir(), 'llxprt-astgrep-outside-'));
    writeFileSync(join(tempDir, 'root.ts'), 'function rootMatch() {}\n');
    writeFileSync(join(tempDir, 'unrelated.txt'), 'function notCode() {}\n');
    writeFileSync(join(tempDir, 'skipped.ts'), 'function skipMatch() {}\n');
    writeFileSync(
      join(outsideDir, 'secret.ts'),
      'function outsideMatch() {}\n',
    );
  });

  afterAll(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    if (outsideDir) rmSync(outsideDir, { recursive: true, force: true });
  });

  it('applies a positive include glob during traversal', async () => {
    const host = createToolHost(tempDir);
    const result = await runAstGrep(host, {
      pattern: 'function $NAME() {}',
      language: 'typescript',
      globs: ['root.ts'],
    });
    const text = String(result.llmContent);
    expect(text).toContain('rootMatch');
    expect(text).not.toContain('skipMatch');
    const meta = readMetadata(result);
    expect(meta.truncated).toBe(false);
  });

  it('applies a negative exclude glob during traversal', async () => {
    const host = createToolHost(tempDir);
    const result = await runAstGrep(host, {
      pattern: 'function $NAME() {}',
      language: 'typescript',
      globs: ['!skipped.ts'],
    });
    const text = String(result.llmContent);
    expect(text).toContain('rootMatch');
    expect(text).not.toContain('skipMatch');
    const meta = readMetadata(result);
    expect(meta.truncated).toBe(false);
  });

  it('combines positive and negative globs', async () => {
    const host = createToolHost(tempDir);
    const result = await runAstGrep(host, {
      pattern: 'function $NAME() {}',
      language: 'typescript',
      globs: ['*.ts', '!skipped.ts'],
    });
    const text = String(result.llmContent);
    expect(text).toContain('rootMatch');
    expect(text).not.toContain('skipMatch');
    const meta = readMetadata(result);
    // Only root.ts matches (skipped.ts excluded by the negative glob;
    // unrelated.txt excluded by language extension filter).
    expect(meta.filesObserved).toBe(1);
    expect(meta.truncated).toBe(false);
  });

  it.each([
    ['absolute', () => join(outsideDir, '*.ts')],
    ['parent-relative', () => join(relative(tempDir, outsideDir), '*.ts')],
  ])(
    'does not read files from an escaping %s glob',
    async (_kind, globForOutside) => {
      const host = createToolHost(tempDir);
      const result = await runAstGrep(host, {
        pattern: 'function $NAME() {}',
        language: 'typescript',
        globs: [globForOutside().replaceAll('\\', '/')],
      });
      const text = String(result.llmContent);
      expect(text).not.toContain('outsideMatch');
      const meta = readMetadata(result);
      expect(meta.filesObserved).toBe(1);
      expect(meta.skippedFiles).toBe(1);
      expect(meta.countInexact).toBe(true);
    },
  );

  it('handles a broad include glob without reporting false partiality', async () => {
    const host = createToolHost(tempDir);
    const result = await runAstGrep(host, {
      pattern: 'function $NAME() {}',
      language: 'typescript',
      globs: ['*.ts'],
    });
    const meta = readMetadata(result);
    // Both .ts files processed; complete traversal.
    expect(meta.filesObserved).toBe(2);
    expect(meta.truncated).toBe(false);
  });
});
