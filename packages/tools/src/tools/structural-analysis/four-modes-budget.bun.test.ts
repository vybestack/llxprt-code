/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for bounded acquisition in the four structural_analysis
 * modes that were missing finite budgets: definitions, hierarchy, callers,
 * callees (issue #3202).
 *
 * Drives the REAL StructuralAnalysisTool end-to-end against real .ts fixture
 * trees. Budgets are exercised by setting a small `tool-output-max-items`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IToolHost } from '../../interfaces/index.js';
import {
  StructuralAnalysisTool,
  type StructuralAnalysisParams,
} from '../structural-analysis.js';
import type { ToolResult } from '../tools.js';

function createBudgetToolHost(targetDir: string, maxItems: number): IToolHost {
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
    getEphemeralSettings: () => ({ 'tool-output-max-items': maxItems }),
    getDebugMode: () => false,
  };
}

interface AnalysisPayload {
  mode: string;
  truncated: boolean;
  partial?: boolean;
  partialReason?: string;
  fileBudget?: number;
  recordBudget?: number;
  filesVisited?: number;
  recordsRetained?: number;
  recordsObserved?: number;
  nodesRetained?: number;
  nodesObserved?: number;
  oversizedFiles?: number;
  unparseableFiles?: number;
  countInexact?: boolean;
  results: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parsePayload(result: ToolResult): AnalysisPayload {
  const parsed: unknown = JSON.parse(String(result.llmContent));
  if (!isRecord(parsed)) {
    throw new Error(`Unexpected payload: ${result.llmContent}`);
  }
  return parsed as unknown as AnalysisPayload;
}

async function runTool(
  host: IToolHost,
  params: StructuralAnalysisParams,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const tool = new StructuralAnalysisTool(host);
  return tool.build(params).execute(signal ?? new AbortController().signal);
}

describe('structural_analysis definitions bounded acquisition (issue #3202)', () => {
  let tempDir = '';

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-def-budget-'));
    // Create many files each defining the same symbol.
    for (let i = 0; i < 20; i++) {
      writeFileSync(
        join(tempDir, `f${i}.ts`),
        `export function targetFn(): void {}\n`,
      );
    }
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns all definitions under budget and reports not truncated', async () => {
    const host = createBudgetToolHost(tempDir, 500);
    const result = await runTool(host, {
      mode: 'definitions',
      language: 'typescript',
      symbol: 'targetFn',
    });
    const payload = parsePayload(result);
    expect(payload.mode).toBe('definitions');
    expect(payload.truncated).toBe(false);
    expect(payload.fileBudget).toBeDefined();
    expect(payload.recordBudget).toBeDefined();
    const results = payload.results as unknown[];
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(20);
  });

  it('truncates when record budget is exceeded with one-over semantics', async () => {
    const host = createBudgetToolHost(tempDir, 3);
    const result = await runTool(host, {
      mode: 'definitions',
      language: 'typescript',
      symbol: 'targetFn',
    });
    const payload = parsePayload(result);
    expect(payload.truncated).toBe(true);
    expect(payload.partial).toBe(true);
    expect(payload.partialReason).toBeDefined();
    expect(payload.recordsRetained).toBeLessThanOrEqual(3);
    expect(payload.recordsObserved).toBeGreaterThan(payload.recordsRetained!);
  });

  it('reports file-budget metadata', async () => {
    const host = createBudgetToolHost(tempDir, 500);
    const result = await runTool(host, {
      mode: 'definitions',
      language: 'typescript',
      symbol: 'targetFn',
    });
    const payload = parsePayload(result);
    expect(payload.fileBudget).toBeGreaterThan(0);
    expect(payload.filesVisited).toBeGreaterThan(0);
  });
});

