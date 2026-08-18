/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bun-test-free fixtures for the issue #3242 ast_edit preview regression.
 *
 * This module deliberately imports nothing from `bun:test` so the
 * child-process fixture (ast-edit-3242-memory-child.ts) can reuse the exact
 * same deterministic Rust target generator as the in-process tests. The
 * target is exactly 5,250 lines with 184 real parsed declarations (180
 * worker functions plus a struct, an impl, and two impl methods), matching
 * the incident shape: a localized edit inside a large symbol-dense Rust
 * file. The workspace generator adds the repository fan-out shape (many
 * committed dependency files referencing the prioritizable worker symbols,
 * an ignored tree, and one oversized source file) that previously drove
 * five concurrent whole-workspace native traversals per preview.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gitCommitAll, gitInit } from './ast-read-git-fixtures.js';

/** Exact line count of the generated Rust target (including final newline). */
export const RUST_FIXTURE_LINE_COUNT = 5250;
/** Worker function blocks in the Rust target. */
export const RUST_WORKER_COUNT = 180;
/** Header lines before the first worker block. */
const RUST_HEADER_LINES = 30;
/** Lines per worker block (function line through trailing blank line). */
const RUST_BLOCK_LINES = 29;
/** Unique `let step_...` marker lines inside each worker block. */
const RUST_STEPS_PER_BLOCK = 24;

/** Committed dependency files referencing the prioritizable symbols. */
export const ISSUE_3242_DEP_FILE_COUNT = 1500;
/** Lines per dependency file. */
export const ISSUE_3242_DEP_LINES = 60;
/** Ignored-tree source files present on disk but git-ignored. */
export const ISSUE_3242_IGNORED_FILE_COUNT = 5;
/** Lines in the single oversized source file (~2 MiB). */
export const ISSUE_3242_OVERSIZED_LINE_COUNT = 46_600;

/** One deterministic unique edit inside the Rust target. */
export interface RustFixtureEdit {
  readonly oldString: string;
  readonly newString: string;
  /** 1-based line where oldString starts. */
  readonly line: number;
}

