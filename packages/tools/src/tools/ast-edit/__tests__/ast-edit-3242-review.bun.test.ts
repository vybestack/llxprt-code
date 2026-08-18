/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral remediation tests for the issue #3242 review findings.
 *
 * Blocker-Fix: the hard 256 KiB preview byte budget was violated when AST
 * validation emitted many diagnostics — the mandatory
 * `astValidation.errors.join(', ')` line alone exceeded 262,144 bytes after
 * every declaration line was already dropped. Preview assembly must budget
 * variable validation detail at whole diagnostic items with truthful
 * omission metadata, keep the mandatory status/summary/timestamp/footer
 * lines, and fail fast when truly fixed mandatory content alone exceeds the
 * policy.
 *
 * Blocker-Fix (summary label): the mandatory
 * `- AST validation: ${summary.label}` line embedded the categorizer's
 * unbounded list of error line numbers, so a diagnostic-dense summary label
 * alone exceeded the 262,144-byte budget. A preview-only bounded
 * summary-label formatter keeps that mandatory line small while preserving
 * the exact ordinary label.
 *
 * In-scope-Fix (CRLF): a CRLF old_string never matched the LF-normalized
 * content at the anchor boundary, so declaration selection anchored at
 * line 1 even for tail edits. The exact edit start must anchor selection
 * and validation consistently.
 *
 * In-scope-Fix (snippets): preview reported 64 snippets but the preview
 * context retained all 77 collected items. The preview-specific bounded
 * snippet collection (the real collector path) must hold at most 64 items
 * while the report keeps the truthful original total.
 *
 * Every fixture is a real file exercised through the real ASTEditTool or
 * the real ASTContextCollector — no mocked tool paths.
 */

import { describe, it, expect } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASTEditTool } from '../../ast-edit.js';
import { ASTContextCollector } from '../context-collector.js';
import {
  assembleBoundedPreview,
  preExistingSyntaxErrorStatus,
  boundedValidationSummaryLabel,
} from '../preview-context-policy.js';
import { ASTConfig } from '../ast-config.js';
import type { AstValidationSummary } from '../validation-categorizer.js';
import type { EnhancedDeclaration } from '../types.js';
import type { ToolResult } from '../../tools.js';
import { ToolErrorType } from '../../../types/tool-error.js';
import { createFakeToolHost, useTempDir } from './test-helpers.js';

const PREVIEW_LLM_MAX_BYTES = 256 * 1024;
const PREVIEW_MAX_DECLARATIONS = 128;
const PREVIEW_MAX_SNIPPETS = ASTConfig.PREVIEW_MAX_SNIPPETS;
const NEXT_STEP = 'NEXT STEP: Call again with force: true to apply changes';

function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, 'utf-8');
}

async function runPreview(
  targetDir: string,
  filePath: string,
  edit: { oldString: string; newString: string },
): Promise<ToolResult> {
  const tool = new ASTEditTool(createFakeToolHost(targetDir));
  return tool
    .build({
      file_path: filePath,
      old_string: edit.oldString,
      new_string: edit.newString,
      force: false,
    })
    .execute(new AbortController().signal);
}