describe('structural_analysis hierarchy bounded acquisition (issue #3202)', () => {
  let tempDir = '';

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-hier-budget-'));
    for (let i = 0; i < 10; i++) {
      writeFileSync(
        join(tempDir, `f${i}.ts`),
        `class Child${i} extends Base { }\n`,
      );
    }
    writeFileSync(join(tempDir, 'base.ts'), 'class Base { }\n');
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('reports budget metadata and finds hierarchy matches', async () => {
    const host = createBudgetToolHost(tempDir, 500);
    const result = await runTool(host, {
      mode: 'hierarchy',
      language: 'typescript',
      symbol: 'Base',
    });
    const payload = parsePayload(result);
    expect(payload.mode).toBe('hierarchy');
    expect(payload.fileBudget).toBeDefined();
    expect(payload.recordBudget).toBeDefined();
    expect(payload.filesVisited).toBeGreaterThan(0);
    expect(payload.truncated).toBe(false);
  });

  it('truncates when record budget is exceeded', async () => {
    const host = createBudgetToolHost(tempDir, 2);
    const result = await runTool(host, {
      mode: 'hierarchy',
      language: 'typescript',
      symbol: 'Base',
    });
    const payload = parsePayload(result);
    expect(payload.truncated).toBe(true);
    expect(payload.partialReason).toBeDefined();
  });
});

describe('structural_analysis callers bounded acquisition (issue #3202)', () => {
  let tempDir = '';

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-callers-budget-'));
    for (let i = 0; i < 20; i++) {
      writeFileSync(
        join(tempDir, `f${i}.ts`),
        `export function caller${i}(): void { targetFn(); }\n`,
      );
    }
    writeFileSync(
      join(tempDir, 'target.ts'),
      'export function targetFn(): void {}\n',
    );
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('reports budget metadata for callers', async () => {
    const host = createBudgetToolHost(tempDir, 500);
    const result = await runTool(host, {
      mode: 'callers',
      language: 'typescript',
      symbol: 'targetFn',
    });
    const payload = parsePayload(result);
    expect(payload.mode).toBe('callers');
    expect(payload.fileBudget).toBeDefined();
    expect(payload.recordBudget).toBeDefined();
    expect(payload.filesVisited).toBeDefined();
  });

  it('truncates when record budget is exceeded', async () => {
    const host = createBudgetToolHost(tempDir, 3);
    const result = await runTool(host, {
      mode: 'callers',
      language: 'typescript',
      symbol: 'targetFn',
    });
    const payload = parsePayload(result);
    expect(payload.truncated).toBe(true);
    expect(payload.partialReason).toBeDefined();
  });

  it('hard-clamps maxNodes', async () => {
    const host = createBudgetToolHost(tempDir, 500);
    const result = await runTool(host, {
      mode: 'callers',
      language: 'typescript',
      symbol: 'targetFn',
      maxNodes: 5,
    });
    const payload = parsePayload(result);
    // With maxNodes=5, traversal should be bounded.
    const results = payload.results as unknown[];
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeLessThanOrEqual(5);
    // recordBudget must report the effective maximum (min of maxNodes and
    // the configured record budget), not the raw configured budget.
    expect(payload.recordBudget).toBe(5);
  });

  it('reports the effective record budget (min of maxNodes default and record budget)', async () => {
    const host = createBudgetToolHost(tempDir, 500);
    const result = await runTool(host, {
      mode: 'callers',
      language: 'typescript',
      symbol: 'targetFn',
    });
    const payload = parsePayload(result);
    // Default maxNodes is 50; effectiveMaxNodes = min(50, 500) = 50.
    expect(payload.recordBudget).toBe(50);
  });

  it('uses the finite default for zero and fractional maxNodes', async () => {
    const host = createBudgetToolHost(tempDir, 500);
    for (const maxNodes of [0, 3.7]) {
      const result = await runTool(host, {
        mode: 'callers',
        language: 'typescript',
        symbol: 'targetFn',
        maxNodes,
      });
      const payload = parsePayload(result);
      expect(payload.recordBudget).toBe(50);
      expect((payload.results as unknown[]).length).toBeGreaterThan(0);
      expect(payload.partialReason).not.toBe('max-nodes');
    }
  });
});