export interface RustFixture {
  readonly content: string;
  readonly lineCount: number;
  readonly edits: {
    readonly middle: RustFixtureEdit;
    readonly head: RustFixtureEdit;
    readonly tail: RustFixtureEdit;
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function pad3(value: number): string {
  return String(value).padStart(3, '0');
}

function pad4(value: number): string {
  return String(value).padStart(4, '0');
}

function pad5(value: number): string {
  return String(value).padStart(5, '0');
}

function stepLine(block: number, step: number): string {
  return `    let step_${pad3(block)}_${pad2(step)}: u64 = ${block * 100 + step};`;
}

function workerBlock(block: number): string[] {
  const lines: string[] = [
    `fn worker_${pad3(block)}(input: u64) -> u64 {`,
    '    let mut total: u64 = input;',
  ];
  for (let step = 0; step < RUST_STEPS_PER_BLOCK; step++) {
    lines.push(stepLine(block, step));
  }
  lines.push('    total', '}', '');
  return lines;
}

function headerLines(): string[] {
  const lines: string[] = [
    '// Synthetic Rust fixture for the issue #3242 ast_edit preview regression.',
    '// 5,250 lines: 180 worker functions plus deterministic header types.',
    '',
    'pub struct Payload {',
    '    pub id: u64,',
    '    pub weight: u64,',
    '}',
    '',
    'impl Payload {',
    '    pub fn base() -> Payload {',
    '        Payload { id: 0, weight: 0 }',
    '    }',
    '    pub fn anchor() -> u64 {',
    '        0',
    '    }',
    '}',
    '',
  ];
  let filler = 1;
  while (lines.length < RUST_HEADER_LINES) {
    lines.push(`// header filler line ${pad2(filler)}`);
    filler += 1;
  }
  return lines;
}

function fixtureEdit(block: number, step: number): RustFixtureEdit {
  const oldString = stepLine(block, step);
  const newString = `    let step_${pad3(block)}_${pad2(step)}: u64 = ${block * 100 + step + 1};`;
  const line = RUST_HEADER_LINES + block * RUST_BLOCK_LINES + 3 + step;
  return { oldString, newString, line };
}

/** Generate the deterministic ~5,250-line Rust regression target. */
export function generateRustFixture(): RustFixture {
  const lines: string[] = headerLines();
  for (let block = 0; block < RUST_WORKER_COUNT; block++) {
    lines.push(...workerBlock(block));
  }
  const expected = RUST_HEADER_LINES + RUST_WORKER_COUNT * RUST_BLOCK_LINES;
  if (lines.length !== expected) {
    throw new Error(
      `rust fixture generator produced ${lines.length} lines, expected ${expected}`,
    );
  }
  return {
    content: `${lines.join('\n')}\n`,
    lineCount: expected,
    edits: {
      middle: fixtureEdit(90, 7),
      head: fixtureEdit(0, 3),
      tail: fixtureEdit(179, 20),
    },
  };
}

function rustDepFile(index: number, lineCount: number): string {
  const lines: string[] = [
    `// Synthetic dependency ${index} referencing worker symbols.`,
  ];
  for (let i = 1; i < lineCount; i++) {
    lines.push(
      `pub fn dep_${index}_p${pad2(i)}() -> u64 { worker_000(0) + worker_001(1) + worker_002(2) }`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function oversizedRustFile(): string {
  const lines: string[] = [
    '// Oversized synthetic source file outside every traversal policy.',
  ];
  for (let i = 1; i < ISSUE_3242_OVERSIZED_LINE_COUNT; i++) {
    lines.push(`pub const OVERSIZE_REF_${pad5(i)}: u64 = ${i % 9973};`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Generate the fan-out-shaped Git workspace used by the child-process
 * memory regression. Every failure of fixture generation removes the
 * half-built directory so a broken fixture can never leak into tmp.
 */
export function generateIssue3242Workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'llxprt-3242-mem-'));
  try {
    gitInit(dir);
    writeFileSync(join(dir, '.gitignore'), 'ignored_tree/\n', 'utf-8');
    writeFileSync(
      join(dir, 'target.rs'),
      generateRustFixture().content,
      'utf-8',
    );

    const depsDir = join(dir, 'deps');
    mkdirSync(depsDir, { recursive: true });
    for (let i = 0; i < ISSUE_3242_DEP_FILE_COUNT; i++) {
      writeFileSync(
        join(depsDir, `dep${pad4(i)}.rs`),
        rustDepFile(i, ISSUE_3242_DEP_LINES),
        'utf-8',
      );
    }

    const ignoredDir = join(dir, 'ignored_tree');
    mkdirSync(ignoredDir, { recursive: true });
    for (let i = 0; i < ISSUE_3242_IGNORED_FILE_COUNT; i++) {
      writeFileSync(
        join(ignoredDir, `ig${i}.rs`),
        rustDepFile(10_000 + i, ISSUE_3242_DEP_LINES),
        'utf-8',
      );
    }

    writeFileSync(join(dir, 'oversized_dep.rs'), oversizedRustFile(), 'utf-8');
    gitCommitAll(dir, 'issue-3242 fan-out fixture');
    return dir;
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Generate the small Git workspace used by the Git-command wiring canary:
 * the full Rust target plus one committed dependency, so a real preview
 * succeeds and any repository-relationship Git phase is observable.
 */
export interface CanaryWorkspace {
  readonly spyRoot: string;
  readonly workspace: string;
}

/**
 * Generate the small Git workspace used by the Git-command wiring canary:
 * the full Rust target plus one committed dependency, so a real preview
 * succeeds and any repository-relationship Git phase is observable. The
 * workspace path deliberately contains a space.
 */
export function generateIssue3242CanaryWorkspace(): CanaryWorkspace {
  const spyRoot = mkdtempSync(join(tmpdir(), 'llxprt-3242-spy-'));
  const workspace = join(spyRoot, 'work space');
  try {
    mkdirSync(workspace, { recursive: true });
    gitInit(workspace);
    writeFileSync(
      join(workspace, 'target.rs'),
      generateRustFixture().content,
      'utf-8',
    );
    writeFileSync(
      join(workspace, 'dep.rs'),
      rustDepFile(0, ISSUE_3242_DEP_LINES),
      'utf-8',
    );
    gitCommitAll(workspace, 'issue-3242 canary fixture');
    return { spyRoot, workspace };
  } catch (error) {
    rmSync(spyRoot, { recursive: true, force: true });
    throw error;
  }
}
