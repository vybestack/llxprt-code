/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for the issue #3035 review remediations.
 *
 * Each describe block maps to a classified review finding:
 * - Finding 1 (Blocker): validate/compare EVERY relevant parser diagnostic, not
 *   only the first ERROR node, so a pre-existing early error cannot mask a
 *   newly introduced later error.
 * - Finding 2 (Blocker): whole-file recovery is only equivalent to a baseline
 *   whole-file recovery; fail closed otherwise, but stay writable when an
 *   unchanged baseline whole-file recovery remains after a harmless edit.
 * - Finding 3 (In-scope): IDE-accepted content is classified from the actual
 *   original-to-candidate diff, not the model's old/new line metadata.
 * - Finding 4 (In-scope): ast_read_file keeps working-set context while
 *   ast_edit preview omits it.
 * - Finding 5 (In-scope): coherent messages — definitive "resolved" wording and
 *   current post-edit coordinates for retained pre-existing errors.
 *
 * Plus accepted evidence gaps: force-schema behavioral assertion, nested
 * invalid-new-file, and preview-path mtime text assertion.
 *
 * Tests use real files, real git state, real parser behavior. No mocking of the
 * tool under test.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  utimesSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  useTempDir,
  createFakeToolHost,
  executePreview,
  executeApply,
} from './test-helpers.js';
import { ASTEditTool, ASTReadFileTool } from '../../ast-edit.js';
import { ToolErrorType } from '../../../types/tool-error.js';
import { createDefaultToolHost } from '../../edit-utils.js';
import { ToolConfirmationOutcome } from '../../tools.js';
import type {
  IToolHost,
  IIdeService,
  DiffUpdateResult,
  IDEConnectionStatus,
} from '../../../interfaces/index.js';
import type { ToolEditConfirmationDetails } from '../../tools.js';

// ---------------------------------------------------------------------------
// Finding 1 (Blocker): collect and compare every relevant parser diagnostic.
// ---------------------------------------------------------------------------

