/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for bounded ast_read_file acquisition (issue #3232).
 *
 * REQ-3232-1: ast_read_file opts out of repository relationship analysis
 * (repository context, symbol index, related files/symbols) that never
 * reaches its model-facing or display output, while ast_edit keeps it.
 * REQ-3232-2: working-set Git discovery is bounded (finite candidate count
 * with a one-over sentinel, AbortSignal support, exact-child termination)
 * and acquisition enforces finite file-count, aggregate-source-byte,
 * retained-declaration, and concurrency policies before over-budget
 * reads/parses start, with bounded reads that validate actual bytes.
 * REQ-3232-3: the invocation AbortSignal is threaded through discovery and
 * collection; pre-abort schedules no acquisition, mid-collection abort
 * stops scheduling and is never reported complete.
 * REQ-3232-4: bounded working-set context renders an explicit partial
 * marker/reason/accounting while complete output stays compatible, including
 * when zero files are retained; public display metadata stays exactly
 * {language, declarationsCount}.
 *
 * All fixtures are real temporary directories with real Git state, real
 * files, and the real ASTReadFileTool / collector / providers. No mocking of
 * the component under test: the only wrappers are real subclasses whose
 * public behavior delegates to the real implementation and whose side effect
 * is AbortController timing or real acquisition observation.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolResult } from '../../tools.js';
import { ASTReadFileTool } from '../../ast-edit.js';
import { ASTQueryExtractor } from '../ast-query-extractor.js';
import { RepositoryContextProvider } from '../repository-context-provider.js';
import { enrichWithWorkingSetContext } from '../workspace-context-provider.js';
import type { EnhancedDeclaration, WorkingSetAcquisition } from '../types.js';
import type { createFakeToolHost } from './test-helpers.js';
import { gitCheck, gitInit, gitCommitAll } from './ast-read-git-fixtures.js';

// Policy contract under test (kept as literals so the tests are the spec).
const MAX_WORKING_SET_FILES = 50;
const MAX_WORKING_SET_DECLARATIONS = 500;
const WORKING_SET_CONCURRENCY = 4;
const WORKING_SET_BYTE_BUDGET = 4 * 1024 * 1024;
const DISCOVERY_CANDIDATE_CAP = MAX_WORKING_SET_FILES + 1;
const READ_SENTINEL_BYTES = 4096;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Narrow an unknown result part to a record or fail the test loudly. Used
 * instead of `if (isRecord(...))` wrappers around expects so expectations are
 * never conditional.
 */
function recordOf(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`expected ${what} to be a record, got: ${typeof value}`);
  }
  return value;
}

async function runRead(
  host: ReturnType<typeof createFakeToolHost>,
  filePath: string,
  signal?: AbortSignal,
): Promise<ToolResult> {
  return new ASTReadFileTool(host)
    .build({ file_path: filePath })
    .execute(signal ?? new AbortController().signal);
}

/** Run a real bounded working-set acquisition and return its result. */
async function acquireWorkingSet(
  target: string,
  root: string,
  extractor: ASTQueryExtractor = new ASTQueryExtractor(),
  signal?: AbortSignal,
): Promise<WorkingSetAcquisition> {
  return enrichWithWorkingSetContext(
    target,
    root,
    new RepositoryContextProvider(),
    extractor,
    signal,
  );
}

// The checked Git fixture wrappers (gitCheck/gitInit/gitCommitAll) live in
// ast-read-git-fixtures.ts so child-process fixtures can reuse them without
// importing bun:test. They are re-exported below for the existing suites.

/** A TypeScript file body with `count` exported function declarations. */
function declarationsBody(count: number, prefix: string): string {
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    lines.push(`export function ${prefix}${i}(): number {`);
    lines.push(`  return ${i};`);
    lines.push('}');
    lines.push('');
  }
  return lines.join('\n');
}

/** A TypeScript file of exactly `sizeBytes` bytes containing `count` decls. */
function paddedDeclarations(
  count: number,
  prefix: string,
  sizeBytes: number,
): string {
  const base = declarationsBody(count, prefix);
  const padNeeded = sizeBytes - Buffer.byteLength(base) - 1;
  if (padNeeded < 2) {
    throw new Error(
      `fixture of ${sizeBytes} bytes cannot hold ${count} declarations`,
    );
  }
  return `${base}//${'x'.repeat(padNeeded - 2)}\n`;
}

/**
 * Seed then modify real tracked files so every name appears in the unstaged
 * working set. Seed and modified contents differ (same size where a size is
 * given) so git diff actually reports each file.
 */
function seedAndModify(
  dir: string,
  entries: ReadonlyArray<{
    readonly name: string;
    readonly seed: string;
    readonly modified: string;
  }>,
): string {
  for (const entry of entries) {
    writeFileSync(join(dir, entry.name), entry.seed, 'utf-8');
  }
  const sha = gitCommitAll(dir, 'seed');
  for (const entry of entries) {
    writeFileSync(join(dir, entry.name), entry.modified, 'utf-8');
  }
  return sha;
}

function writeTarget(dir: string): string {
  const target = join(dir, 'target.ts');
  writeFileSync(target, 'export function readTarget(): void {}\n', 'utf-8');
  return target;
}

/** Simple seed/modify pairs of `count` generated declaration files. */
function simpleModifiedEntries(
  count: number,
  prefix: string,
): ReadonlyArray<{ name: string; seed: string; modified: string }> {
  return Array.from({ length: count }, (_, i) => {
    const name = `${prefix}${String(i).padStart(3, '0')}.ts`;
    return {
      name,
      seed: declarationsBody(1, `s${i}_`),
      modified: declarationsBody(2, `m${i}_`),
    };
  });
}