function previewLine(output: string, prefix: string): string | undefined {
  return output.split('\n').find((line) => line.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// Blocker-Fix: diagnostic-dense previews must respect the hard byte budget.
// ---------------------------------------------------------------------------

describe('Blocker-Fix: preview byte budget under diagnostic-dense validation', () => {
  const ctx = useTempDir();

  // 8,000 unique malformed declarations each emit one parser diagnostic, so
  // the joined AST error list alone is ~296 KiB — far beyond the 256 KiB
  // policy even with every declaration line dropped.
  const DENSE_LINES = 8_000;

  function writeDenseFixture(): string {
    const lines: string[] = [];
    for (let i = 0; i < DENSE_LINES; i++) {
      lines.push(`const v${String(i).padStart(4, '0')} = ;`);
    }
    const target = join(ctx.tempDir, 'diagnostic-dense.ts');
    writeFileSync(target, `${lines.join('\n')}\n`, 'utf-8');
    return target;
  }

  it('keeps the entire successful llmContent at or under 256 KiB with truthful omission metadata', async () => {
    const target = writeDenseFixture();

    const result = await runPreview(ctx.tempDir, target, {
      oldString: `const v${String(DENSE_LINES - 1).padStart(4, '0')} = ;`,
      newString: `const v${String(DENSE_LINES - 1).padStart(4, '0')} = 1;`,
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(utf8Bytes(output)).toBeLessThanOrEqual(PREVIEW_LLM_MAX_BYTES);

    // Mandatory preview status, AST validity summary, timestamp, and the
    // exact next-step footer all survive the budget.
    expect(output).toContain(`LLXPRT EDIT PREVIEW: ${target}`);
    expect(output).toContain('- AST validation: FAILED (pre-existing error');
    // The mandatory pre-existing status line is fixed-width: per-error
    // locations live only in the separately budgeted validation detail, so
    // even this diagnostic-dense collection cannot expand it.
    expect(previewLine(output, '- Pre-existing syntax errors:')).toBe(
      '- Pre-existing syntax errors: Yes',
    );
    expect(output).toContain('- Timestamp: ');
    expect(output).toContain(NEXT_STEP);

    // Variable validation detail is bounded at whole diagnostic items with
    // a truthful omission marker: shown + omitted must equal the total.
    const astErrorsLine = previewLine(output, '- AST errors: ');
    expect(astErrorsLine).toBeDefined();
    const marker = /\(\+(\d+) more errors omitted; (\d+) total\)$/.exec(
      astErrorsLine ?? '',
    );
    expect(marker).not.toBeNull();
    const omitted = Number(marker?.[1]);
    const total = Number(marker?.[2]);
    const shownText = (astErrorsLine ?? '').slice(
      '- AST errors: '.length,
      (astErrorsLine?.length ?? 0) - (marker?.[0].length ?? 0),
    );
    // Each diagnostic in this fixture is one "Syntax error ..." message
    // (which itself contains ", " between line and column), so count
    // messages rather than splitting on the item separator.
    const shown = (shownText.match(/Syntax error/g) ?? []).length;
    expect(shown + omitted).toBe(total);
    expect(total).toBe(DENSE_LINES - 1);
    expect(shown).toBeGreaterThan(0);

    // The line itself never claims to carry the full diagnostic list.
    expect(utf8Bytes(astErrorsLine ?? '')).toBeLessThanOrEqual(
      PREVIEW_LLM_MAX_BYTES,
    );
  });

  it('fails fast when fixed mandatory content alone exceeds the byte budget', () => {
    // Fixed mandatory lines (status/summary/footer) are never droppable, so
    // assembly must refuse rather than emit an over-budget success. Proven
    // at the preview-assembly policy boundary with real mandatory content
    // sized past the policy (a pathological pipeline case whose ~37k real
    // parser diagnostics additionally trip a pre-existing Bun native-module
    // exit crash, so it cannot be exercised end-to-end here).
    const hugeMandatory = [
      `LLXPRT EDIT PREVIEW: ${'p'.repeat(PREVIEW_LLM_MAX_BYTES)}`,
      '- AST validation: FAILED',
    ];
    expect(() =>
      assembleBoundedPreview({
        mandatoryHead: hugeMandatory,
        validationDetail: [],
        mandatoryTail: [],
        declarations: [],
        anchorLine: 1,
        mandatorySuffix: [
          'NEXT STEP: Call again with force: true to apply changes',
        ],
      }),
    ).toThrow(/alone exceeds the \d+-byte budget/);
  });

  it('fails fast when fixed content fits only without the required bounded marker', () => {
    // Exact boundary: the fixed mandatory frame alone fits, but once the
    // byte budget drops the only declaration line, the truthful
    // `showing 0 of 1` bounded marker itself no longer fits. The assembled
    // frame must be refused, never returned as an over-budget success.
    const declaration: EnhancedDeclaration = {
      name: 'markerBoundary',
      type: 'function',
      line: 1,
      column: 1,
      range: {
        start: { line: 1, column: 1 },
        end: { line: 1, column: 24 },
      },
    };
    const statusPrefix = 'LLXPRT EDIT PREVIEW: ';
    const headWithoutStatus = [
      '- Context: typescript file with 1 declarations',
      '- Functions: 1',
      '- Classes: 0',
      '- AST validation: PASSED',
    ];
    const mandatoryTail = [
      '- Relevant snippets: 0 found',
      '- Timestamp: 1786000000000',
      'ENHANCED CONTEXT ANALYSIS:',
    ];
    const mandatorySuffix = [NEXT_STEP];
    const marker =
      '- Declarations: bounded preview — showing 0 of 1 (selected nearest to the edit)';
    // Size the status line so the fixed frame lands exactly 8 bytes under
    // the hard budget: it fits alone, but the required omission marker
    // (~80 bytes) pushes the assembled frame past it.
    const fillerLength =
      PREVIEW_LLM_MAX_BYTES -
      utf8Bytes(
        [
          statusPrefix,
          ...headWithoutStatus,
          ...mandatoryTail,
          ...mandatorySuffix,
        ].join('\n'),
      ) -
      8;
    const mandatoryHead = [
      `${statusPrefix}${'p'.repeat(fillerLength)}`,
      ...headWithoutStatus,
    ];
    const fixed = [...mandatoryHead, ...mandatoryTail, ...mandatorySuffix];

    expect(utf8Bytes(fixed.join('\n'))).toBe(PREVIEW_LLM_MAX_BYTES - 8);
    expect(utf8Bytes([...fixed, marker].join('\n'))).toBeGreaterThan(
      PREVIEW_LLM_MAX_BYTES,
    );

    expect(() =>
      assembleBoundedPreview({
        mandatoryHead,
        validationDetail: [],
        mandatoryTail,
        declarations: [declaration],
        anchorLine: 1,
        mandatorySuffix,
      }),
    ).toThrow(
      /cannot fit mandatory content plus declaration omission metadata within the \d+-byte budget/,
    );
  });

  it('keeps the mandatory pre-existing status fixed-width for a very large error collection', () => {
    // Pure-policy regression for the mandatory-status blocker: 50,000
    // synthetic pre-existing diagnostics (no parser involved — a real
    // ~37k-diagnostic parse trips a pre-existing Bun native-module exit
    // crash). The pre-existing-only status line is fixed-width by policy,
    // so the collection size cannot expand non-budgetable mandatory
    // content; the errors themselves enter only through the separately
    // budgeted validation detail.
    const hugeErrors = Array.from(
      { length: 50_000 },
      (_, index) => `Syntax error at line ${index + 1}, column 1`,
    );

    const status = preExistingSyntaxErrorStatus(true);
    expect(status).toBe('- Pre-existing syntax errors: Yes');
    expect(utf8Bytes(status)).toBeLessThanOrEqual(64);

    const result = assembleBoundedPreview({
      mandatoryHead: [
        'LLXPRT EDIT PREVIEW: /workspace/target.ts',
        '- Context: typescript file with 0 declarations',
        '- Functions: 0',
        '- Classes: 0',
        '- AST validation: FAILED (pre-existing errors — present before this edit)',
        status,
      ],
      validationDetail: hugeErrors,
      mandatoryTail: [
        '- Relevant snippets: 0 found',
        '- Timestamp: 1786000000000',
        'ENHANCED CONTEXT ANALYSIS:',
      ],
      declarations: [],
      anchorLine: 1,
      mandatorySuffix: [NEXT_STEP],
    });

    // The huge collection is budgeted at whole diagnostic items with
    // truthful omission metadata, and the fixed-width mandatory status
    // survives inside the hard byte budget.
    expect(utf8Bytes(result.lines.join('\n'))).toBeLessThanOrEqual(
      PREVIEW_LLM_MAX_BYTES,
    );
    expect(result.lines).toContain('- Pre-existing syntax errors: Yes');
    const astErrorsLine = result.lines.find((line) =>
      line.startsWith('- AST errors: '),
    );
    expect(astErrorsLine).toBeDefined();
    const marker = /\(\+(\d+) more errors omitted; (\d+) total\)$/.exec(
      astErrorsLine ?? '',
    );
    expect(marker).not.toBeNull();
    expect(Number(marker?.[2])).toBe(50_000);
  });

  it('keeps every declaration when the complete unmarked frame fits but the marker would not', () => {
    // Exact boundary, mirror image of the refusal case above: the complete
    // UNMARKED frame lands exactly at the hard budget, so it fits — but a
    // bounded marker (never rendered, because nothing is omitted) would
    // push the measured frame past it. The assembler must measure the
    // complete unmarked frame first and keep the declaration; accounting
    // for an omission marker before any omission is required would drop
    // the declaration (or refuse outright) for a marker that is never
    // rendered.
    const declaration: EnhancedDeclaration = {
      name: 'completeFrame',
      type: 'function',
      line: 1,
      column: 1,
      range: {
        start: { line: 1, column: 1 },
        end: { line: 1, column: 16 },
      },
    };
    const statusPrefix = 'LLXPRT EDIT PREVIEW: ';
    const headWithoutStatus = [
      '- Context: typescript file with 1 declarations',
      '- Functions: 1',
      '- Classes: 0',
      '- AST validation: PASSED',
    ];
    const mandatoryTail = [
      '- Relevant snippets: 0 found',
      '- Timestamp: 1786000000000',
      'ENHANCED CONTEXT ANALYSIS:',
    ];
    const mandatorySuffix = [NEXT_STEP];
    const declarationLine = '- function: completeFrame (line 1)';
    const marker =
      '- Declarations: bounded preview — showing 0 of 1 (selected nearest to the edit)';
    // Size the status line so the complete frame (mandatory + the single
    // declaration line + footer) lands exactly at the budget.
    const fillerLength =
      PREVIEW_LLM_MAX_BYTES -
      utf8Bytes(
        [
          statusPrefix,
          ...headWithoutStatus,
          ...mandatoryTail,
          declarationLine,
          ...mandatorySuffix,
        ].join('\n'),
      );
    const mandatoryHead = [
      `${statusPrefix}${'p'.repeat(fillerLength)}`,
      ...headWithoutStatus,
    ];

    const complete = [
      ...mandatoryHead,
      ...mandatoryTail,
      declarationLine,
      ...mandatorySuffix,
    ];
    expect(utf8Bytes(complete.join('\n'))).toBe(PREVIEW_LLM_MAX_BYTES);
    expect(
      utf8Bytes(
        [
          ...mandatoryHead,
          ...mandatoryTail,
          marker,
          declarationLine,
          ...mandatorySuffix,
        ].join('\n'),
      ),
    ).toBeGreaterThan(PREVIEW_LLM_MAX_BYTES);

    const result = assembleBoundedPreview({
      mandatoryHead,
      validationDetail: [],
      mandatoryTail,
      declarations: [declaration],
      anchorLine: 1,
      mandatorySuffix,
    });
    expect(result.renderedDeclarations).toBe(1);
    expect(result.totalDeclarations).toBe(1);
    expect(result.bounded).toBe(false);
    expect(result.lines).toContain(declarationLine);
    expect(result.lines.join('\n')).not.toContain('bounded preview');
    expect(utf8Bytes(result.lines.join('\n'))).toBeLessThanOrEqual(
      PREVIEW_LLM_MAX_BYTES,
    );
  });

  it('returns a structured EDIT_PREPARATION_FAILURE for a NUL-containing path', async () => {
    // Deterministic short-path preparation exception through the real tool:
    // Node/Bun fs bindings reject NUL bytes in path strings on every
    // platform before any OS call, so the real preview's preparation path
    // fails fast inside executePreview's try block — the same unwind the
    // assembler's budget throw takes. The ToolResult is a structured,
    // never-null EDIT_PREPARATION_FAILURE with a bounded message. (Real
    // assembler overflow itself is proven by the direct policy tests above;
    // an end-to-end oversized-mandatory workload is not used because the
    // natural ~37k-diagnostic shape trips a pre-existing Bun native-module
    // exit crash, and a 256 KiB filename is OS-sensitive and never reached
    // the assembler anyway.)
    const invalidPath = join(ctx.tempDir, 'inva\0lid.ts');

    const result = await runPreview(ctx.tempDir, invalidPath, {
      oldString: 'const existing = 1;',
      newString: 'const existing = 2;',
    });

    expect(result).not.toBeNull();
    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.EDIT_PREPARATION_FAILURE);
    const output = String(result.llmContent);
    expect(output.startsWith('Error preparing preview: ')).toBe(true);
    // The structured error message itself stays bounded.
    expect(utf8Bytes(output)).toBeLessThanOrEqual(PREVIEW_LLM_MAX_BYTES);
    expect(typeof result.returnDisplay).toBe('string');
    expect(String(result.returnDisplay).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Blocker-Fix: the mandatory AST validation summary line must stay bounded.
// ---------------------------------------------------------------------------

describe('Blocker-Fix: bounded mandatory AST validation summary label', () => {
  // Pure policy: summarizeAstValidation embeds every diagnostic line number
  // into its label, so a diagnostic-dense file yields a mandatory label that
  // alone exceeds the entire 256 KiB preview budget. The preview-only
  // formatter must keep ordinary labels byte-identical and replace oversized
  // ones with a fixed-width truthful classification. No parser workload is
  // involved: the synthetic labels mirror the categorizer's real output
  // shape (formatValidationLineLabel joins every line number with ", ").
  const OMITTED_NOTE = 'validation locations omitted for preview byte budget';

  function lineNumbers(count: number): string {
    const lines = Array.from({ length: count }, (_, index) => index + 1);
    return ` at lines ${lines.join(', ')}`;
  }

  it('keeps an ordinary summary label byte-identical', () => {
    const ordinary =
      'FAILED (pre-existing error at line 7 — present before this edit)';
    const ordinarySummary: AstValidationSummary = {
      status: 'FAILED',
      preExisting: true,
      newlyIntroduced: false,
      label: ordinary,
    };
    expect(boundedValidationSummaryLabel(ordinarySummary)).toBe(ordinary);
  });

  it('bounds an oversized pre-existing label so the mandatory line fits the budget', () => {
    const huge = `FAILED (pre-existing error${lineNumbers(50_000)} — present before this edit)`;
    // The old direct embedding was mandatory, non-droppable content that is
    // by itself larger than the entire successful-preview budget.
    expect(utf8Bytes(huge)).toBeGreaterThan(PREVIEW_LLM_MAX_BYTES);

    const bounded = boundedValidationSummaryLabel({
      status: 'FAILED',
      preExisting: true,
      newlyIntroduced: false,
      label: huge,
    });
    expect(bounded).toBe(
      `FAILED (pre-existing error — present before this edit; ${OMITTED_NOTE})`,
    );
    // Fixed-width output: bounded independent of the diagnostic count.
    expect(
      boundedValidationSummaryLabel({
        status: 'FAILED',
        preExisting: true,
        newlyIntroduced: false,
        label: `FAILED (pre-existing error${lineNumbers(60_000)} — present before this edit)`,
      }),
    ).toBe(bounded);

    // Assembled consequence: the raw oversized label makes the mandatory
    // frame unfittable (the preview would fail), the formatted label fits.
    const headWith = (validationLabel: string): readonly string[] => [
      'LLXPRT EDIT PREVIEW: /workspace/dense.ts',
      '- Context: typescript file with 0 declarations',
      '- Functions: 0',
      '- Classes: 0',
      `- AST validation: ${validationLabel}`,
    ];
    const frame = {
      mandatoryTail: [
        '- Relevant snippets: 0 found',
        '- Timestamp: 1786000000000',
        'ENHANCED CONTEXT ANALYSIS:',
      ],
      declarations: [] as EnhancedDeclaration[],
      anchorLine: 1,
      mandatorySuffix: [NEXT_STEP],
    };
    expect(() =>
      assembleBoundedPreview({
        mandatoryHead: headWith(huge),
        validationDetail: [],
        ...frame,
      }),
    ).toThrow(/alone exceeds the \d+-byte budget/);
    const assembled = assembleBoundedPreview({
      mandatoryHead: headWith(bounded),
      validationDetail: [],
      ...frame,
    });
    expect(utf8Bytes(assembled.lines.join('\n'))).toBeLessThanOrEqual(
      PREVIEW_LLM_MAX_BYTES,
    );
  });

  it('bounds an oversized newly-introduced label preserving the classification', () => {
    const huge = `FAILED (new error introduced by this edit${lineNumbers(50_000)})`;
    expect(utf8Bytes(huge)).toBeGreaterThan(PREVIEW_LLM_MAX_BYTES);

    const bounded = boundedValidationSummaryLabel({
      status: 'FAILED',
      preExisting: false,
      newlyIntroduced: true,
      label: huge,
    });
    expect(bounded).toBe(
      `FAILED (new error introduced by this edit; ${OMITTED_NOTE})`,
    );
    expect(utf8Bytes(bounded)).toBeLessThanOrEqual(256);
  });

  it('bounds an oversized mixed label preserving both classifications', () => {
    const huge = `FAILED (file had pre-existing errors${lineNumbers(25_000)}; post-edit errors${lineNumbers(25_000)} may be newly introduced)`;
    expect(utf8Bytes(huge)).toBeGreaterThan(PREVIEW_LLM_MAX_BYTES);

    const mixedSummary: AstValidationSummary = {
      status: 'FAILED',
      preExisting: true,
      newlyIntroduced: true,
      label: huge,
    };
    const bounded = boundedValidationSummaryLabel(mixedSummary);
    expect(bounded).toBe(
      `FAILED (file had pre-existing errors; post-edit errors may be newly introduced; ${OMITTED_NOTE})`,
    );
    expect(utf8Bytes(bounded)).toBeLessThanOrEqual(256);
  });

  it('bounds an oversized resolved-pre-existing PASSED label', () => {
    const huge = `PASSED (edit resolved pre-existing error${lineNumbers(50_000)})`;
    expect(utf8Bytes(huge)).toBeGreaterThan(PREVIEW_LLM_MAX_BYTES);

    const bounded = boundedValidationSummaryLabel({
      status: 'PASSED',
      preExisting: false,
      newlyIntroduced: false,
      label: huge,
    });
    expect(bounded).toBe(
      `PASSED (edit resolved pre-existing error; ${OMITTED_NOTE})`,
    );
    expect(utf8Bytes(bounded)).toBeLessThanOrEqual(256);
  });
});

// ---------------------------------------------------------------------------
// In-scope-Fix: CRLF old_string must anchor selection at the exact edit.
// ---------------------------------------------------------------------------

describe('In-scope-Fix: CRLF old_string anchors declaration selection', () => {
  const ctx = useTempDir();

  it('selects tail-adjacent declarations for a multiline CRLF old_string', async () => {
    const lines: string[] = [];
    for (let i = 0; i < 129; i++) {
      lines.push(`function c${String(i).padStart(3, '0')}(): void {}`);
    }
    const target = join(ctx.tempDir, 'crlf-129.ts');
    writeFileSync(target, `${lines.join('\r\n')}\r\n`, 'utf-8');

    // Multiline CRLF old_string covering the final two declarations: the
    // edit starts at line 128, so the selection must be tail-adjacent.
    const result = await runPreview(ctx.tempDir, target, {
      oldString: 'function c127(): void {}\r\nfunction c128(): void {}',
      newString: 'function c127r(): void {}\r\nfunction c128r(): void {}',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('- function: c128 (line 129)');
    expect(output).not.toContain('- function: c000 (line 1)');
    const marker =
      /- Declarations: bounded preview — showing (\d+) of (\d+)/.exec(output);
    expect(marker).not.toBeNull();
    expect(Number(marker?.[1])).toBe(PREVIEW_MAX_DECLARATIONS);
    expect(Number(marker?.[2])).toBe(129);
  });

  it('keeps whole-file recovery validation anchored at the CRLF edit region', async () => {
    const lines: string[] = [];
    for (let i = 0; i < 129; i++) {
      lines.push(`@ marker ${i}`);
    }
    const target = join(ctx.tempDir, 'crlf-recovery.ts');
    writeFileSync(target, `${lines.join('\r\n')}\r\n`, 'utf-8');

    const result = await runPreview(ctx.tempDir, target, {
      oldString: '@ marker 127\r\n@ marker 128',
      newString: '@ marker 127 edited\r\n@ marker 128 edited',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    const astErrorsLine = previewLine(output, '- AST errors: ');
    expect(astErrorsLine).toContain('near line 128');
    expect(astErrorsLine).not.toContain('near line 1 ');
  });
});

// ---------------------------------------------------------------------------
// In-scope-Fix: the preview context itself must retain at most 64 snippets.
// ---------------------------------------------------------------------------

describe('In-scope-Fix: preview context retains the bounded snippet collection', () => {
  const ctx = useTempDir();

  function writeSnippetFixture(): { target: string; content: string } {
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push(`function f${i}(): void {}`);
    }
    const content = `${lines.join('\n')}\n`;
    const target = join(ctx.tempDir, 'snippet-retention.ts');
    writeFileSync(target, content, 'utf-8');
    return { target, content };
  }

  it('bounds the preview-shaped collector result to 64 retained snippet items', async () => {
    const { target, content } = writeSnippetFixture();
    const collector = new ASTContextCollector();

    // The exact preview-shaped real collector path: the returned context —
    // the object preview renders and retains from — must itself hold only
    // the bounded collection, releasing the omitted snippet objects.
    const context = await collector.collectEnhancedContext(
      target,
      content,
      ctx.tempDir,
      {
        collectWorkingSet: false,
        collectRepositoryContext: false,
        previewSnippetItemCap: PREVIEW_MAX_SNIPPETS,
      },
    );
    expect(context.relevantSnippets).toHaveLength(PREVIEW_MAX_SNIPPETS);
    expect(context.relevantSnippetTotal).toBe(77);
    // The 64 retained items are the policy-ordered first 64 of the full
    // collection (priority, then relevance), not a re-ranked subset.
    const uncapped = await collector.collectEnhancedContext(
      target,
      content,
      ctx.tempDir,
      { collectWorkingSet: false, collectRepositoryContext: false },
    );
    expect(uncapped.relevantSnippets).toHaveLength(77);
    expect(context.relevantSnippets.map((snippet) => snippet.text)).toEqual(
      uncapped.relevantSnippets
        .slice(0, PREVIEW_MAX_SNIPPETS)
        .map((snippet) => snippet.text),
    );
  });

  it('reports the retained snippet count with the truthful capped-from total', async () => {
    const { target, content } = writeSnippetFixture();

    // The shown count must be the count the preview context actually
    // retains, taken from the same real preview-shaped collector path the
    // tool uses, so the report and retention cannot silently diverge.
    const collector = new ASTContextCollector();
    const context = await collector.collectEnhancedContext(
      target,
      content,
      ctx.tempDir,
      {
        collectWorkingSet: false,
        collectRepositoryContext: false,
        previewSnippetItemCap: PREVIEW_MAX_SNIPPETS,
      },
    );
    const retained = context.relevantSnippets.length;
    const total = context.relevantSnippetTotal ?? retained;
    expect(retained).toBe(PREVIEW_MAX_SNIPPETS);
    expect(total).toBe(77);

    const result = await runPreview(ctx.tempDir, target, {
      oldString: 'function f0(): void {}',
      newString: 'function f0(): number { return 1; }',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(previewLine(output, '- Relevant snippets: ')).toBe(
      `- Relevant snippets: ${retained} found (capped from ${total})`,
    );
  });
});