describe('structural_analysis callees bounded acquisition (issue #3202)', () => {
  let tempDir = '';

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-callees-budget-'));
    writeFileSync(
      join(tempDir, 'main.ts'),
      `import { a, b, c } from './lib';\nexport function targetFunc(): void { a(); b(); c(); }\n`,
    );
    mkdirSync(join(tempDir, 'lib'), { recursive: true });
    writeFileSync(
      join(tempDir, 'lib', 'index.ts'),
      'export function a() {}\nexport function b() {}\nexport function c() {}\n',
    );
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('reports budget metadata for callees', async () => {
    const host = createBudgetToolHost(tempDir, 500);
    const result = await runTool(host, {
      mode: 'callees',
      language: 'typescript',
      symbol: 'targetFunc',
    });
    const payload = parsePayload(result);
    expect(payload.mode).toBe('callees');
    expect(payload.fileBudget).toBeDefined();
    expect(payload.recordBudget).toBeDefined();
  });

  it('hard-clamps maxNodes for callees', async () => {
    const host = createBudgetToolHost(tempDir, 500);
    const result = await runTool(host, {
      mode: 'callees',
      language: 'typescript',
      symbol: 'targetFunc',
      maxNodes: 2,
    });
    const payload = parsePayload(result);
    const results = payload.results as unknown[];
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeLessThanOrEqual(2);
    // recordBudget must report the effective maximum.
    expect(payload.recordBudget).toBe(2);
  });

  it('reports the effective record budget for callees (min of maxNodes default and record budget)', async () => {
    const host = createBudgetToolHost(tempDir, 500);
    const result = await runTool(host, {
      mode: 'callees',
      language: 'typescript',
      symbol: 'targetFunc',
    });
    const payload = parsePayload(result);
    // Default maxNodes is 50; effectiveMaxNodes = min(50, 500) = 50.
    expect(payload.recordBudget).toBe(50);
  });

  it('uses the finite default for negative maxNodes', async () => {
    const host = createBudgetToolHost(tempDir, 500);
    const result = await runTool(host, {
      mode: 'callees',
      language: 'typescript',
      symbol: 'targetFunc',
      maxNodes: -1,
    });
    const payload = parsePayload(result);
    expect(payload.recordBudget).toBe(50);
    expect((payload.results as unknown[]).length).toBeGreaterThan(0);
    expect(payload.partialReason).not.toBe('max-nodes');
  });
});

describe('structural_analysis abort metadata (issue #3202)', () => {
  let tempDir = '';

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-abort-budget-'));
    for (let i = 0; i < 30; i++) {
      writeFileSync(
        join(tempDir, `f${i}.ts`),
        `export function targetFn(): void {}\n`,
      );
    }
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('definitions reports truncated when aborted mid-traversal', async () => {
    const host = createBudgetToolHost(tempDir, 500);
    const controller = new AbortController();
    const promise = runTool(
      host,
      { mode: 'definitions', language: 'typescript', symbol: 'targetFn' },
      controller.signal,
    );
    controller.abort();
    const result = await promise;
    const payload = parsePayload(result);
    expect(payload.truncated).toBe(true);
  });
});

const NL = String.fromCharCode(10);

describe('structural_analysis hierarchy parent/interface budget (issue #3202)', () => {
  let tempDir = '';

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-hier-parent-'));
    for (let i = 0; i < 20; i++) {
      writeFileSync(
        join(tempDir, 'f' + i + '.ts'),
        'class Base extends P' + i + ' { }' + NL,
      );
    }
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('bounds the extendsParent list with one-over semantics', async () => {
    const host = createBudgetToolHost(tempDir, 3);
    const result = await runTool(host, {
      mode: 'hierarchy',
      language: 'typescript',
      symbol: 'Base',
    });
    const payload = parsePayload(result);
    expect(payload.mode).toBe('hierarchy');
    const results = payload.results as {
      extends: string[];
      implements: string[];
    };
    expect(results.extends.length).toBeLessThanOrEqual(3);
    expect(payload.truncated).toBe(true);
    expect(payload.countInexact).toBe(true);
    expect(payload.recordsObserved!).toBeGreaterThan(payload.recordsRetained!);
  });

  it('bounds the implements list with one-over semantics', async () => {
    const implDir = mkdtempSync(join(tmpdir(), 'llxprt-hier-iface-'));
    try {
      for (let i = 0; i < 20; i++) {
        writeFileSync(
          join(implDir, 'g' + i + '.ts'),
          'class Base implements I' + i + ' { }' + NL,
        );
      }
      const host = createBudgetToolHost(implDir, 3);
      const result = await runTool(host, {
        mode: 'hierarchy',
        language: 'typescript',
        symbol: 'Base',
      });
      const payload = parsePayload(result);
      const results = payload.results as {
        extends: string[];
        implements: string[];
      };
      expect(results.implements.length).toBeLessThanOrEqual(3);
      expect(payload.truncated).toBe(true);
      expect(payload.countInexact).toBe(true);
    } finally {
      rmSync(implDir, { recursive: true, force: true });
    }
  });
});