/**
 * Smallest stdout chunk Node delivers from a child pipe (64 KiB). Fixtures
 * that must produce trailing data events after the first chunk generate more
 * NUL-delimited output than this.
 */
const GIT_TRAILING_OUTPUT_FLOOR_BYTES = 1024 * 1024;

const LONG_PATH_SEED_BODY = 'export const seedValue = 1;' + '\n';
const LONG_PATH_MODIFIED_BODY = 'export const modifiedValue = 2;' + '\n';

/**
 * Seed and modify `count` tracked files whose relative paths are long enough
 * that one Git listing phase emits well over two stdout chunks of
 * NUL-delimited names. Returns the generated relative names.
 */
function createLongPathCandidates(dir: string, count: number): string[] {
  const segment = 'd'.repeat(170);
  const relativeDir = [segment, segment, segment].join('/');
  mkdirSync(join(dir, relativeDir), { recursive: true });
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const name = `${relativeDir}/f${String(i).padStart(40, '0')}.ts`;
    writeFileSync(join(dir, name), LONG_PATH_SEED_BODY, 'utf-8');
    names.push(name);
  }
  gitCommitAll(dir, 'long-path seed');
  for (const name of names) {
    writeFileSync(join(dir, name), LONG_PATH_MODIFIED_BODY, 'utf-8');
  }
  const totalNulBytes = names.reduce((sum, name) => sum + name.length + 1, 0);
  if (totalNulBytes < GIT_TRAILING_OUTPUT_FLOOR_BYTES) {
    throw new Error(`long-path fixture emitted only ${totalNulBytes} bytes`);
  }
  return names;
}

/**
 * True when the filesystem treats filenames case-insensitively (macOS,
 * Windows). Probed at runtime from real filesystem behavior so tests need no
 * platform sniffing: a file written as lowercase is visible under uppercase.
 */
function hasCaseInsensitiveFilenames(dir: string): boolean {
  const probe = join(dir, `case-probe-${process.pid}.txt`);
  writeFileSync(probe, '', 'utf-8');
  return existsSync(probe.toUpperCase());
}

/**
 * Commit then modify the read target so `git diff --name-only` genuinely
 * lists it as a candidate that exclusion must remove. An untracked target
 * never appears in any diff phase, so exclusion tests that only write an
 * untracked target prove nothing about the exclude path.
 */
function writeTrackedModifiedTarget(
  dir: string,
  name: string = 'target.ts',
): string {
  const target = join(dir, name);
  writeFileSync(target, 'export function readTargetSeed(): void {}\n', 'utf-8');
  gitCommitAll(dir, 'target seed');
  writeFileSync(
    target,
    'export function readTarget(): number { return 1; }\n',
    'utf-8',
  );
  return target;
}

/**
 * Real extractor wrapper that observes genuine acquisition activity while
 * delegating every extraction to the real implementation. The optional delay
 * widens the real extraction window so concurrent overlap is observable.
 */
class ObservingExtractor extends ASTQueryExtractor {
  readonly extractionEnters: string[] = [];
  readonly boundedLengths: number[] = [];
  active = 0;
  peakActive = 0;
  activeContentBytes = 0;
  peakActiveContentBytes = 0;
  private readonly delayMs: number;
  private readonly onFirstExtraction?: () => void;
  private firstExtractionSeen = false;

  constructor(options?: { delayMs?: number; onFirstExtraction?: () => void }) {
    super();
    this.delayMs = options?.delayMs ?? 0;
    this.onFirstExtraction = options?.onFirstExtraction;
  }

  private enter(filePath: string, content: string): void {
    if (!this.firstExtractionSeen) {
      this.firstExtractionSeen = true;
      this.onFirstExtraction?.();
    }
    this.active += 1;
    this.peakActive = Math.max(this.peakActive, this.active);
    this.activeContentBytes += Buffer.byteLength(content);
    this.peakActiveContentBytes = Math.max(
      this.peakActiveContentBytes,
      this.activeContentBytes,
    );
    this.extractionEnters.push(filePath);
  }

  private exit(content: string): void {
    this.active -= 1;
    this.activeContentBytes -= Buffer.byteLength(content);
  }

  override async extractDeclarations(
    filePath: string,
    content: string,
  ): Promise<EnhancedDeclaration[]> {
    this.enter(filePath, content);
    try {
      await this.settle();
      return await super.extractDeclarations(filePath, content);
    } finally {
      this.exit(content);
    }
  }

  override async extractDeclarationsBounded(
    filePath: string,
    content: string,
    limit: number,
  ): Promise<readonly EnhancedDeclaration[]> {
    this.enter(filePath, content);
    try {
      await this.settle();
      const declarations = await super.extractDeclarationsBounded(
        filePath,
        content,
        limit,
      );
      this.boundedLengths.push(declarations.length);
      return declarations;
    } finally {
      this.exit(content);
    }
  }

  private async settle(): Promise<void> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
  }
}

// Shared helpers exported for the split bounded-acquisition suite.
export {
  isRecord,
  recordOf,
  runRead,
  acquireWorkingSet,
  gitCheck,
  gitInit,
  gitCommitAll,
  declarationsBody,
  paddedDeclarations,
  seedAndModify,
  writeTarget,
  simpleModifiedEntries,
  createLongPathCandidates,
  writeTrackedModifiedTarget,
  hasCaseInsensitiveFilenames,
  ObservingExtractor,
};
export {
  MAX_WORKING_SET_FILES,
  MAX_WORKING_SET_DECLARATIONS,
  WORKING_SET_CONCURRENCY,
  WORKING_SET_BYTE_BUDGET,
  DISCOVERY_CANDIDATE_CAP,
  READ_SENTINEL_BYTES,
};
