/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral regression tests for issue #3242.
 *
 * REQ-3242-1: ast_edit preview opts out of repository relationship context
 * (no repository metadata, no symbol index, no native related-symbol
 * traversal) while apply semantics stay intact.
 * REQ-3242-2: preview declarations are selected by absolute line distance
 * from the exact replacement start (deterministic line-order tie break),
 * capped at 128, rendered in source order, with a truthful bounded
 * selected/total marker once a file exceeds the cap.
 * REQ-3242-3: the complete preview ToolResult.llmContent is valid UTF-8 and
 * at most 256 KiB; mandatory status, timestamp, bounded marker, and the
 * next-step instruction are reserved before optional declaration detail.
 * REQ-3242-4: preview followed immediately by force=true applies the exact
 * requested bytes using the preview timestamp.
 *
 * All fixtures are real files exercised through the real ASTEditTool. The
 * expected declaration selection is computed with the real production
 * extractor as the oracle, never by mocking the tool.
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASTEditTool } from '../../ast-edit.js';
import { ASTQueryExtractor } from '../ast-query-extractor.js';
import type { EnhancedDeclaration } from '../types.js';
import type { ToolResult } from '../../tools.js';
import { createFakeToolHost, useTempDir } from './test-helpers.js';
import { gitCommitAll, gitInit } from './ast-read-git-fixtures.js';
import {
  RUST_FIXTURE_LINE_COUNT,
  generateRustFixture,
} from './ast-edit-3242-fixtures.js';

const PREVIEW_MAX_DECLARATIONS = 128;
const PREVIEW_MAX_SNIPPETS = 64;
const PREVIEW_LLM_MAX_BYTES = 256 * 1024;
const NEXT_STEP = 'NEXT STEP: Call again with force: true to apply changes';

interface RenderedDeclaration {
  readonly raw: string;
  readonly name: string;
  readonly line: number;
}

function renderedDeclarations(output: string): RenderedDeclaration[] {
  const rendered: RenderedDeclaration[] = [];
  for (const match of output.matchAll(/^- [a-z]+: (.+) \(line (\d+)\)$/gm)) {
    rendered.push({
      raw: match[0],
      name: match[1],
      line: Number(match[2]),
    });
  }
  return rendered;
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

interface RankedDeclaration {
  readonly declaration: EnhancedDeclaration;
  /** Original extractor-array index, attached before any sorting. */
  readonly sourceIndex: number;
}

function sourceOrder(a: RankedDeclaration, b: RankedDeclaration): number {
  const byLine = a.declaration.line - b.declaration.line;
  if (byLine !== 0) {
    return byLine;
  }
  const byColumn = a.declaration.column - b.declaration.column;
  if (byColumn !== 0) {
    return byColumn;
  }
  return a.sourceIndex - b.sourceIndex;
}

/**
 * Oracle for the accepted selection policy: attach each real-extractor
 * declaration's original array index before any sorting (the extractor
 * lists kinds in family order, not document order, so that index is what
 * production preserves for same-line ties), keep the 128 declarations
 * nearest the edit start line (ties break to the earlier line, then to
 * the earlier original extractor index), then render the kept set back in
 * true source order.
 */
function expectedPreviewDeclarationLines(
  declarations: readonly EnhancedDeclaration[],
  editStartLine: number,
): string[] {
  const byProximity = declarations
    .map((declaration, sourceIndex) => ({ declaration, sourceIndex }))
    .sort((a, b) => {
      const byDistance =
        Math.abs(a.declaration.line - editStartLine) -
        Math.abs(b.declaration.line - editStartLine);
      if (byDistance !== 0) {
        return byDistance;
      }
      const byLine = a.declaration.line - b.declaration.line;
      if (byLine !== 0) {
        return byLine;
      }
      return a.sourceIndex - b.sourceIndex;
    });
  return byProximity
    .slice(0, PREVIEW_MAX_DECLARATIONS)
    .sort(sourceOrder)
    .map(
      (entry) =>
        `- ${entry.declaration.type}: ${entry.declaration.name} (line ${entry.declaration.line})`,
    );
}

function boundedMarker(
  output: string,
): { shown: number; total: number } | null {
  const match = /- Declarations: bounded preview — showing (\d+) of (\d+)/.exec(
    output,
  );
  if (match === null) {
    return null;
  }
  return { shown: Number(match[1]), total: Number(match[2]) };
}

function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, 'utf-8');
}