describe('Finding 1 (Blocker): a pre-existing early error must not mask a later new error', () => {
  const ctx = useTempDir();

  it('refuses a TypeScript edit whose new later error is masked by an earlier pre-existing error', async () => {
    // Line 2 has a pre-existing @@@ error. The edit introduces a SEPARATE
    // {{{ error at line 10. The first-only ERROR lookup must not mask line 10.
    const filePath = join(ctx.tempDir, 'mask-ts.ts');
    const original = [
      'const a = 1;',
      'const broken = @@@;',
      'const b = 2;',
      'const c = 3;',
      'const d = 4;',
      'const e = 5;',
      'const f = 6;',
      'const g = 7;',
      'const h = 8;',
      'const z = 10;',
      '',
    ].join('\n');
    writeFileSync(filePath, original, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'const z = 10;',
      new_string: 'const z = {{{ 10;',
    });

    // The later new error must be detected and the write refused.
    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.AST_SYNTAX_ERROR);
    // File must remain byte-for-byte unchanged.
    expect(readFileSync(filePath, 'utf-8')).toBe(original);
  });

  it('refuses a Python edit with the same masking pattern (non-JS language)', async () => {
    const filePath = join(ctx.tempDir, 'mask-py.py');
    const original = [
      'x = 1',
      'broken = @@@',
      'b = 2',
      'c = 3',
      'd = 4',
      'e = 5',
      'f = 6',
      'g = 7',
      'h = 8',
      'z = 10',
      '',
    ].join('\n');
    writeFileSync(filePath, original, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'z = 10',
      new_string: 'z = {{{ 10',
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.AST_SYNTAX_ERROR);
    expect(readFileSync(filePath, 'utf-8')).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// Finding 2 (Blocker): whole-file recovery equivalence + fail-closed.
// ---------------------------------------------------------------------------

describe('Finding 2 (Blocker): whole-file recovery equivalence', () => {
  const ctx = useTempDir();

  it('stays writable when an unchanged baseline whole-file recovery remains after a harmless edit', async () => {
    // Baseline content triggers a whole-file tree-sitter recovery (the
    // unclosed `return {{{`). A harmless edit to the trailing marker line must
    // not be classified as newly-introduced damage.
    const filePath = join(ctx.tempDir, 'whole-keep.ts');
    const baseline = [
      'class Foo {',
      '  bar() {',
      '    return {{{',
      '  }',
      '}',
      'const marker = 1;',
      '',
    ].join('\n');
    writeFileSync(filePath, baseline, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'const marker = 1;',
      new_string: 'const marker = 2;',
    });

    // Pre-existing whole-file recovery remains → writable.
    expect(result.error).toBeUndefined();
    expect(readFileSync(filePath, 'utf-8')).toContain('const marker = 2;');
  });

  it('fails closed (refuses) when a post whole-file recovery is not equivalent to a precise baseline', async () => {
    // Baseline has a PRECISE @@@ error at line 1. The edit introduces a
    // whole-file recovery in the class body. A whole-file recovery cannot be
    // proven equivalent to a precise baseline error → fail closed.
    const filePath = join(ctx.tempDir, 'whole-failclosed.ts');
    const original = [
      'const broken = @@@;',
      'class Foo {',
      '  bar() {',
      '    return 1;',
      '  }',
      '}',
      '',
    ].join('\n');
    writeFileSync(filePath, original, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: '    return 1;',
      new_string: '    return {{{',
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.AST_SYNTAX_ERROR);
    expect(readFileSync(filePath, 'utf-8')).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// Finding 3 (In-scope): exact IDE candidate classification.
// ---------------------------------------------------------------------------

/**
 * A recording fake IIdeService whose applyDiff resolves with a configurable
 * accepted content. Behavioral: the real confirmation/execute flow consumes it.
 */
function fakeIdeService(
  status: IDEConnectionStatus,
  acceptedContent: string | undefined,
): IIdeService {
  return {
    getConnectionStatus: () => status,
    applyDiff: async (): Promise<DiffUpdateResult> => ({
      status: 'accepted',
      content: acceptedContent,
    }),
    openDiff: async () => {},
  };
}

/**
 * Drives the full IDE confirmation → execute flow: the IDE returns the given
 * accepted content, which becomes the final write candidate.
 */
async function executeApplyWithIdeContent(
  tool: ASTEditTool,
  filePath: string,
  oldString: string,
  newString: string,
) {
  const invocation = tool.build({
    file_path: filePath,
    old_string: oldString,
    new_string: newString,
    force: true,
  });
  const confirmation = (await invocation.shouldConfirmExecute(
    new AbortController().signal,
  )) as ToolEditConfirmationDetails;
  await confirmation.onConfirm(ToolConfirmationOutcome.ProceedOnce);
  return invocation.execute(new AbortController().signal);
}

describe('Finding 3 (In-scope): IDE-accepted content classified from the actual diff', () => {
  let tmpDir: string;
  let host: IToolHost;

  // Local (non-shared) temp dir so the manual git/init-free host setup is
  // isolated from the shared useTempDir lifecycle.
  beforeEach(() => {
    tmpDir = join(
      tmpdir(),
      `ast-edit-ide-review-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tmpDir, { recursive: true });
    host = {
      ...createDefaultToolHost(),
      getTargetDir: () => tmpDir,
      getWorkspaceRoots: () => [tmpDir],
      // Manual approval so shouldConfirmExecute produces confirmation details.
      getApprovalMode: () => 'default',
    };
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes an IDE-accepted valid layout change that shifts an unchanged pre-existing error', async () => {
    // Baseline has a pre-existing @@@ error on line 2. The IDE-accepted
    // candidate inserts a line ABOVE the error, shifting it to line 3 — a
    // valid, harmless layout change that must remain writable.
    const filePath = join(tmpDir, 'ide-shift.ts');
    writeFileSync(filePath, 'const keep = 1;\nconst broken = @@@;\n', 'utf-8');
    const ide = fakeIdeService(
      'connected',
      'const keep = 2;\nconst newLine = 3;\nconst broken = @@@;\n',
    );
    const tool = new ASTEditTool(host, ide);

    const result = await executeApplyWithIdeContent(
      tool,
      filePath,
      'const keep = 1;',
      'const keep = 2;',
    );

    // The shifted pre-existing error is not newly introduced → writable.
    expect(result.error).toBeUndefined();
    expect(readFileSync(filePath, 'utf-8')).toBe(
      'const keep = 2;\nconst newLine = 3;\nconst broken = @@@;\n',
    );
  });

  it('refuses IDE-accepted new syntax damage on previously clean content and leaves the original unchanged', async () => {
    const filePath = join(tmpDir, 'ide-damage.ts');
    const original = 'const a = 1;\nconst b = 2;\n';
    writeFileSync(filePath, original, 'utf-8');
    const ide = fakeIdeService('connected', 'const a = 1;\nconst b = {{{ 3;\n');
    const tool = new ASTEditTool(host, ide);

    const result = await executeApplyWithIdeContent(
      tool,
      filePath,
      'const b = 2;',
      'const b = 3;',
    );

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.AST_SYNTAX_ERROR);
    expect(readFileSync(filePath, 'utf-8')).toBe(original);
  });

  it('refuses an already-broken baseline plus a distinct new IDE error and leaves the original unchanged', async () => {
    // Baseline error at line 1 (@@@). The IDE candidate keeps that error AND
    // adds a new {{{ error on a later line. Both must be compared; the new one
    // is unmatched → refused.
    const filePath = join(tmpDir, 'ide-distinct.ts');
    const original = 'const broken = @@@;\nconst a = 1;\n';
    writeFileSync(filePath, original, 'utf-8');
    const ide = fakeIdeService(
      'connected',
      'const broken = @@@;\nconst a = 2;\nconst newErr = {{{;\n',
    );
    const tool = new ASTEditTool(host, ide);

    const result = await executeApplyWithIdeContent(
      tool,
      filePath,
      'const a = 1;',
      'const a = 2;',
    );

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.AST_SYNTAX_ERROR);
    expect(readFileSync(filePath, 'utf-8')).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// Line-1 edit region: IDE-accepted candidate diverging at line 1 with a zero
// net line delta must be validated at the actual edit line (line 1), not
// skipped because prefixLines === 0. The candidate-diff invariant (candidate
// differs from the original) keeps this authoritative while excluding the
// no-change revert and new-file cases.
// ---------------------------------------------------------------------------

describe('IDE-accepted candidate diverging at line 1 with zero net line delta is validated at the actual edit line', () => {
  let tmpDir: string;
  let host: IToolHost;

  beforeEach(() => {
    tmpDir = join(
      tmpdir(),
      `ast-edit-line1-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tmpDir, { recursive: true });
    host = {
      ...createDefaultToolHost(),
      getTargetDir: () => tmpDir,
      getWorkspaceRoots: () => [tmpDir],
      getApprovalMode: () => 'default',
    };
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('refuses an IDE candidate that introduces syntax damage on line 1 (zero line delta) and leaves the original unchanged', async () => {
    // The IDE-accepted content changes line 1 (prefixLines === 0) with no net
    // line change (lineDelta === 0). The edit region must begin at line 1 so
    // the candidate is validated authoritatively; introducing damage is refused.
    const filePath = join(tmpDir, 'line1-damage.ts');
    const original = 'const a = 1;\nconst b = 2;\n';
    writeFileSync(filePath, original, 'utf-8');
    const ide = fakeIdeService('connected', 'const a = {{{ 1;\nconst b = 2;\n');
    const tool = new ASTEditTool(host, ide);

    const result = await executeApplyWithIdeContent(
      tool,
      filePath,
      'const a = 1;',
      'const a = 2;',
    );

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.AST_SYNTAX_ERROR);
    expect(readFileSync(filePath, 'utf-8')).toBe(original);
  });

  it('writes a valid IDE candidate diverging only at line 1 (zero line delta) with the exact accepted content', async () => {
    const filePath = join(tmpDir, 'line1-valid.ts');
    const original = 'const a = 1;\nconst b = 2;\n';
    writeFileSync(filePath, original, 'utf-8');
    const ideContent = 'const a = 99;\nconst b = 2;\n';
    const ide = fakeIdeService('connected', ideContent);
    const tool = new ASTEditTool(host, ide);

    const result = await executeApplyWithIdeContent(
      tool,
      filePath,
      'const a = 1;',
      'const a = 2;',
    );

    expect(result.error).toBeUndefined();
    // The exact IDE-accepted candidate is authoritative on write.
    expect(readFileSync(filePath, 'utf-8')).toBe(ideContent);
  });
});

// ---------------------------------------------------------------------------
// Finding 4 (In-scope): ast_read_file keeps working-set context.
// ---------------------------------------------------------------------------

describe('Finding 4 (In-scope): ast_read_file retains working-set context while ast_edit preview omits it', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(
      tmpdir(),
      `ast-edit-read-ctx-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * Initializes a throwaway git repo so a modified tracked file appears in the
   * git working set (the eager context ast_read_file renders).
   */
  function initGitWorkingSet(): void {
    const git = (args: string[]): void => {
      spawnSync('git', ['-C', tmpDir, ...args], {
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    };
    git(['init']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Test']);
    const other = join(tmpDir, 'other.ts');
    writeFileSync(other, 'export function helper(): void {}\n', 'utf-8');
    git(['add', 'other.ts']);
    spawnSync('git', ['-C', tmpDir, 'commit', '-m', 'init', 'other.ts'], {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    // Mutate the tracked file so it shows up as an unstaged working-set change.
    writeFileSync(
      other,
      'export function helper(): void {\n  return;\n}\n',
      'utf-8',
    );
  }

  it('ast_read_file renders WORKING SET CONTEXT for a git-modified tracked file', async () => {
    initGitWorkingSet();
    const target = join(tmpDir, 'target.ts');
    writeFileSync(target, 'export function alpha(): void {}\n', 'utf-8');
    const tool = new ASTReadFileTool(createFakeToolHost(tmpDir));

    const result = await tool
      .build({ file_path: target })
      .execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    // Regression guard: working-set context must still be collected/rendered
    // for ast_read_file after the ast_edit preview optimization.
    expect(output).toContain('WORKING SET CONTEXT');
    expect(output).toContain('other.ts');
  });

  it('ast_edit preview still omits WORKING SET CONTEXT', async () => {
    initGitWorkingSet();
    const target = join(tmpDir, 'target.ts');
    writeFileSync(target, 'export function alpha(): void {}\n', 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(tmpDir));

    const result = await executePreview(tool, {
      file_path: target,
      old_string: 'export function alpha()',
      new_string: 'export function beta()',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).not.toContain('WORKING SET CONTEXT');
    expect(output).not.toContain('other.ts');
    expect(output).toContain('ENHANCED CONTEXT ANALYSIS:');
  });
});

// ---------------------------------------------------------------------------
// Finding 5 (In-scope): coherent messages.
// ---------------------------------------------------------------------------

describe('Finding 5 (In-scope): coherent validation messaging', () => {
  const ctx = useTempDir();

  it('states definitively that the edit resolved the pre-existing error (no "may have") in preview', async () => {
    const filePath = join(ctx.tempDir, 'resolve-preview.ts');
    writeFileSync(
      filePath,
      'const greeting = "hello";\nconst broken = @@@;\n',
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'const broken = @@@;',
      new_string: 'const broken = 2;',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('AST validation: PASSED');
    expect(output).toContain('resolved');
    expect(output).not.toContain('may have');
  });

  it('states definitively that the edit resolved the pre-existing error (no "may have") in apply', async () => {
    const filePath = join(ctx.tempDir, 'resolve-apply.ts');
    writeFileSync(
      filePath,
      'const greeting = "hello";\nconst broken = @@@;\n',
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'const broken = @@@;',
      new_string: 'const broken = 2;',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('resolved');
    expect(output).not.toContain('may have');
    expect(output).not.toContain('Pre-existing syntax errors: Yes');
  });

  it('reports a retained pre-existing error at its CURRENT post-edit line after a line-shifting edit', async () => {
    // Pre-existing @@@ error on line 2. The edit inserts a line above it,
    // shifting the unchanged error to line 3. The message must report the
    // current (post-edit) line 3, not the stale baseline line 2.
    const filePath = join(ctx.tempDir, 'shift-coords.ts');
    writeFileSync(filePath, 'const a = 1;\nconst broken = @@@;\n', 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'const a = 1;',
      new_string: 'const a = 1;\nconst extra = 2;',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('pre-existing');
    // Current post-edit coordinate (line 3), not the stale baseline (line 2).
    expect(output).toContain('at line 3');
    expect(output).not.toContain('at line 2');
    expect(readFileSync(filePath, 'utf-8')).toBe(
      'const a = 1;\nconst extra = 2;\nconst broken = @@@;\n',
    );
  });
});

// ---------------------------------------------------------------------------
// Part A (Blocker): retained whole-file recovery + distinct new error → refused.
// ---------------------------------------------------------------------------

describe('Part A (Blocker): retained whole-file recovery then gains a distinct new error', () => {
  const ctx = useTempDir();

  it('refuses when a retained whole-program recovery file gains a distinct new syntax error elsewhere (same line count)', async () => {
    // Baseline triggers a whole-file tree-sitter recovery via `return {{{`.
    // This is the harmless retained baseline case — both pre and post have
    // whole-file recovery. The edit then introduces a SEPARATE {{{ error on
    // a different line (same line count). The new error must be detected.
    const filePath = join(ctx.tempDir, 'whole-plus-new.ts');
    const baseline = [
      'class Foo {',
      '  bar() {',
      '    return {{{',
      '  }',
      '}',
      'const marker = 1;',
      '',
    ].join('\n');
    writeFileSync(filePath, baseline, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'const marker = 1;',
      // Same line count; distinct new error on a different line.
      new_string: 'const marker = {{{ 2;',
    });

    // The distinct new error must be detected → refused.
    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.AST_SYNTAX_ERROR);
    // File must remain byte-for-byte unchanged.
    expect(readFileSync(filePath, 'utf-8')).toBe(baseline);
  });

  it('stays writable when the baseline whole-file recovery is unchanged by a harmless edit', async () => {
    // Same baseline but a harmless edit that does NOT introduce new damage.
    const filePath = join(ctx.tempDir, 'whole-keep2.ts');
    const baseline = [
      'class Foo {',
      '  bar() {',
      '    return {{{',
      '  }',
      '}',
      'const marker = 1;',
      '',
    ].join('\n');
    writeFileSync(filePath, baseline, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'const marker = 1;',
      new_string: 'const marker = 2;',
    });

    // Pre-existing whole-file recovery remains unchanged → writable.
    expect(result.error).toBeUndefined();
    expect(readFileSync(filePath, 'utf-8')).toContain('const marker = 2;');
  });
});
// ---------------------------------------------------------------------------
// Part B (Blocker): exact candidate coordinate mapping.
// ---------------------------------------------------------------------------

describe('Part B (Blocker): exact candidate coordinate mapping — changed-middle fail-closed', () => {
  const ctx = useTempDir();

  it('refuses replacing a multi-line region containing a pre-existing error with a different invalid construct at the same line/column', async () => {
    // Pre-existing error on line 2 (@@@). The edit replaces lines 2-3, putting
    // a DIFFERENT invalid construct (!!!) at the same line/column. The changed
    // middle region cannot prove equivalence → fail closed.
    const filePath = join(ctx.tempDir, 'changed-middle.ts');
    const original = [
      'const a = 1;',
      'const broken = @@@;',
      'const b = 2;',
      'const c = 3;',
      '',
    ].join('\n');
    writeFileSync(filePath, original, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'const broken = @@@;\nconst b = 2;',
      new_string: 'const broken = !!!;\nconst b = 2;',
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.AST_SYNTAX_ERROR);
    expect(readFileSync(filePath, 'utf-8')).toBe(original);
  });

  it('remains writable when a harmless insertion shifts an unchanged trailing pre-existing error', async () => {
    // Pre-existing @@@ error on line 2. The edit inserts a line BEFORE it,
    // shifting the unchanged error to line 3. The error is in the unchanged
    // suffix → proven equivalent → writable.
    const filePath = join(ctx.tempDir, 'suffix-keep.ts');
    writeFileSync(filePath, 'const a = 1;\nconst broken = @@@;\n', 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'const a = 1;',
      new_string: 'const a = 1;\nconst extra = 2;',
    });

    expect(result.error).toBeUndefined();
    expect(readFileSync(filePath, 'utf-8')).toBe(
      'const a = 1;\nconst extra = 2;\nconst broken = @@@;\n',
    );
  });

  it('refuses an IDE multi-hunk candidate with a pre-existing error in the changed middle', async () => {
    // Pre-existing @@@ error on line 2. The IDE candidate changes lines 1 and
    // 3 (multi-hunk), leaving the error in the changed middle between the two
    // hunks. Cannot prove equivalence → fail closed.
    const dir = join(
      tmpdir(),
      `ast-edit-multi-hunk-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, 'multi-hunk.ts');
    const original = 'const a = 1;\nconst broken = @@@;\nconst b = 2;\n';
    writeFileSync(filePath, original, 'utf-8');
    const host: IToolHost = {
      ...createDefaultToolHost(),
      getTargetDir: () => dir,
      getWorkspaceRoots: () => [dir],
      getApprovalMode: () => 'default',
    };
    try {
      const ide = fakeIdeService(
        'connected',
        'const a = 999;\nconst broken = @@@;\nconst b = 888;\n',
      );
      const tool = new ASTEditTool(host, ide);

      const result = await executeApplyWithIdeContent(
        tool,
        filePath,
        'const a = 1;',
        'const a = 999;',
      );

      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.AST_SYNTAX_ERROR);
      expect(readFileSync(filePath, 'utf-8')).toBe(original);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Evidence gaps: force schema behavioral, nested invalid-new-file, preview mtime.
// ---------------------------------------------------------------------------

describe('Evidence gap: force schema behavioral contract', () => {
  const ctx = useTempDir();

  it('force omitted/false PREVIEWS without writing', async () => {
    const filePath = join(ctx.tempDir, 'force-preview.ts');
    const original = 'const x = 1;\n';
    writeFileSync(filePath, original, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'const x = 1;',
      new_string: 'const x = 2;',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('PREVIEW');
    // Preview must not mutate the file.
    expect(readFileSync(filePath, 'utf-8')).toBe(original);
  });

  it('force: true APPLIES and writes to disk', async () => {
    const filePath = join(ctx.tempDir, 'force-apply.ts');
    writeFileSync(filePath, 'const x = 1;\n', 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'const x = 1;',
      new_string: 'const x = 2;',
    });

    expect(result.error).toBeUndefined();
    expect(readFileSync(filePath, 'utf-8')).toBe('const x = 2;\n');
  });
});

describe('Evidence gap: nested invalid new file creates neither file nor absent parent directories', () => {
  const ctx = useTempDir();

  it('refuses an invalid new file under a non-existent nested directory and creates nothing', async () => {
    const nestedDir = join(ctx.tempDir, 'absent', 'deep');
    const filePath = join(nestedDir, 'invalid.ts');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: '',
      new_string: 'const broken = {{{ 2;\n',
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.AST_SYNTAX_ERROR);
    // Neither the file...
    expect(existsSync(filePath)).toBe(false);
    // ...nor the absent parent directories may be created.
    expect(existsSync(nestedDir)).toBe(false);
    expect(existsSync(join(ctx.tempDir, 'absent'))).toBe(false);
  });
});

describe('Evidence gap: preview reports the file timestamp', () => {
  const ctx = useTempDir();

  it('includes a Timestamp line derived from the file mtime', async () => {
    const filePath = join(ctx.tempDir, 'mtime.ts');
    writeFileSync(filePath, 'const x = 1;\n', 'utf-8');
    // Pin the mtime cross-platform via Node utimesSync (GNU touch -d is
    // unavailable on macOS and would leave this test vacuous).
    const fixedMtimeSec = 1717000000;
    utimesSync(filePath, fixedMtimeSec, fixedMtimeSec);
    const expectedMtime = statSync(filePath).mtime.getTime();

    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));
    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'const x = 1;',
      new_string: 'const x = 2;',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('Timestamp:');
    expect(output).toContain(String(expectedMtime));
  });
});

// ---------------------------------------------------------------------------
// REQ-3035-9: stale last_modified in preview returns file_modified_conflict.
// ---------------------------------------------------------------------------

describe('REQ-3035-9: stale last_modified in preview refuses with conflict', () => {
  const ctx = useTempDir();

  it('preview with stale last_modified returns file_modified_conflict, plain text, timestamps, and does not write', async () => {
    const filePath = join(ctx.tempDir, 'stale.ts');
    const original = 'const x = 1;\n';
    writeFileSync(filePath, original, 'utf-8');
    // Pin mtime to a known value, then set last_modified BEFORE that so the
    // file appears modified since last read.
    const staleSec = 1717000000;
    const freshSec = 1717000010;
    utimesSync(filePath, freshSec, freshSec);
    const currentMtime = statSync(filePath).mtime.getTime();

    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));
    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'const x = 1;',
      new_string: 'const x = 2;',
      last_modified: staleSec * 1000,
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.FILE_MODIFIED_CONFLICT);
    // Must be plain non-JSON text (human-readable error, not structured JSON).
    const content = String(result.llmContent);
    expect(content).toContain('FILE_MODIFIED_CONFLICT');
    expect(content).not.toMatch(/^\s*\{/);
    // Both supplied and current timestamps must appear in the message.
    expect(content).toContain(String(staleSec * 1000));
    expect(content).toContain(String(currentMtime));
    // The remedy must be communicated.
    expect(content).toContain('Re-read');
    expect(content).toContain('retry');
    // No write must have occurred.
    expect(readFileSync(filePath, 'utf-8')).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// REQ-3035-1 (strengthened): force schema behavioral wording.
// ---------------------------------------------------------------------------

describe('REQ-3035-1 (strengthened): force schema wording asserts preview/apply mapping', () => {
  const observeStatesThatOmittedFalsePreviewAndTrueApplyAt870 = () => {
    const tool = new ASTEditTool(createFakeToolHost('/tmp'));
    const schema = tool.parameterSchema as {
      properties?: { force?: { description?: string } };
    };
    const desc = (schema.properties?.force?.description ?? '').toLowerCase();
    return { desc };
  };

  it('states that omitted/false => preview and true => apply', () => {
    const { desc } = observeStatesThatOmittedFalsePreviewAndTrueApplyAt870();
    expect(desc).toContain('preview');
    expect(desc).toMatch(/(omit|false).*preview|preview.*(omit|false)/);
    expect(desc).toContain('apply');
    expect(desc).toMatch(/true.*apply|apply.*true/);
    expect(desc).not.toContain('bypass');
  });
});