describe('structural_analysis parse omissions mark inexact (issue #3202)', () => {
  let tempDir = '';

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-parse-omit-'));
    writeFileSync(
      join(tempDir, 'good.ts'),
      'export function targetFn(): void {}' + NL,
    );
    writeFileSync(
      join(tempDir, 'huge.ts'),
      'export function targetFn(): void {}' +
        NL +
        '// ' +
        'x'.repeat(20 * 1024 * 1024),
    );
    writeFileSync(
      join(tempDir, 'broken.ts'),
      'class {{{' + NL + 'func(()' + NL,
    );
    writeFileSync(
      join(tempDir, 'caller.ts'),
      'export function c1(): void { targetFn(); }' + NL,
    );
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('definitions counts oversized/unparseable omissions and marks inexact', async () => {
    const host = createBudgetToolHost(tempDir, 500);
    const result = await runTool(host, {
      mode: 'definitions',
      language: 'typescript',
      symbol: 'targetFn',
    });
    const payload = parsePayload(result);
    expect(payload.mode).toBe('definitions');
    expect(payload.oversizedFiles!).toBeGreaterThanOrEqual(1);
    const totalOmissions =
      (payload.oversizedFiles ?? 0) + (payload.unparseableFiles ?? 0);
    expect(totalOmissions).toBeGreaterThanOrEqual(1);
    expect(payload.countInexact).toBe(true);
  });

  it('callers counts oversized omissions and marks inexact', async () => {
    const host = createBudgetToolHost(tempDir, 500);
    const result = await runTool(host, {
      mode: 'callers',
      language: 'typescript',
      symbol: 'targetFn',
    });
    const payload = parsePayload(result);
    expect(payload.oversizedFiles!).toBeGreaterThanOrEqual(1);
    expect(payload.countInexact).toBe(true);
  });
});

