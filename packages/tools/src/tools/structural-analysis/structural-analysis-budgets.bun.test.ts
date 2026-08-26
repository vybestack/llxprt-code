/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for bounded acquisition in structural_analysis
 * dependencies/references/exports modes (issue #3205).
 *
 * Drives the REAL StructuralAnalysisTool end-to-end against real .ts fixture
 * trees written into a temp directory. The AST engine (@ast-grep/napi) is not
 * mocked. Budgets are exercised by setting a small `tool-output-max-items`
 * ephemeral setting so fixture trees can stay small.
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

/** Fake host that exposes a configurable `tool-output-max-items` setting. */
function numberOrZero(value: number | undefined): number {
  return value ?? 0;
}

function requireStructuralMetadata(
  metadata: ToolResult['metadata'],
): asserts metadata is NonNullable<ToolResult['metadata']> {
  if (metadata === undefined) {
    throw new Error('metadata should be defined');
  }
}

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
  countInexact?: boolean;
  results: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Expected an array, got ${typeof value}`);
  }
  return value;
}

function readField(obj: unknown, key: string): unknown {
  if (!isRecord(obj)) {
    throw new Error(`Expected an object result, got ${typeof obj}`);
  }
  return obj[key];
}

function readImportRecords(results: unknown): Array<{
  source: string;
  kind: string;
}> {
  return readArray(readField(results, 'imports')).map((raw) => {
    const rec = isRecord(raw) ? raw : {};
    return {
      source: typeof rec.source === 'string' ? rec.source : '',
      kind: typeof rec.kind === 'string' ? rec.kind : '',
    };
  });
}

function parsePayload(result: ToolResult): AnalysisPayload {
  const parsed: unknown = JSON.parse(String(result.llmContent));
  if (
    !isRecord(parsed) ||
    typeof parsed.mode !== 'string' ||
    typeof parsed.truncated !== 'boolean' ||
    !('results' in parsed)
  ) {
    throw new Error(`Unexpected payload: ${result.llmContent}`);
  }
  // The runtime guard above guarantees mode/truncated/results, so the cast to
  // the payload interface is supported rather than blind.
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

describe('structural_analysis bounded acquisition (issue #3205)', () => {
  let tempDir = '';

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-sa-budget-3205-'));
  });

  afterAll(() => {
    if (tempDir !== '') {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('dependencies record budget', () => {
    beforeAll(() => {
      // 6 named imports — one over a budget of 5.
      writeFileSync(
        join(tempDir, 'dep-over.ts'),
        "import { a } from './a.js';\nimport { b } from './b.js';\nimport { c } from './c.js';\nimport { d } from './d.js';\nimport { e } from './e.js';\nimport { f } from './f.js';\n",
        'utf-8',
      );
      // Exactly 5 named imports — at the budget limit.
      writeFileSync(
        join(tempDir, 'dep-exact.ts'),
        "import { a } from './a.js';\nimport { b } from './b.js';\nimport { c } from './c.js';\nimport { d } from './d.js';\nimport { e } from './e.js';\n",
        'utf-8',
      );
      // A single file with FAR more imports (30) than the record budget of 5.
      // Proves retention is bounded within ONE file (no per-file aggregate
      // exceeds the budget before the tracker applies its cap), and that the
      // partial metadata describes the retained prefix correctly.
      {
        let body = '';
        for (let i = 0; i < 30; i++) {
          body += `import { mod${i} } from './mod${i}.js';\n`;
        }
        writeFileSync(join(tempDir, 'dep-large.ts'), body, 'utf-8');
      }
    });

    it('retains at most the record budget and marks one-over as partial', async () => {
      const host = createBudgetToolHost(tempDir, 5);
      const result = await runTool(host, {
        mode: 'dependencies',
        language: 'typescript',
        target: join(tempDir, 'dep-over.ts'),
      });
      const payload = parsePayload(result);
      const imports = readImportRecords(payload.results);
      expect(imports.length).toBe(5);
      expect(payload.truncated).toBe(true);
      expect(payload.partial).toBe(true);
      expect(payload.partialReason).toBe('record-budget');
      expect(payload.recordBudget).toBe(5);
      expect(payload.recordsRetained).toBe(5);
      expect(payload.countInexact).toBe(true);
    });

    it('treats exact-limit input as complete (not truncated)', async () => {
      const host = createBudgetToolHost(tempDir, 5);
      const result = await runTool(host, {
        mode: 'dependencies',
        language: 'typescript',
        target: join(tempDir, 'dep-exact.ts'),
      });
      const payload = parsePayload(result);
      const imports = readImportRecords(payload.results);
      expect(imports.length).toBe(5);
      expect(payload.truncated).toBe(false);
      expect(payload.partial).toBeFalsy();
      expect(payload.recordsRetained).toBe(5);
    });

    it('bounds far-over imports within a SINGLE large file with correct partial metadata', async () => {
      const host = createBudgetToolHost(tempDir, 5);
      const result = await runTool(host, {
        mode: 'dependencies',
        language: 'typescript',
        target: join(tempDir, 'dep-large.ts'),
      });
      const payload = parsePayload(result);
      const imports = readImportRecords(payload.results);
      // One file holds 30 imports; only 5 are retained.
      expect(imports.length).toBe(5);
      expect(payload.truncated).toBe(true);
      expect(payload.partial).toBe(true);
      expect(payload.partialReason).toBe('record-budget');
      expect(payload.recordsRetained).toBe(5);
      expect(payload.countInexact).toBe(true);
      // The retained prefix is well-formed import metadata (first 5 modules).
      expect(imports[0].source).toBe('./mod0.js');
      expect(imports[imports.length - 1].source).toBe('./mod4.js');
      for (const imp of imports) {
        expect(imp.kind).toBe('named');
      }
    });
  });

  describe('dependencies file budget bounds discovery', () => {
    beforeAll(() => {
      const dir = join(tempDir, 'many-files');
      mkdirSync(dir, { recursive: true });
      // 25 empty .ts files — no import records, so the record budget never
      // triggers; only the file budget can stop traversal.
      for (let i = 0; i < 25; i++) {
        writeFileSync(join(dir, `f${i}.ts`), '// empty\n', 'utf-8');
      }
    });

    it('stops visiting files at the file budget and reports partial', async () => {
      // maxItems=5 -> recordBudget=5, fileBudget=20
      const host = createBudgetToolHost(tempDir, 5);
      const result = await runTool(host, {
        mode: 'dependencies',
        language: 'typescript',
        target: join(tempDir, 'many-files'),
      });
      const payload = parsePayload(result);
      expect(payload.filesVisited).toBe(20);
      expect(payload.fileBudget).toBe(20);
      expect(payload.truncated).toBe(true);
      expect(payload.partialReason).toBe('file-budget');
      // Proves discovery was bounded (did not visit all 25).
      expect(payload.filesVisited).toBeLessThan(25);
    });
  });

  describe('dependencies reverse shares total accounting (isolated fixture)', () => {
    // A DEDICATED fixture tree (not the shared tempDir) so the record budget —
    // not the file budget or FastGlob ordering of unrelated fixtures — is
    // provably the binding constraint. Only the target and its reverse
    // consumers live here. The reverse scan globs the workspace root, so an
    // isolated tree guarantees no other fixture files can consume the file
    // budget or perturb glob ordering before the record budget binds.
    let revDir = '';

    beforeAll(() => {
      revDir = mkdtempSync(join(tmpdir(), 'llxprt-sa-rev-3205-'));
      // Target file (no forward imports of its own).
      writeFileSync(
        join(revDir, 'shared.ts'),
        'export const SHARED = 1;\n',
        'utf-8',
      );
      // 6 files that import the shared module -> reverse imports (6) exceed a
      // record budget of 5, while the 7-file tree stays far below the file
      // budget (20). This proves the record budget is the binding constraint.
      for (let i = 0; i < 6; i++) {
        writeFileSync(
          join(revDir, `consumer${i}.ts`),
          `import { SHARED } from './shared.js';\n`,
          'utf-8',
        );
      }
    });

    afterAll(() => {
      if (revDir !== '') {
        rmSync(revDir, { recursive: true, force: true });
      }
    });

    const observeBoundsForwardReverseRecordsUnderOneAccountingPolicyAt289 =
      async () => {
        const host = createBudgetToolHost(revDir, 5);
        const result = await runTool(host, {
          mode: 'dependencies',
          language: 'typescript',
          target: join(revDir, 'shared.ts'),
          reverse: true,
        });
        const payload = parsePayload(result);
        const imports = readImportRecords(payload.results);
        const reverseRaw = readField(payload.results, 'reverseImports');
        const reverseImports = Array.isArray(reverseRaw) ? reverseRaw : [];
        const total = imports.length + reverseImports.length;
        return { payload, total };
      };

    it('bounds forward+reverse records under one accounting policy', async () => {
      const { payload, total } =
        await observeBoundsForwardReverseRecordsUnderOneAccountingPolicyAt289();
      expect(payload.recordBudget).toBe(5);
      expect(total).toBe(5);
      expect(payload.truncated).toBe(true);
      expect(payload.partialReason).toBe('record-budget');
      expect(payload.recordsRetained).toBe(total);
      expect(payload.fileBudget).toBe(20);
      expect(payload.filesVisited).toBeLessThan(20);
      expect(payload.recordsObserved).toBeGreaterThanOrEqual(total + 1);
    });
  });

  describe('references global record cap across categories', () => {
    beforeAll(() => {
      // Symbol "unicorn" referenced via direct calls and instantiations,
      // totaling more than a budget of 5 across categories.
      writeFileSync(
        join(tempDir, 'refs-over.ts'),
        'function unicorn() {}\nunicorn();\nunicorn();\nunicorn();\nunicorn();\nconst u = new unicorn();\nunicorn();\n',
        'utf-8',
      );
      writeFileSync(
        join(tempDir, 'refs-exact.ts'),
        'function unicorn() {}\nunicorn();\nunicorn();\nunicorn();\nconst u = new unicorn();\n',
        'utf-8',
      );
    });

    const observeBoundsReferencesAcrossAllCategoriesUnderOneGlobalCapAt335 =
      async () => {
        const host = createBudgetToolHost(tempDir, 5);
        const result = await runTool(host, {
          mode: 'references',
          language: 'typescript',
          symbol: 'unicorn',
          target: join(tempDir, 'refs-over.ts'),
        });
        const payload = parsePayload(result);
        const categoriesRaw = readField(payload.results, 'categories');
        const categories = isRecord(categoriesRaw) ? categoriesRaw : {};
        const total = Object.values(categories).reduce<number>(
          (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
          0,
        );
        return { payload, total };
      };

    it('bounds references across all categories under one global cap', async () => {
      const { payload, total } =
        await observeBoundsReferencesAcrossAllCategoriesUnderOneGlobalCapAt335();
      expect(total).toBeLessThanOrEqual(5);
      expect(payload.truncated).toBe(true);
      expect(payload.partialReason).toBe('record-budget');
      expect(payload.recordsRetained).toBe(total);
    });

    it('treats exact-limit references as complete', async () => {
      const host = createBudgetToolHost(tempDir, 5);
      const result = await runTool(host, {
        mode: 'references',
        language: 'typescript',
        symbol: 'unicorn',
        target: join(tempDir, 'refs-exact.ts'),
      });
      const payload = parsePayload(result);
      expect(payload.truncated).toBe(false);
    });
  });

  describe('exports record budget', () => {
    beforeAll(() => {
      // 6 exports — one over a budget of 5.
      writeFileSync(
        join(tempDir, 'exports-over.ts'),
        'export const a = 1;\nexport const b = 2;\nexport const c = 3;\nexport const d = 4;\nexport const e = 5;\nexport const f = 6;\n',
        'utf-8',
      );
      writeFileSync(
        join(tempDir, 'exports-exact.ts'),
        'export const a = 1;\nexport const b = 2;\nexport const c = 3;\nexport const d = 4;\nexport const e = 5;\n',
        'utf-8',
      );
    });

    it('bounds exports under the record budget and marks one-over partial', async () => {
      const host = createBudgetToolHost(tempDir, 5);
      const result = await runTool(host, {
        mode: 'exports',
        language: 'typescript',
        target: join(tempDir, 'exports-over.ts'),
      });
      const payload = parsePayload(result);
      const exports = readArray(payload.results);
      expect(exports.length).toBe(5);
      expect(payload.truncated).toBe(true);
      expect(payload.partialReason).toBe('record-budget');
    });

    it('treats exact-limit exports as complete', async () => {
      const host = createBudgetToolHost(tempDir, 5);
      const result = await runTool(host, {
        mode: 'exports',
        language: 'typescript',
        target: join(tempDir, 'exports-exact.ts'),
      });
      const payload = parsePayload(result);
      const exports = readArray(payload.results);
      expect(exports.length).toBe(5);
      expect(payload.truncated).toBe(false);
    });
  });

  describe('abort during traversal', () => {
    beforeAll(() => {
      const dir = join(tempDir, 'abort-tree');
      mkdirSync(dir, { recursive: true });
      for (let i = 0; i < 25; i++) {
        writeFileSync(
          join(dir, `m${i}.ts`),
          `import { x } from './dep${i}.js';\n`,
          'utf-8',
        );
      }

      // A large tree (300 files, each with one import) for deterministic
      // mid-traversal abort. The tool processes files sequentially, so a
      // bounded number of event-loop yields lets only some files complete
      // before the signal is raised — never all 300.
      const bigDir = join(tempDir, 'traverse-tree');
      mkdirSync(bigDir, { recursive: true });
      for (let i = 0; i < 300; i++) {
        writeFileSync(
          join(bigDir, `f${i}.ts`),
          `import { dep${i} } from './dep${i}.js';\n`,
          'utf-8',
        );
      }
    });

    it('a pre-aborted signal produces an explicit partial result', async () => {
      const host = createBudgetToolHost(tempDir, 200);
      const controller = new AbortController();
      controller.abort();
      const result = await runTool(
        host,
        {
          mode: 'dependencies',
          language: 'typescript',
          target: join(tempDir, 'abort-tree'),
        },
        controller.signal,
      );
      const payload = parsePayload(result);
      expect(payload.truncated).toBe(true);
      expect(payload.partialReason).toBe('aborted');
    });

    it('aborts DURING a real large-directory traversal and returns a partial result', async () => {
      // 300 files each with an import. A real AbortController is raised after
      // invocation has begun, at the earliest deterministic macrotask boundary
      // (a zero-delay timer, clamped to ~1 ms). The tool reads/parses files
      // sequentially, so the traversal provably cannot finish 300 AST parses
      // (tens of ms) before the timer fires — the abort lands mid-traversal
      // and the result is always partial with reason `aborted`. No positive
      // visited/retained count is required (that would reintroduce timing
      // dependence). The timer is always cleared in finally.
      const host = createBudgetToolHost(tempDir, 2000);
      const controller = new AbortController();
      const tool = new StructuralAnalysisTool(host);
      const execution = tool
        .build({
          mode: 'dependencies',
          language: 'typescript',
          target: join(tempDir, 'traverse-tree'),
        })
        .execute(controller.signal);
      const timer = setTimeout(() => controller.abort(), 0);
      try {
        const result = await execution;
        const payload = parsePayload(result);
        // Explicit aborted partial metadata (deterministic).
        expect(payload.truncated).toBe(true);
        expect(payload.partialReason).toBe('aborted');
        // Bounded output: the traversal did not finish all 300 files.
        expect(payload.filesVisited).toBeLessThan(300);
      } finally {
        clearTimeout(timer);
      }
    });
  });

  describe('metadata does not duplicate the results aggregate', () => {
    it('ToolResult.metadata excludes the results field', async () => {
      const host = createBudgetToolHost(tempDir, 5);
      const result = await runTool(host, {
        mode: 'exports',
        language: 'typescript',
        target: join(tempDir, 'exports-over.ts'),
      });
      const metadata = result.metadata;
      expect(metadata).toBeDefined();
      requireStructuralMetadata(metadata);
      expect(Object.prototype.hasOwnProperty.call(metadata, 'results')).toBe(
        false,
      );
      // Summary fields are present instead.
      expect(metadata).toHaveProperty('truncated');
      expect(metadata).toHaveProperty('recordBudget');
    });
  });

  describe('observed-count metadata (item H)', () => {
    it('reports recordsObserved == retained for an exact complete dependencies traversal', async () => {
      const host = createBudgetToolHost(tempDir, 5);
      const result = await runTool(host, {
        mode: 'dependencies',
        language: 'typescript',
        target: join(tempDir, 'dep-exact.ts'),
      });
      const payload = parsePayload(result);
      expect(payload.truncated).toBe(false);
      expect(payload.recordsObserved).toBe(payload.recordsRetained);
      expect(payload.recordsObserved).toBe(5);
    });

    it('reports recordsObserved >= retained+1 (lower bound) after a dependencies sentinel overflow', async () => {
      const host = createBudgetToolHost(tempDir, 5);
      const result = await runTool(host, {
        mode: 'dependencies',
        language: 'typescript',
        target: join(tempDir, 'dep-over.ts'),
      });
      const payload = parsePayload(result);
      expect(payload.truncated).toBe(true);
      expect(payload.recordsRetained).toBe(5);
      expect(payload.recordsObserved).toBeGreaterThanOrEqual(6);
      expect(payload.countInexact).toBe(true);
    });

    it('reports recordsObserved for an exact complete references traversal', async () => {
      const host = createBudgetToolHost(tempDir, 5);
      const result = await runTool(host, {
        mode: 'references',
        language: 'typescript',
        symbol: 'unicorn',
        target: join(tempDir, 'refs-exact.ts'),
      });
      const payload = parsePayload(result);
      expect(payload.truncated).toBe(false);
      expect(payload.recordsObserved).toBe(payload.recordsRetained);
    });

    it('reports recordsObserved as a lower bound after a references sentinel overflow', async () => {
      const host = createBudgetToolHost(tempDir, 5);
      const result = await runTool(host, {
        mode: 'references',
        language: 'typescript',
        symbol: 'unicorn',
        target: join(tempDir, 'refs-over.ts'),
      });
      const payload = parsePayload(result);
      expect(payload.truncated).toBe(true);
      expect(payload.recordsObserved).toBeGreaterThanOrEqual(
        numberOrZero(payload.recordsRetained) + 1,
      );
    });
  });
});