// ---------------------------------------------------------------------------
// REQ-3242-1: preview repository relationship fan-out is unreachable.
// ---------------------------------------------------------------------------

describe('REQ-3242-1: ast_edit preview repository opt-out', () => {
  const ctx = useTempDir();

  it('renders no repository relationship context during preview in a Git workspace', async () => {
    gitInit(ctx.tempDir);
    writeFileSync(
      join(ctx.tempDir, 'dep.ts'),
      'import { Alpha } from "./target";\nexport function user(): Alpha { return null as Alpha; }\n',
      'utf-8',
    );
    const target = join(ctx.tempDir, 'target.ts');
    writeFileSync(
      target,
      'export class Alpha {\n  public run(): void {}\n}\nexport function betaWorker(): number { return 1; }\n',
      'utf-8',
    );
    gitCommitAll(ctx.tempDir, 'fixture');

    const result = await runPreview(ctx.tempDir, target, {
      oldString: 'public run(): void {}',
      newString: 'public runFast(): void {}',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('LLXPRT EDIT PREVIEW: ');
    expect(output).not.toContain('- Repository:');
    expect(output).not.toContain('- Related files:');
    expect(output).not.toContain('RELATED SYMBOLS:');
  });

  it('still applies with force=true in the same Git workspace after opting out', async () => {
    gitInit(ctx.tempDir);
    const target = join(ctx.tempDir, 'target.ts');
    writeFileSync(
      target,
      'export class Alpha {\n  public run(): void {}\n}\nexport function betaWorker(): number { return 1; }\n',
      'utf-8',
    );
    gitCommitAll(ctx.tempDir, 'fixture');

    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));
    const result = await tool
      .build({
        file_path: target,
        old_string: 'public run(): void {}',
        new_string: 'public runQuick(): void {}',
        force: true,
      })
      .execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain('Successfully applied edit to');
    expect(readFileSync(target, 'utf-8')).toContain(
      'public runQuick(): void {}',
    );
  });
});

// ---------------------------------------------------------------------------
// REQ-3242-2: proximity-prioritized, bounded declaration context.
// ---------------------------------------------------------------------------

