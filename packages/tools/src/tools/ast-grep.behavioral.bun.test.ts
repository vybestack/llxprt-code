/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for bounded acquisition in ast_grep (issue #3205).
 *
 * Drives the REAL AstGrepTool against real .ts fixture trees. The AST engine
 * (@ast-grep/napi) is not mocked. Proves that match materialization stops at
 * `maxResults` (with a one-sentinel observation) rather than collecting every
 * match and slicing afterward, and that partial metadata is accurate.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IToolHost } from '../interfaces/index.js';
import { AstGrepTool } from './ast-grep.js';
import type { ToolResult } from './tools.js';

function arrayLength(value: readonly unknown[] | undefined): number {
  return value?.length ?? 0;
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
  matches?: unknown[];
  truncated?: boolean;
  matchesRetained?: number;
  matchesObserved?: number;
  totalMatches?: number;
  partialReason?: string;
  countInexact?: boolean;
  skippedFiles?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function runGrep(
  host: IToolHost,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const tool = new AstGrepTool(host);
  return tool.build(params).execute(signal ?? new AbortController().signal);
}

/**
 * Reads the AST-grep metadata via runtime guards rather than a blind cast, so
 * a shape mismatch surfaces as an absent field instead of a silent assertion.
 */
function metadataOf(result: ToolResult): AstGrepMetadata {
  const meta = result.metadata;
  if (!isRecord(meta)) {
    return {};
  }
  const out: AstGrepMetadata = {};
  if (Array.isArray(meta.matches)) out.matches = meta.matches;
  if (typeof meta.truncated === 'boolean') out.truncated = meta.truncated;
  if (typeof meta.matchesRetained === 'number')
    out.matchesRetained = meta.matchesRetained;
  if (typeof meta.matchesObserved === 'number')
    out.matchesObserved = meta.matchesObserved;
  if (typeof meta.totalMatches === 'number')
    out.totalMatches = meta.totalMatches;
  if (typeof meta.partialReason === 'string')
    out.partialReason = meta.partialReason;
  if (typeof meta.countInexact === 'boolean')
    out.countInexact = meta.countInexact;
  if (typeof meta.skippedFiles === 'number')
    out.skippedFiles = meta.skippedFiles;
  return out;
}

describe('ast_grep bounded acquisition (issue #3205)', () => {
  let tempDir = '';
  let manyMatchDir = '';
  let traverseDir = '';

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-astgrep-3205-'));
    manyMatchDir = join(tempDir, 'many');
    mkdirSync(manyMatchDir, { recursive: true });

    // 5 files, each with 5 call_expressions -> 25 total matches for $OBJ.$F($$$ARGS).
    // Far more than a maxResults of 5.
    for (let f = 0; f < 5; f++) {
      let body = '';
      for (let i = 0; i < 5; i++) {
        body += `console.log("hit-${f}-${i}");\n`;
      }
      writeFileSync(join(manyMatchDir, `file${f}.ts`), body, 'utf-8');
    }

    // A single file with exactly 5 matches.
    let exactBody = '';
    for (let i = 0; i < 5; i++) {
      exactBody += `console.log("exact-${i}");\n`;
    }
    writeFileSync(join(tempDir, 'exact.ts'), exactBody, 'utf-8');

    // A single file with exactly 6 matches (one over).
    let overBody = '';
    for (let i = 0; i < 6; i++) {
      overBody += `console.log("over-${i}");\n`;
    }
    writeFileSync(join(tempDir, 'over.ts'), overBody, 'utf-8');

    // A single file with FAR more matches (50) than any reasonable maxResults.
    // Proves bounding happens within ONE file, not just output-slicing across
    // many files.
    let farOverBody = '';
    for (let i = 0; i < 50; i++) {
      farOverBody += `console.log("far-${i}");\n`;
    }
    writeFileSync(join(tempDir, 'far-over.ts'), farOverBody, 'utf-8');

    // A large directory (300 files, 2 matches each) for deterministic
    // mid-traversal abort: the tool processes files sequentially, so a bounded
    // number of event-loop yields lets only some files complete before the
    // signal is raised — never all 300.
    traverseDir = join(tempDir, 'traverse');
    mkdirSync(traverseDir, { recursive: true });
    for (let i = 0; i < 300; i++) {
      writeFileSync(
        join(traverseDir, `t${i}.ts`),
        `console.log("a${i}");\nconsole.log("b${i}");\n`,
        'utf-8',
      );
    }

    // A metavariable-extraction fixture: a single clear call whose $OBJ, $F,
    // and $$$ARGS can be asserted directly against the parsed match record.
    writeFileSync(
      join(tempDir, 'metavars.ts'),
      `console.log("payload");\n`,
      'utf-8',
    );

    // 150 matches — exceeds the DEFAULT_MAX_RESULTS (100) so a nonfinite
    // maxResults (Infinity/NaN) resolved to the default is provably bounded.
    {
      let body = '';
      for (let i = 0; i < 150; i++) {
        body += `console.log("inf-${i}");\n`;
      }
      writeFileSync(join(tempDir, 'inf-over.ts'), body, 'utf-8');
    }
  });

  afterAll(() => {
    if (tempDir !== '') {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('retains at most maxResults and reports a lower-bound/inexact total', async () => {
    const host = createToolHost(tempDir);
    const result = await runGrep(host, {
      pattern: '$OBJ.$F($$$ARGS)',
      language: 'typescript',
      path: manyMatchDir,
      maxResults: 5,
    });
    const meta = metadataOf(result);
    expect(meta.matches?.length).toBe(5);
    expect(meta.truncated).toBe(true);
    expect(meta.partialReason).toBe('max-results');
    // Must NOT claim an exact total after stopping early.
    expect(meta.totalMatches).toBeUndefined();
    expect(meta.countInexact).toBe(true);
    expect(meta.matchesRetained).toBe(5);
  });

  it('treats exact-limit input as complete (not truncated)', async () => {
    const host = createToolHost(tempDir);
    const result = await runGrep(host, {
      pattern: '$OBJ.$F($$$ARGS)',
      language: 'typescript',
      path: join(tempDir, 'exact.ts'),
      maxResults: 5,
    });
    const meta = metadataOf(result);
    expect(meta.matches?.length).toBe(5);
    expect(meta.truncated).toBe(false);
  });

  it('one-over returns exactly maxResults and marks the result partial', async () => {
    const host = createToolHost(tempDir);
    const result = await runGrep(host, {
      pattern: '$OBJ.$F($$$ARGS)',
      language: 'typescript',
      path: join(tempDir, 'over.ts'),
      maxResults: 5,
    });
    const meta = metadataOf(result);
    expect(meta.matches?.length).toBe(5);
    expect(meta.truncated).toBe(true);
    expect(meta.partialReason).toBe('max-results');
  });

  it('bounds far-over matches within a SINGLE file (not output-sliced across files)', async () => {
    const host = createToolHost(tempDir);
    const result = await runGrep(host, {
      pattern: '$OBJ.$F($$$ARGS)',
      language: 'typescript',
      path: join(tempDir, 'far-over.ts'),
      maxResults: 5,
    });
    const meta = metadataOf(result);
    // One file has 50 matches; only 5 are retained and the result is partial.
    // This distinguishes bounded acquisition from collect-all-then-slice: with
    // a single file there is no cross-file slicing to hide the bound.
    expect(meta.matches?.length).toBe(5);
    expect(meta.truncated).toBe(true);
    expect(meta.partialReason).toBe('max-results');
    expect(meta.totalMatches).toBeUndefined();
    expect(meta.countInexact).toBe(true);
    expect(meta.matchesRetained).toBe(5);
  });

  it('a pre-aborted signal returns retained matches as an explicit partial', async () => {
    const host = createToolHost(tempDir);
    const controller = new AbortController();
    controller.abort();
    const result = await runGrep(
      host,
      {
        pattern: '$OBJ.$F($$$ARGS)',
        language: 'typescript',
        path: manyMatchDir,
        maxResults: 100,
      },
      controller.signal,
    );
    const meta = metadataOf(result);
    expect(meta.truncated).toBe(true);
    expect(meta.partialReason).toBe('aborted');
  });

  it('a pre-aborted SINGLE-FILE request avoids read/parse work and returns no matches', async () => {
    // A single-file target whose content holds many matches. A pre-aborted
    // signal must short-circuit before reading/parsing: no match records are
    // retained, and the result is an explicit partial with reason `aborted`.
    const host = createToolHost(tempDir);
    const controller = new AbortController();
    controller.abort();
    const result = await runGrep(
      host,
      {
        pattern: '$OBJ.$F($$$ARGS)',
        language: 'typescript',
        path: join(tempDir, 'far-over.ts'),
        maxResults: 5,
      },
      controller.signal,
    );
    const meta = metadataOf(result);
    expect(meta.truncated).toBe(true);
    expect(meta.partialReason).toBe('aborted');
    // No matches materialized: the pre-aborted single-file path must not
    // read/parse the file.
    expect(arrayLength(meta.matches)).toBe(0);
  });

  it('aborts DURING a real large-directory traversal and returns a partial result', async () => {
    // 300 files × 2 matches = 600 matches. A real AbortController is raised
    // after invocation has begun, at the earliest deterministic macrotask
    // boundary (a zero-delay timer, clamped to ~1 ms). The tool reads/parses
    // files sequentially, so the traversal provably cannot finish 300 AST
    // parses (tens of ms) before the timer fires — the abort lands
    // mid-traversal and the result is always partial with reason `aborted`.
    // No positive retained count is required: requiring one would reintroduce
    // timing dependence on machine speed. The timer is always cleared in
    // finally so no macrotask leaks even if the traversal throws.
    const host = createToolHost(tempDir);
    const controller = new AbortController();
    const execution = runGrep(
      host,
      {
        pattern: '$OBJ.$F($$$ARGS)',
        language: 'typescript',
        path: traverseDir,
        maxResults: 600,
      },
      controller.signal,
    );
    const timer = setTimeout(() => controller.abort(), 0);
    try {
      const result = await execution;
      const meta = metadataOf(result);
      // Explicit aborted partial metadata (deterministic).
      expect(meta.truncated).toBe(true);
      expect(meta.partialReason).toBe('aborted');
      // Bounded output: the traversal did not finish all 600 matches before
      // the abort was observed.
      expect(arrayLength(meta.matches)).toBeLessThan(600);
    } finally {
      clearTimeout(timer);
    }
  });

  it('zero/below-limit input returns all matches and is not truncated', async () => {
    const host = createToolHost(tempDir);
    // 25 matches available, maxResults 30 -> all retained, not truncated.
    const result = await runGrep(host, {
      pattern: '$OBJ.$F($$$ARGS)',
      language: 'typescript',
      path: manyMatchDir,
      maxResults: 30,
    });
    const meta = metadataOf(result);
    expect(meta.matches?.length).toBe(25);
    expect(meta.truncated).toBe(false);
  });
});

/**
 * Reads the metavariable map from the first retained match record via runtime
 * guards (no blind cast), so a structural mismatch surfaces as an empty object.
 */
function firstMatchMetaVars(result: ToolResult): Record<string, string> {
  const meta = result.metadata;
  if (!isRecord(meta) || !Array.isArray(meta.matches)) return {};
  const first = meta.matches[0];
  if (!isRecord(first) || !isRecord(first.metaVariables)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(first.metaVariables)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

describe('ast_grep metavariable extraction (issue #3205)', () => {
  let tempDir = '';

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-astgrep-mv-3205-'));
    writeFileSync(
      join(tempDir, 'mv.ts'),
      `console.log("payload");
`,
      'utf-8',
    );
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('extracts single-node metavariables ($NAME) from a real match', async () => {
    const host = createToolHost(tempDir);
    const result = await runGrep(host, {
      pattern: '$OBJ.$F($$$ARGS)',
      language: 'typescript',
      path: join(tempDir, 'mv.ts'),
      maxResults: 5,
    });
    const vars = firstMatchMetaVars(result);
    // $OBJ -> "console", $F -> "log"
    expect(vars.OBJ).toBe('console');
    expect(vars.F).toBe('log');
  });

  it('extracts multi-node metavariables ($$$NAME) from a real match', async () => {
    const host = createToolHost(tempDir);
    const result = await runGrep(host, {
      pattern: '$OBJ.$F($$$ARGS)',
      language: 'typescript',
      path: join(tempDir, 'mv.ts'),
      maxResults: 5,
    });
    const vars = firstMatchMetaVars(result);
    // $$$ARGS -> the argument list text ("payload" with quotes).
    expect(typeof vars.ARGS).toBe('string');
    expect(vars.ARGS).toContain('payload');
  });

  it('extracts a standalone single metavariable bound to a whole expression', async () => {
    const host = createToolHost(tempDir);
    writeFileSync(
      join(tempDir, 'standalone.ts'),
      `targetValue;
`,
      'utf-8',
    );
    const result = await runGrep(host, {
      pattern: '$NAME',
      language: 'typescript',
      path: join(tempDir, 'standalone.ts'),
      maxResults: 5,
    });
    const vars = firstMatchMetaVars(result);
    // A bare $NAME binds the whole expression-statement node, whose text
    // includes the identifier and the trailing semicolon.
    expect(vars.NAME).toContain('targetValue');
  });
});

describe('ast_grep maxResults resolution (issue #3205)', () => {
  let tempDir = '';

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-astgrep-max-3205-'));
    // 6 matches in one file.
    let body = '';
    for (let i = 0; i < 6; i++) {
      body += `console.log("m${i}");
`;
    }
    writeFileSync(join(tempDir, 'six.ts'), body, 'utf-8');
    // 150 matches — exceeds DEFAULT_MAX_RESULTS (100).
    let big = '';
    for (let i = 0; i < 150; i++) {
      big += `console.log("b${i}");
`;
    }
    writeFileSync(join(tempDir, 'big.ts'), big, 'utf-8');
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('rejects a fractional maxResults (hard validation)', async () => {
    const host = createToolHost(tempDir);
    const result = await runGrep(host, {
      pattern: '$OBJ.$F($$$ARGS)',
      language: 'typescript',
      path: join(tempDir, 'six.ts'),
      maxResults: 2.5,
    });
    const text = String(result.llmContent);
    expect(text).toMatch(/maxResults must be.*finite positive integer/i);
  });

  it('rejects maxResults 0 (hard validation)', async () => {
    const host = createToolHost(tempDir);
    const result = await runGrep(host, {
      pattern: '$OBJ.$F($$$ARGS)',
      language: 'typescript',
      path: join(tempDir, 'six.ts'),
      maxResults: 0,
    });
    const text = String(result.llmContent);
    expect(text).toMatch(/maxResults must be.*finite positive integer/i);
  });

  it('rejects a negative maxResults (hard validation)', async () => {
    const host = createToolHost(tempDir);
    const result = await runGrep(host, {
      pattern: '$OBJ.$F($$$ARGS)',
      language: 'typescript',
      path: join(tempDir, 'six.ts'),
      maxResults: -3,
    });
    const text = String(result.llmContent);
    expect(text).toMatch(/maxResults must be.*finite positive integer/i);
  });

  it('bounds a nonfinite maxResults (Infinity) to the finite default', async () => {
    const host = createToolHost(tempDir);
    // The schema's `type: number` rejects nonfinite values at build time
    // (ajv treats Infinity/NaN as not-a-number). This is the public
    // validation contract preserved by #3205: nonfinite never reaches an
    // unbounded traversal.
    expect(() =>
      new AstGrepTool(host).build({
        pattern: '$OBJ.$F($$$ARGS)',
        language: 'typescript',
        path: join(tempDir, 'big.ts'),
        maxResults: Number.POSITIVE_INFINITY,
      }),
    ).toThrow(/maxResults must be number/);
  });

  it('bounds a NaN maxResults to the finite default', async () => {
    const host = createToolHost(tempDir);
    expect(() =>
      new AstGrepTool(host).build({
        pattern: '$OBJ.$F($$$ARGS)',
        language: 'typescript',
        path: join(tempDir, 'big.ts'),
        maxResults: Number.NaN,
      }),
    ).toThrow(/maxResults must be number/);
  });
});

describe('ast_grep observed-count metadata (issue #3205)', () => {
  let tempDir = '';

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-astgrep-obs-3205-'));
    let body = '';
    for (let i = 0; i < 6; i++) {
      body += `console.log("o${i}");
`;
    }
    writeFileSync(join(tempDir, 'over.ts'), body, 'utf-8');
    let exact = '';
    for (let i = 0; i < 5; i++) {
      exact += `console.log("e${i}");
`;
    }
    writeFileSync(join(tempDir, 'exact.ts'), exact, 'utf-8');
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('reports matchesObserved == retained for an exact, complete traversal', async () => {
    const host = createToolHost(tempDir);
    const result = await runGrep(host, {
      pattern: '$OBJ.$F($$$ARGS)',
      language: 'typescript',
      path: join(tempDir, 'exact.ts'),
      maxResults: 5,
    });
    const meta = metadataOf(result);
    expect(meta.matchesObserved).toBe(5);
    expect(meta.matchesRetained).toBe(5);
    expect(meta.countInexact).toBeFalsy();
  });

  it('reports matchesObserved >= retained+1 (lower bound) after a sentinel overflow', async () => {
    const host = createToolHost(tempDir);
    const result = await runGrep(host, {
      pattern: '$OBJ.$F($$$ARGS)',
      language: 'typescript',
      path: join(tempDir, 'over.ts'),
      maxResults: 5,
    });
    const meta = metadataOf(result);
    expect(meta.matchesRetained).toBe(5);
    // The one-over sentinel proves at least 6 existed.
    expect(meta.matchesObserved).toBeGreaterThanOrEqual(6);
    expect(meta.countInexact).toBe(true);
  });
});

describe('ast_grep skipped-file partiality (issue #3205)', () => {
  // chmod 000 reliably makes a regular file unreadable only on POSIX, and only
  // when the process does NOT run as root (root bypasses file permission
  // bits). On Windows, or when running as root, the fixture cannot produce a
  // genuine EACCES read failure, so the partial assertion is skipped there
  // rather than relying on an unreliable chmod. This avoids a test-only
  // production hook: the fixture produces a real read failure on the platforms
  // that support it.
  const supportsUnreadableFixture =
    process.platform !== 'win32' && process.getuid?.() !== 0;

  let tempDir = '';

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-astgrep-skip-3205-'));
    // One readable file with one match.
    writeFileSync(
      join(tempDir, 'readable.ts'),
      `console.log("ok");
`,
      'utf-8',
    );
    // One unreadable file (chmod 000) — readFile throws EACCES, recorded as
    // skipped. Only applied where the fixture genuinely denies reads.
    writeFileSync(
      join(tempDir, 'unreadable.ts'),
      `console.log("nope");
`,
      'utf-8',
    );
    if (supportsUnreadableFixture) {
      try {
        chmodSync(join(tempDir, 'unreadable.ts'), 0o000);
      } catch {
        // best effort; if chmod fails the file stays readable
      }
    }
  });

  afterAll(() => {
    // restore so cleanup can remove it
    if (supportsUnreadableFixture && tempDir !== '') {
      try {
        chmodSync(join(tempDir, 'unreadable.ts'), 0o644);
      } catch {
        // ignore
      }
    }
    if (tempDir !== '') {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe.skipIf(!supportsUnreadableFixture)(
    'unreadable-file partiality',
    () => {
      it('marks the result inexact when a file is skipped (no exact totalMatches)', async () => {
        const host = createToolHost(tempDir);
        const result = await runGrep(host, {
          pattern: '$OBJ.$F($$$ARGS)',
          language: 'typescript',
          path: tempDir,
          maxResults: 100,
        });
        const meta = metadataOf(result);
        // The unreadable file was skipped -> at least one skip recorded.
        expect(meta.skippedFiles).toBeGreaterThanOrEqual(1);
        // A skipped file means the count cannot be exact: no totalMatches claimed.
        expect(meta.totalMatches).toBeUndefined();
        expect(meta.countInexact).toBe(true);
      });
    },
  );
});