describe('structural_analysis callers/callees max-nodes sentinel (issue #3202)', () => {
  let tempDir = '';

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-maxnodes-'));
    for (let i = 0; i < 20; i++) {
      writeFileSync(
        join(tempDir, 'f' + i + '.ts'),
        'export function caller' + i + '(): void { targetFn(); }' + NL,
      );
    }
    writeFileSync(
      join(tempDir, 'target.ts'),
      'export function targetFn(): void {}' + NL,
    );
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('callers exact maxNodes limit remains complete when no extra candidate', async () => {
    const host = createBudgetToolHost(tempDir, 500);
    const result = await runTool(host, {
      mode: 'callers',
      language: 'typescript',
      symbol: 'targetFn',
      maxNodes: 20,
    });
    const payload = parsePayload(result);
    expect(payload.truncated).toBe(false);
    expect(payload.partialReason).toBeUndefined();
    expect(payload.nodesObserved).toBe(20);
    expect(payload.nodesRetained).toBe(20);
  });

  it('callers one-over maxNodes sets the max-nodes sentinel', async () => {
    const host = createBudgetToolHost(tempDir, 500);
    const result = await runTool(host, {
      mode: 'callers',
      language: 'typescript',
      symbol: 'targetFn',
      maxNodes: 5,
    });
    const payload = parsePayload(result);
    expect(payload.truncated).toBe(true);
    expect(payload.partialReason).toBe('max-nodes');
    expect(payload.nodesRetained).toBeLessThanOrEqual(5);
    expect(payload.nodesObserved!).toBeGreaterThan(payload.nodesRetained!);
    expect(payload.nodesObserved).toBe(6);
    expect(payload.countInexact).toBe(true);
  });

  it('callees one-over maxNodes sets the max-nodes sentinel', async () => {
    const calleeDir = mkdtempSync(join(tmpdir(), 'llxprt-maxnodes-cal-'));
    try {
      writeFileSync(
        join(calleeDir, 'main.ts'),
        'export function t(): void { a(); b(); c(); d(); e(); f(); }' +
          NL +
          'export function a(): void {}' +
          NL +
          'export function b(): void {}' +
          NL +
          'export function c(): void {}' +
          NL +
          'export function d(): void {}' +
          NL +
          'export function e(): void {}' +
          NL +
          'export function f(): void {}' +
          NL,
      );
      const host = createBudgetToolHost(calleeDir, 500);
      const result = await runTool(host, {
        mode: 'callees',
        language: 'typescript',
        symbol: 't',
        maxNodes: 3,
      });
      const payload = parsePayload(result);
      expect(payload.truncated).toBe(true);
      expect(payload.partialReason).toBe('max-nodes');
      expect(payload.nodesRetained).toBe(3);
      expect(payload.nodesObserved).toBe(4);
      const results = payload.results as unknown[];
      expect(results.length).toBeLessThanOrEqual(3);
    } finally {
      rmSync(calleeDir, { recursive: true, force: true });
    }
  });

  it('callees exact maxNodes limit remains complete when no extra candidate', async () => {
    const calleeDir = mkdtempSync(join(tmpdir(), 'llxprt-maxnodes-exact-'));
    try {
      writeFileSync(
        join(calleeDir, 'main.ts'),
        'export function t(): void { a(); b(); c(); }' +
          NL +
          'export function a(): void {}' +
          NL +
          'export function b(): void {}' +
          NL +
          'export function c(): void {}' +
          NL,
      );
      const host = createBudgetToolHost(calleeDir, 500);
      const result = await runTool(host, {
        mode: 'callees',
        language: 'typescript',
        symbol: 't',
        maxNodes: 3,
      });
      const payload = parsePayload(result);
      expect(payload.truncated).toBe(false);
      expect(payload.partialReason).toBeUndefined();
      expect(payload.nodesObserved).toBe(3);
      expect(payload.nodesRetained).toBe(3);
    } finally {
      rmSync(calleeDir, { recursive: true, force: true });
    }
  });
});

describe('structural_analysis parseFile omission contract (issue #3202)', () => {
  // Direct unit tests for the shared parseFile helper, which must ALWAYS
  // return a ParseOutcome (never throw) so callers can count omissions
  // truthfully. stat/read/parse failures all funnel into the discriminated
  // outcome, including non-ENOENT stat errors that previously escaped the
  // try block.
  it('returns read-error for a directory path (EISDIR from readFile)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'llxprt-parsefile-dir-'));
    try {
      const { parseFile } = await import('./helpers.js');
      const outcome = await parseFile(dir, 'typescript');
      expect(outcome).toMatchObject({ ok: false, reason: 'read-error' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns oversized for a file exceeding the pre-read size gate', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'llxprt-parsefile-huge-'));
    try {
      writeFileSync(
        join(dir, 'huge.ts'),
        '/* ' + 'x'.repeat(21 * 1024 * 1024) + ' */\nconst x = 1;\n',
      );
      const { parseFile } = await import('./helpers.js');
      const outcome = await parseFile(join(dir, 'huge.ts'), 'typescript');
      expect(outcome).toMatchObject({ ok: false, reason: 'oversized' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns read-error for a missing file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'llxprt-parsefile-missing-'));
    try {
      const { parseFile } = await import('./helpers.js');
      const outcome = await parseFile(join(dir, 'nope.ts'), 'typescript');
      expect(outcome).toMatchObject({ ok: false, reason: 'read-error' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