describe('REQ-3242-2: bounded proximity declaration context', () => {
  const ctx = useTempDir();

  it('fixture is 5,250 lines with at least 170 real parsed declarations', async () => {
    const fixture = generateRustFixture();
    expect(fixture.lineCount).toBe(RUST_FIXTURE_LINE_COUNT);
    expect((fixture.content.match(/\n/g) ?? []).length).toBe(
      RUST_FIXTURE_LINE_COUNT,
    );
    const target = join(ctx.tempDir, 'target.rs');
    writeFileSync(target, fixture.content, 'utf-8');

    const declarations = await new ASTQueryExtractor().extractDeclarations(
      target,
      fixture.content,
    );
    expect(declarations.length).toBeGreaterThanOrEqual(170);
  });

  it('selects the 128 declarations nearest a middle edit and renders them in source order', async () => {
    const fixture = generateRustFixture();
    const target = join(ctx.tempDir, 'target.rs');
    writeFileSync(target, fixture.content, 'utf-8');
    const declarations = await new ASTQueryExtractor().extractDeclarations(
      target,
      fixture.content,
    );

    const result = await runPreview(ctx.tempDir, target, fixture.edits.middle);
    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);

    const total = declarations.length;
    const rendered = renderedDeclarations(output);
    expect(rendered).toHaveLength(PREVIEW_MAX_DECLARATIONS);

    const expected = expectedPreviewDeclarationLines(
      declarations,
      fixture.edits.middle.line,
    );
    expect(rendered.map((entry) => entry.raw)).toEqual(expected);

    const lines = rendered.map((entry) => entry.line);
    const sorted = [...lines].sort((a, b) => a - b);
    expect(lines).toEqual(sorted);

    const marker = boundedMarker(output);
    expect(marker).toEqual({ shown: PREVIEW_MAX_DECLARATIONS, total });
    expect(output).toContain(`- Context: rust file with ${total} declarations`);
    expect(output).toContain('- function: worker_090 (line');
    expect(output).not.toContain('- function: worker_000 (line');
  });

  it('selects head-adjacent declarations for an edit near the top of the file', async () => {
    const fixture = generateRustFixture();
    const target = join(ctx.tempDir, 'target.rs');
    writeFileSync(target, fixture.content, 'utf-8');

    const result = await runPreview(ctx.tempDir, target, fixture.edits.head);
    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);

    const rendered = renderedDeclarations(output);
    expect(rendered).toHaveLength(PREVIEW_MAX_DECLARATIONS);
    expect(output).toContain('- function: worker_000 (line 31)');
    expect(output).not.toContain('- function: worker_179 (line');
    expect(boundedMarker(output)).not.toBeNull();
  });

  it('selects tail-adjacent declarations for an edit near the end of the file', async () => {
    const fixture = generateRustFixture();
    const target = join(ctx.tempDir, 'target.rs');
    writeFileSync(target, fixture.content, 'utf-8');

    const result = await runPreview(ctx.tempDir, target, fixture.edits.tail);
    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);

    const rendered = renderedDeclarations(output);
    expect(rendered).toHaveLength(PREVIEW_MAX_DECLARATIONS);
    expect(output).toContain('- function: worker_179 (line');
    expect(output).not.toContain('- function: worker_000 (line 31)');
    expect(boundedMarker(output)).not.toBeNull();
  });

  it('renders every declaration and emits no bounded marker for exactly 128 declarations', async () => {
    const lines: string[] = [];
    for (let i = 0; i < 128; i++) {
      lines.push(`function f${String(i).padStart(3, '0')}(): void {}`);
    }
    const target = join(ctx.tempDir, 'exact-128.ts');
    writeFileSync(target, `${lines.join('\n')}\n`, 'utf-8');

    const result = await runPreview(ctx.tempDir, target, {
      oldString: 'function f000(): void {}',
      newString: 'function f000(): number { return 1; }',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(renderedDeclarations(output)).toHaveLength(128);
    expect(output).toContain('- function: f127 (line 128)');
    expect(boundedMarker(output)).toBeNull();
  });

  it('renders 128 of 129 declarations with a bounded marker for one over', async () => {
    const lines: string[] = [];
    for (let i = 0; i < 129; i++) {
      lines.push(`function f${String(i).padStart(3, '0')}(): void {}`);
    }
    const target = join(ctx.tempDir, 'one-over-129.ts');
    writeFileSync(target, `${lines.join('\n')}\n`, 'utf-8');

    const result = await runPreview(ctx.tempDir, target, {
      oldString: 'function f000(): void {}',
      newString: 'function f000(): number { return 1; }',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(renderedDeclarations(output)).toHaveLength(128);
    expect(output).toContain('- function: f127 (line 128)');
    expect(output).not.toContain('- function: f128 (line 129)');
    expect(boundedMarker(output)).toEqual({ shown: 128, total: 129 });
  });

  it('prefers the nearest declarations across large line gaps in a sparse file', async () => {
    const lines: string[] = [];
    for (let i = 0; i < 130; i++) {
      lines.push(
        `function sparse_decl_${String(i).padStart(3, '0')}(): void {}`,
      );
      for (let j = 0; j < 19; j++) {
        lines.push(`// sparse filler ${i}_${j}`);
      }
    }
    const target = join(ctx.tempDir, 'sparse.ts');
    writeFileSync(target, `${lines.join('\n')}\n`, 'utf-8');

    // Anchor is the last filler line of block 127: line 2541 + 19 = 2560.
    const anchorLine = 2560;
    const result = await runPreview(ctx.tempDir, target, {
      oldString: '// sparse filler 127_18',
      newString: '// sparse filler 127_18 edited',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    const rendered = renderedDeclarations(output);
    expect(rendered).toHaveLength(128);
    expect(boundedMarker(output)).toEqual({ shown: 128, total: 130 });
    expect(output).not.toContain('sparse_decl_000');
    expect(output).not.toContain('sparse_decl_001');
    expect(output).toContain('- function: sparse_decl_127 (line 2541)');
    expect(output).toContain('- function: sparse_decl_128 (line 2561)');
    expect(output).toContain('- function: sparse_decl_129 (line 2581)');
    const expected = expectedPreviewDeclarationLines(
      await new ASTQueryExtractor().extractDeclarations(
        target,
        readFileSync(target, 'utf-8'),
      ),
      anchorLine,
    );
    expect(rendered.map((entry) => entry.raw)).toEqual(expected);
  });

  it('breaks distance ties deterministically in favor of the earlier line', async () => {
    const lines: string[] = [];
    for (let i = 1; i <= 128; i++) {
      lines.push(`function d${String(i).padStart(3, '0')}(): void {}`);
    }
    for (let i = 0; i < 130; i++) {
      lines.push(`// tie filler ${String(i).padStart(3, '0')}`);
    }
    lines.push('function dSpecial(): void {}');
    const target = join(ctx.tempDir, 'tie-break.ts');
    writeFileSync(target, `${lines.join('\n')}\n`, 'utf-8');

    // Anchor at line 130: d001 (line 1) and dSpecial (line 259) are both 129
    // lines away and compete for the final slot; the earlier line wins.
    const result = await runPreview(ctx.tempDir, target, {
      oldString: '// tie filler 001',
      newString: '// tie filler 001 edited',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(renderedDeclarations(output)).toHaveLength(128);
    expect(boundedMarker(output)).toEqual({ shown: 128, total: 129 });
    expect(output).toContain('- function: d001 (line 1)');
    expect(output).not.toContain('dSpecial');
  });

  it('breaks same-line proximity ties by original extractor order at the selection boundary', async () => {
    const lines: string[] = [
      // Same-line pair: the variable starts at the earlier column, but the
      // extractor lists every function before any variable, so the function
      // holds the earlier original extractor index.
      'const v = 1; function dSpecial(): void {}',
    ];
    for (let i = 1; i <= 127; i++) {
      lines.push(`function d${String(i).padStart(3, '0')}(): void {}`);
    }
    lines.push('// same-line filler anchor');
    const target = join(ctx.tempDir, 'same-line-tie.ts');
    writeFileSync(target, `${lines.join('\n')}\n`, 'utf-8');

    // Anchor at line 129: d001..d127 occupy distances 127 down to 1, so the
    // same-line pair (both distance 128) competes for the final slot.
    const anchorLine = 129;
    const result = await runPreview(ctx.tempDir, target, {
      oldString: '// same-line filler anchor',
      newString: '// same-line filler anchor edited',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    const rendered = renderedDeclarations(output);
    expect(rendered).toHaveLength(PREVIEW_MAX_DECLARATIONS);
    expect(boundedMarker(output)).toEqual({ shown: 128, total: 129 });
    // The same-line tie resolves by original extractor index, not column:
    // the function wins the final slot over the column-earlier variable.
    expect(output).toContain('- function: dSpecial (line 1)');
    expect(output).not.toContain('- variable: v (line 1)');
    const expected = expectedPreviewDeclarationLines(
      await new ASTQueryExtractor().extractDeclarations(
        target,
        readFileSync(target, 'utf-8'),
      ),
      anchorLine,
    );
    expect(rendered.map((entry) => entry.raw)).toEqual(expected);
  });

  it('succeeds with zero declaration context for a new file', async () => {
    const target = join(ctx.tempDir, 'brand-new-file.ts');
    const result = await runPreview(ctx.tempDir, target, {
      oldString: '',
      newString: 'const brandNew = 42;\n',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('- Context: typescript file with 0 declarations');
    expect(renderedDeclarations(output)).toHaveLength(0);
    expect(boundedMarker(output)).toBeNull();
    expect(output).toContain(NEXT_STEP);
  });

  it('succeeds with zero declaration context for a declaration-free file', async () => {
    const target = join(ctx.tempDir, 'declaration-free.ts');
    writeFileSync(target, "console.log('no declarations here');\n", 'utf-8');

    const result = await runPreview(ctx.tempDir, target, {
      oldString: "console.log('no declarations here');",
      newString: "console.log('still no declarations');",
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('- Context: typescript file with 0 declarations');
    expect(renderedDeclarations(output)).toHaveLength(0);
    expect(output).toContain(NEXT_STEP);
  });
});

// ---------------------------------------------------------------------------
// REQ-3242-3: model-facing preview content has a hard UTF-8 byte budget.
// ---------------------------------------------------------------------------

describe('REQ-3242-3: bounded preview llmContent byte budget', () => {
  const ctx = useTempDir();

  it('keeps ordinary preview output within the budget with compatible wording', async () => {
    const target = join(ctx.tempDir, 'ordinary.ts');
    const content =
      'export function greet(name: string): string {\n  return `hello ${name}`;\n}\nexport class Greeter {}\n';
    writeFileSync(target, content, 'utf-8');

    const result = await runPreview(ctx.tempDir, target, {
      oldString: 'export function greet(name: string): string {',
      newString: 'export function wave(name: string): string {',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(utf8Bytes(output)).toBeLessThanOrEqual(PREVIEW_LLM_MAX_BYTES);
    expect(output).toContain('LLXPRT EDIT PREVIEW: ');
    expect(output).toContain('- Context: typescript file with 2 declarations');
    expect(output).toContain('- Functions: 1');
    expect(output).toContain('- Classes: 1');
    expect(output).toContain('AST validation: PASSED');
    expect(output).toContain('- Timestamp: ');
    expect(output).toContain('ENHANCED CONTEXT ANALYSIS:');
    expect(output).toContain('- function: greet (line 1)');
    expect(output).toContain('- class: Greeter (line 4)');
    expect(output).toContain(NEXT_STEP);
    expect(boundedMarker(output)).toBeNull();
  });

  it('drops the farthest declaration lines first when detail exceeds the budget', async () => {
    const hugeName = 'a'.repeat(3000);
    const lines: string[] = [];
    for (let i = 0; i < 129; i++) {
      lines.push(
        `function ${hugeName}${String(i).padStart(3, '0')}(): void {}`,
      );
    }
    const target = join(ctx.tempDir, 'over-budget.ts');
    writeFileSync(target, `${lines.join('\n')}\n`, 'utf-8');

    const result = await runPreview(ctx.tempDir, target, {
      oldString: `function ${hugeName}000(): void {}`,
      newString: `function ${hugeName}000(): number { return 1; }`,
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(utf8Bytes(output)).toBeLessThanOrEqual(PREVIEW_LLM_MAX_BYTES);

    const marker = boundedMarker(output);
    expect(marker).not.toBeNull();
    expect(marker?.total).toBe(129);
    expect(marker?.shown).toBeLessThan(PREVIEW_MAX_DECLARATIONS);
    expect(renderedDeclarations(output)).toHaveLength(marker?.shown ?? -1);
    // Mandatory lines survive the budget drop.
    expect(output).toContain('- Timestamp: ');
    expect(output).toContain(NEXT_STEP);
    expect(output).toContain('LLXPRT EDIT PREVIEW: ');
    // Nearest declaration detail survives; the farthest lines were dropped.
    expect(output).toContain(`${hugeName}000`);
    expect(output).not.toContain(`${hugeName}128`);
  });

  it('renders only complete multibyte declaration lines at the byte boundary', async () => {
    const multibyteName = '語'.repeat(900);
    const lines: string[] = [];
    for (let i = 0; i < 129; i++) {
      lines.push(
        `function ${multibyteName}${String(i).padStart(3, '0')}(): void {}`,
      );
    }
    const target = join(ctx.tempDir, 'multibyte.ts');
    writeFileSync(target, `${lines.join('\n')}\n`, 'utf-8');

    const result = await runPreview(ctx.tempDir, target, {
      oldString: `function ${multibyteName}000(): void {}`,
      newString: `function ${multibyteName}000(): number { return 1; }`,
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    // Total encoded multibyte output stays within the hard cap.
    expect(utf8Bytes(output)).toBeLessThanOrEqual(PREVIEW_LLM_MAX_BYTES);

    const marker = boundedMarker(output);
    expect(marker).not.toBeNull();
    expect(marker?.total).toBe(129);
    expect(marker?.shown).toBeLessThan(PREVIEW_MAX_DECLARATIONS);

    // Every rendered declaration is a COMPLETE line — its name is one of
    // the fixture's full multibyte names (multibyte prefix plus padded
    // index), never a byte-truncated fragment — and the rendered count
    // matches the marker's truthful shown count.
    const rendered = renderedDeclarations(output);
    expect(rendered).toHaveLength(marker?.shown ?? -1);
    const completeNames = new Set(
      Array.from(
        { length: 129 },
        (_, i) => `${multibyteName}${String(i).padStart(3, '0')}`,
      ),
    );
    expect(rendered.length).toBeGreaterThan(0);
    for (const entry of rendered) {
      expect(completeNames.has(entry.name)).toBe(true);
    }
    // The nearest complete multibyte declaration survives byte-budget
    // dropping, and the complete farthest declaration does not.
    expect(output).toContain(`- function: ${multibyteName}000 (line 1)`);
    expect(output).not.toContain(`${multibyteName}128`);
    // Mandatory lines survive the budget drop alongside the multibyte detail.
    expect(output).toContain('- Timestamp: ');
    expect(output).toContain(NEXT_STEP);
  });

  it('caps reported relevant snippets at 64 for a symbol-dense file', async () => {
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push(`function f${i}(): void {}`);
    }
    const target = join(ctx.tempDir, 'snippet-cap.ts');
    writeFileSync(target, `${lines.join('\n')}\n`, 'utf-8');

    const result = await runPreview(ctx.tempDir, target, {
      oldString: 'function f0(): void {}',
      newString: 'function f0(): number { return 1; }',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toMatch(
      new RegExp(
        `^- Relevant snippets: ${PREVIEW_MAX_SNIPPETS} found \\(capped from \\d+\\)$`,
        'm',
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// REQ-3242-4: preview followed immediately by force apply.
// ---------------------------------------------------------------------------

describe('REQ-3242-4: preview then force apply on the large fixture', () => {
  const ctx = useTempDir();

  it('applies the exact requested bytes immediately after preview using the preview timestamp', async () => {
    const fixture = generateRustFixture();
    const target = join(ctx.tempDir, 'target.rs');
    writeFileSync(target, fixture.content, 'utf-8');

    const preview = await runPreview(ctx.tempDir, target, fixture.edits.middle);
    expect(preview.error).toBeUndefined();
    const previewOutput = String(preview.llmContent);
    const timestampMatch = /- Timestamp: (\d+)/.exec(previewOutput);
    expect(timestampMatch).not.toBeNull();
    expect(boundedMarker(previewOutput)).toEqual({
      shown: PREVIEW_MAX_DECLARATIONS,
      total: 184,
    });

    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));
    const apply = await tool
      .build({
        file_path: target,
        old_string: fixture.edits.middle.oldString,
        new_string: fixture.edits.middle.newString,
        force: true,
        last_modified: Number(timestampMatch?.[1]),
      })
      .execute(new AbortController().signal);

    expect(apply.error).toBeUndefined();
    expect(String(apply.llmContent)).toContain('Successfully applied edit to');
    expect(utf8Bytes(String(apply.llmContent))).toBeGreaterThan(0);

    const expectedContent = fixture.content.replace(
      fixture.edits.middle.oldString,
      fixture.edits.middle.newString,
    );
    expect(readFileSync(target, 'utf-8')).toBe(expectedContent);
  });
});
