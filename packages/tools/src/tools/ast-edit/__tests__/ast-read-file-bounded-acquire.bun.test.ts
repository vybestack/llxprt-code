/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for bounded ast_read_file acquisition policies (issue #3232).
 * Covers REQ-3232-1/2/3/4 discovery, file-count, aggregate-byte, growth, declaration,
 * precedence, skipped-only, cancellation, and max-in-flight behavior.
 *
 * All fixtures are real temporary directories with real Git state, real files,
 * and the real ASTReadFileTool / collector / providers. No mocking of the
 * component under test: the only wrappers are real subclasses whose public
 * behavior delegates to the real implementation.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync, appendFileSync } from 'node:fs';
import { join, sep as pathSep } from 'node:path';
import { ASTEditTool } from '../../ast-edit.js';
import { ASTContextCollector } from '../context-collector.js';
import { RepositoryContextProvider } from '../repository-context-provider.js';
import type { WorkingSetDiscoveryResult } from '../repository-context-provider.js';
import {
  createFakeToolHost,
  createTempDir,
  useTempDir,
} from './test-helpers.js';
import {
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
  hasCaseInsensitiveFilenames,
  createLongPathCandidates,
  ObservingExtractor,
  writeTrackedModifiedTarget,
  MAX_WORKING_SET_FILES,
  MAX_WORKING_SET_DECLARATIONS,
  WORKING_SET_BYTE_BUDGET,
  DISCOVERY_CANDIDATE_CAP,
  READ_SENTINEL_BYTES,
} from './ast-read-file-bounded-helpers.js';
import type { ConnectedFile } from '../types.js';
// ---------------------------------------------------------------------------
// REQ-3232-1: repository relationship analysis is gone from the read path.
// ---------------------------------------------------------------------------

describe('REQ-3232-1: enhanced context repository opt-out', () => {
  const ctx = useTempDir();
  let target = '';

  beforeEach(() => {
    gitInit(ctx.tempDir);
    // A committed dependency file referencing the target symbols: repository
    // analysis would eagerly discover relationships in it.
    writeFileSync(
      join(ctx.tempDir, 'dep.ts'),
      'import { Alpha } from "./target";\nexport function user(): Alpha { return null as Alpha; }\n',
      'utf-8',
    );
    gitCommitAll(ctx.tempDir, 'init');
    target = join(ctx.tempDir, 'target.ts');
    writeFileSync(
      target,
      'export class Alpha {\n  public run(): void {}\n}\nexport function betaWorker(): number { return 1; }\n',
      'utf-8',
    );
  });

  it('collectEnhancedContext skips repository context when the caller opts out', async () => {
    const collector = new ASTContextCollector();
    const content = 'export class Alpha {\n  public run(): void {}\n}\n';
    const enhanced = await collector.collectEnhancedContext(
      target,
      content,
      ctx.tempDir,
      { collectRepositoryContext: false },
    );
    expect(enhanced.repositoryContext).toBeUndefined();
    expect(enhanced.relatedFiles).toBeUndefined();
    expect(enhanced.relatedSymbols).toBeUndefined();
    // Local analysis and snippets are preserved.
    expect(enhanced.declarations.length).toBeGreaterThan(0);
    expect(enhanced.relevantSnippets).toBeDefined();
  });

  it('collectEnhancedContext still collects repository context by default', async () => {
    const collector = new ASTContextCollector();
    const content = 'export class Alpha {\n  public run(): void {}\n}\n';
    const enhanced = await collector.collectEnhancedContext(
      target,
      content,
      ctx.tempDir,
    );
    expect(enhanced.repositoryContext).toBeDefined();
    expect(enhanced.repositoryContext?.rootPath).toBe(ctx.tempDir);
  });

  it('ast_read_file keeps local context and working set while opting out', async () => {
    seedAndModify(ctx.tempDir, [
      {
        name: 'other.ts',
        seed: 'export function helper(): void {}\n',
        modified: 'export function helper(): void {\n  return;\n}\n',
      },
    ]);
    const acquisition = await acquireWorkingSet(target, ctx.tempDir);
    expect(acquisition.status.complete).toBe(true);
    const result = await runRead(createFakeToolHost(ctx.tempDir), target);
    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('LLXPRT READ: ');
    expect(output).toContain('CONTEXT ANALYSIS:');
    expect(output).toContain('RELEVANT SNIPPETS:');
    expect(output).toContain('WORKING SET CONTEXT:');
    expect(output).toContain('other.ts');
  });

  it('ast_edit preview also opts out of repository context (issue #3242)', async () => {
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));
    const result = await tool
      .build({
        file_path: target,
        old_string: 'public run(): void {}',
        new_string: 'public runFast(): void {}',
        force: false,
      })
      .execute(new AbortController().signal);
    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).not.toContain('- Repository:');
    expect(String(result.llmContent)).not.toContain('RELATED SYMBOLS:');
  });
});

// ---------------------------------------------------------------------------
// REQ-3232-2: bounded Git discovery (finite count + one-over sentinel).
// ---------------------------------------------------------------------------

describe('REQ-3232-2: bounded working-set Git discovery', () => {
  const ctx = useTempDir();

  beforeEach(() => {
    gitInit(ctx.tempDir);
  });

  it('caps discovery at a finite candidate count with a one-over sentinel', async () => {
    seedAndModify(
      ctx.tempDir,
      simpleModifiedEntries(DISCOVERY_CANDIDATE_CAP + 9, 'dc'),
    );
    const target = writeTarget(ctx.tempDir);
    const discovery: WorkingSetDiscoveryResult =
      await new RepositoryContextProvider().discoverWorkingSetFiles(
        ctx.tempDir,
        {
          maxCandidates: DISCOVERY_CANDIDATE_CAP,
          excludePath: target,
        },
      );
    expect(discovery.candidates).toHaveLength(DISCOVERY_CANDIDATE_CAP);
    expect(discovery.outcome).toBe('truncated');
  });

  // Seeding 3000 long-path files and committing them dominates the runtime;
  // the discovery run itself stays bounded by the provider's Git timeout.
  it('never exceeds the candidate cap when buffered stdout trails the kill', async () => {
    // The listing emits well over a megabyte of NUL-delimited names, so git
    // keeps writing buffered stdout after the cap is hit and the exact child
    // is killed. Those late events must never add a candidate beyond the cap.
    createLongPathCandidates(ctx.tempDir, 3000);
    const target = writeTarget(ctx.tempDir);
    const discovery: WorkingSetDiscoveryResult =
      await new RepositoryContextProvider().discoverWorkingSetFiles(
        ctx.tempDir,
        {
          maxCandidates: 3,
          excludePath: target,
        },
      );
    expect(discovery.candidates).toHaveLength(3);
    expect(discovery.outcome).toBe('truncated');
  }, 120_000);

  it('reports aborted when the signal fires before a phase attaches its listener', async () => {
    seedAndModify(ctx.tempDir, simpleModifiedEntries(3, 'aa'));
    const target = writeTarget(ctx.tempDir);
    const controller = new AbortController();
    const pending = new RepositoryContextProvider().discoverWorkingSetFiles(
      ctx.tempDir,
      {
        maxCandidates: DISCOVERY_CANDIDATE_CAP,
        excludePath: target,
        signal: controller.signal,
      },
    );
    // The abort lands after the entry check ran synchronously but before the
    // first Git child attaches its abort listener: a listener added to an
    // already-aborted signal never fires, so discovery must check the flag
    // itself instead of relying on the event.
    controller.abort();
    const discovery: WorkingSetDiscoveryResult = await pending;
    expect(discovery.outcome).toBe('aborted');
    expect(discovery.candidates).toHaveLength(0);
  });

  it('reports a Git discovery error, not a one-over claim, when listing output overflows', async () => {
    // No candidate cap is hit: the bound that stops this run is the finite
    // output allowance of the listing itself. Reporting that as candidate
    // truncation would claim "at least N eligible files", which was never
    // observed; it is a Git/discovery failure instead.
    const names = createLongPathCandidates(ctx.tempDir, 3000);
    const target = writeTarget(ctx.tempDir);
    const discovery: WorkingSetDiscoveryResult =
      await new RepositoryContextProvider().discoverWorkingSetFiles(
        ctx.tempDir,
        {
          maxCandidates: names.length,
          excludePath: target,
        },
      );
    expect(discovery.outcome).toBe('git-error');
    expect(discovery.gitError).toBeDefined();
    expect(String(discovery.gitError)).toContain('output');
  }, 120_000); // Same 3000-file long-path fixture: seeding dominates the runtime.

  it('excludes the read target under case-insensitive path semantics', async () => {
    if (!hasCaseInsensitiveFilenames(ctx.tempDir)) {
      return;
    }
    // Git reports the tracked name with its literal case while the caller
    // may hold an equivalently-spelled path with different casing. On a
    // case-insensitive filesystem those are the same file and must exclude.
    // The target is tracked and modified so the diff genuinely lists it.
    seedAndModify(ctx.tempDir, simpleModifiedEntries(1, 'ci'));
    const target = writeTrackedModifiedTarget(ctx.tempDir);
    const cased = join(
      ctx.tempDir,
      target.split(pathSep).pop()?.toUpperCase() ?? 'TARGET.TS',
    );
    const discovery: WorkingSetDiscoveryResult =
      await new RepositoryContextProvider().discoverWorkingSetFiles(
        ctx.tempDir,
        {
          maxCandidates: DISCOVERY_CANDIDATE_CAP,
          excludePath: cased,
        },
      );
    expect(discovery.outcome).toBe('complete');
    expect(
      discovery.candidates.some((candidate) => candidate.endsWith('target.ts')),
    ).toBe(false);
    // Exclusion removed only the target: the other candidate is retained.
    expect(
      discovery.candidates.some((candidate) => candidate.endsWith('ci000.ts')),
    ).toBe(true);
  });
  it('reports a below-cap working set as a complete discovery', async () => {
    seedAndModify(ctx.tempDir, simpleModifiedEntries(30, 'dc'));
    const target = writeTarget(ctx.tempDir);
    const discovery: WorkingSetDiscoveryResult =
      await new RepositoryContextProvider().discoverWorkingSetFiles(
        ctx.tempDir,
        {
          maxCandidates: DISCOVERY_CANDIDATE_CAP,
          excludePath: target,
        },
      );
    expect(discovery.candidates).toHaveLength(30);
    expect(discovery.outcome).toBe('complete');
  });

  it('dedupes candidates across Git phases and honors the exclude path', async () => {
    seedAndModify(ctx.tempDir, simpleModifiedEntries(1, 'dd'));
    // Stage the modified file so the staged phase lists it too, while the
    // recent-commit phase lists it from the seed commit.
    gitCheck(ctx.tempDir, ['add', 'dd000.ts']);
    // The target is tracked and modified, so the unstaged diff genuinely
    // lists it as a candidate that the exclude path must remove.
    const target = writeTrackedModifiedTarget(ctx.tempDir);
    const discovery: WorkingSetDiscoveryResult =
      await new RepositoryContextProvider().discoverWorkingSetFiles(
        ctx.tempDir,
        {
          maxCandidates: DISCOVERY_CANDIDATE_CAP,
          excludePath: target,
        },
      );
    expect(discovery.outcome).toBe('complete');
    expect(discovery.candidates).toHaveLength(1);
    expect(discovery.candidates[0]).toBe(join(ctx.tempDir, 'dd000.ts'));
  });

  it('handles paths with spaces and newlines via NUL-delimited Git output', async () => {
    // Windows filenames cannot contain a newline, so the literal-newline half
    // of this coverage is POSIX-only; the space-path half must run everywhere.
    const weird =
      process.platform === 'win32'
        ? 'weird name with space.ts'
        : 'weird\nname with space.ts';
    seedAndModify(ctx.tempDir, [
      {
        name: weird,
        seed: declarationsBody(1, 'ws_'),
        modified: declarationsBody(2, 'wm_'),
      },
    ]);
    const target = writeTarget(ctx.tempDir);
    const acquisition = await acquireWorkingSet(target, ctx.tempDir);
    expect(
      acquisition.files.some(
        (f: ConnectedFile) => f.filePath === join(ctx.tempDir, weird),
      ),
    ).toBe(true);
  });

  it.skipIf(process.platform === 'win32')(
    'keeps NUL-delimited discovery correct for a literal newline filename',
    async () => {
      // Only POSIX filesystems permit a newline inside a filename; the point
      // of this fixture is that newline-delimited parsing would split the
      // name in two while NUL-delimited parsing keeps it whole.
      const withNewline = 'split\nname.ts';
      seedAndModify(ctx.tempDir, [
        {
          name: withNewline,
          seed: declarationsBody(1, 'nl_'),
          modified: declarationsBody(2, 'nm_'),
        },
      ]);
      const target = writeTarget(ctx.tempDir);
      const discovery: WorkingSetDiscoveryResult =
        await new RepositoryContextProvider().discoverWorkingSetFiles(
          ctx.tempDir,
          { maxCandidates: DISCOVERY_CANDIDATE_CAP, excludePath: target },
        );
      expect(discovery.outcome).toBe('complete');
      expect(discovery.candidates).toEqual([join(ctx.tempDir, withNewline)]);
    },
  );

  it('reports a corrupted repository as a Git error, not an empty complete set', async () => {
    seedAndModify(ctx.tempDir, simpleModifiedEntries(2, 'dc'));
    const target = writeTarget(ctx.tempDir);
    // Corrupt HEAD: the staged-diff phase needs it and must fail loudly.
    writeFileSync(join(ctx.tempDir, '.git', 'HEAD'), 'garbage\n', 'utf-8');
    const discovery: WorkingSetDiscoveryResult =
      await new RepositoryContextProvider().discoverWorkingSetFiles(
        ctx.tempDir,
        {
          maxCandidates: DISCOVERY_CANDIDATE_CAP,
          excludePath: target,
        },
      );
    expect(discovery.outcome).toBe('git-error');

    const acquisition = await acquireWorkingSet(target, ctx.tempDir);
    expect(acquisition.status.complete).toBe(false);
    expect(acquisition.status.partialReason).toBe('git-error');
  });

  it('reports a directory outside any Git work tree as no working set', async () => {
    const outside = createTempDir('llxprt-3232-nogit-');
    try {
      writeFileSync(
        join(outside.dir, 'plain.ts'),
        'export function one(): number { return 1; }\n',
        'utf-8',
      );
      const discovery: WorkingSetDiscoveryResult =
        await new RepositoryContextProvider().discoverWorkingSetFiles(
          outside.dir,
          { maxCandidates: DISCOVERY_CANDIDATE_CAP },
        );
      expect(discovery.outcome).toBe('no-working-set');
      expect(discovery.candidates).toHaveLength(0);
    } finally {
      outside.cleanup();
    }
  });

  it('observes a fresh repository without commits as a complete empty discovery', async () => {
    writeFileSync(
      join(ctx.tempDir, 'plain.ts'),
      'export function one(): number { return 1; }\n',
      'utf-8',
    );
    const discovery: WorkingSetDiscoveryResult =
      await new RepositoryContextProvider().discoverWorkingSetFiles(
        ctx.tempDir,
        { maxCandidates: DISCOVERY_CANDIDATE_CAP },
      );
    expect(discovery.outcome).toBe('complete');
    expect(discovery.candidates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// REQ-3232-2: bounded working-set file-count policy.
// ---------------------------------------------------------------------------

describe('REQ-3232-2: bounded working-set file-count policy', () => {
  const ctx = useTempDir();

  beforeEach(() => {
    gitInit(ctx.tempDir);
  });

  it('reports a below-limit working set as complete with no partial marker', async () => {
    seedAndModify(ctx.tempDir, simpleModifiedEntries(3, 'ws'));
    const target = writeTarget(ctx.tempDir);
    const result = await runRead(createFakeToolHost(ctx.tempDir), target);
    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('WORKING SET CONTEXT:');
    expect(output).not.toContain('(partial');
    expect(output).toContain('ws000.ts');
    expect(output).toContain('ws002.ts');
    const acquisition = await acquireWorkingSet(target, ctx.tempDir);
    expect(acquisition.status.complete).toBe(true);
    expect(acquisition.status.retainedFiles).toBe(3);
  });

  it('reports an exactly-at-limit working set as complete', async () => {
    seedAndModify(
      ctx.tempDir,
      simpleModifiedEntries(MAX_WORKING_SET_FILES, 'ex'),
    );
    const target = writeTarget(ctx.tempDir);
    const result = await runRead(createFakeToolHost(ctx.tempDir), target);
    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('WORKING SET CONTEXT:');
    expect(output).not.toContain('(partial');
    expect(output).toContain('ex049.ts');
    const acquisition = await acquireWorkingSet(target, ctx.tempDir);
    expect(acquisition.status.complete).toBe(true);
    expect(acquisition.status.retainedFiles).toBe(MAX_WORKING_SET_FILES);
    expect(acquisition.status.eligibleFiles).toBe(MAX_WORKING_SET_FILES);
    expect(acquisition.status.traversalComplete).toBe(true);
  });

  it('marks one-over as partial with the file-count reason and never acquires the 51st file', async () => {
    seedAndModify(
      ctx.tempDir,
      simpleModifiedEntries(MAX_WORKING_SET_FILES + 1, 'ov'),
    );
    const target = writeTarget(ctx.tempDir);
    const observing = new ObservingExtractor();
    const acquisition = await acquireWorkingSet(target, ctx.tempDir, observing);
    expect(acquisition.status.complete).toBe(false);
    expect(acquisition.status.partialReason).toBe('file-count');
    expect(acquisition.status.retainedFiles).toBe(MAX_WORKING_SET_FILES);
    expect(acquisition.status.eligibleFiles).toBe(DISCOVERY_CANDIDATE_CAP);
    expect(acquisition.status.traversalComplete).toBe(false);
    // The 51st candidate was observed as the one-over sentinel but never
    // read or parsed: exactly 50 real acquisitions happened.
    expect(observing.extractionEnters).toHaveLength(MAX_WORKING_SET_FILES);

    const result = await runRead(createFakeToolHost(ctx.tempDir), target);
    const output = String(result.llmContent);
    expect(output).toContain(
      'WORKING SET CONTEXT (partial: stopped at the file-count limit',
    );
    expect(output).toContain('at least 51');
    expect(output).not.toContain('ov050.ts');
    expect(output).toContain('ov000.ts');
  });

  it('bounds a far-over working set to observing only 51 candidates', async () => {
    seedAndModify(
      ctx.tempDir,
      simpleModifiedEntries(MAX_WORKING_SET_FILES * 3, 'far'),
    );
    const target = writeTarget(ctx.tempDir);
    const observing = new ObservingExtractor();
    const acquisition = await acquireWorkingSet(target, ctx.tempDir, observing);
    expect(acquisition.status.complete).toBe(false);
    expect(acquisition.status.partialReason).toBe('file-count');
    expect(acquisition.status.retainedFiles).toBe(MAX_WORKING_SET_FILES);
    // Discovery is bounded: only 51 of the 150 modified files are observed.
    expect(acquisition.status.eligibleFiles).toBe(DISCOVERY_CANDIDATE_CAP);
    expect(observing.extractionEnters).toHaveLength(MAX_WORKING_SET_FILES);
    const result = await runRead(createFakeToolHost(ctx.tempDir), target);
    const output = String(result.llmContent);
    expect(output).toContain('at least 51');
    expect(output).not.toContain('far149.ts');
    expect(output).toContain('far000.ts');
  });

  it('renders working-set files in deterministic sorted order', async () => {
    // Genuinely mixed working-set sources whose Git enumeration order
    // (unstaged diff, then staged diff, then recent-commit log) differs from
    // sorted order: a-staged is modified-and-staged after its commit, so only
    // the staged phase lists it; b-committed is a recent commit with an
    // unstaged modification; c-unstaged is only ever unstaged.
    writeFileSync(
      join(ctx.tempDir, 'c-unstaged.ts'),
      declarationsBody(1, 'c_'),
      'utf-8',
    );
    writeFileSync(
      join(ctx.tempDir, 'a-staged.ts'),
      declarationsBody(1, 'a_'),
      'utf-8',
    );
    gitCommitAll(ctx.tempDir, 'seed');
    writeFileSync(
      join(ctx.tempDir, 'a-staged.ts'),
      declarationsBody(2, 'a2_'),
      'utf-8',
    );
    gitCheck(ctx.tempDir, ['add', 'a-staged.ts']);
    writeFileSync(
      join(ctx.tempDir, 'b-committed.ts'),
      declarationsBody(1, 'b1_'),
      'utf-8',
    );
    gitCommitAll(ctx.tempDir, 'add b');
    writeFileSync(
      join(ctx.tempDir, 'b-committed.ts'),
      declarationsBody(2, 'b2_'),
      'utf-8',
    );
    writeFileSync(
      join(ctx.tempDir, 'c-unstaged.ts'),
      declarationsBody(2, 'c2_'),
      'utf-8',
    );

    const target = writeTarget(ctx.tempDir);
    const result = await runRead(createFakeToolHost(ctx.tempDir), target);
    const output = String(result.llmContent);
    const a = output.indexOf('a-staged.ts');
    const b = output.indexOf('b-committed.ts');
    const c = output.indexOf('c-unstaged.ts');
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('retains a multi-chunk working set completely and in sorted order', async () => {
    // Nine eligible candidates span three policy-sized planning/acquisition
    // chunks: every candidate must still be planned exactly once and the
    // retained order must stay sorted, proving the chunked planning of
    // stats changes nothing observable.
    seedAndModify(ctx.tempDir, simpleModifiedEntries(9, 'mc'));
    const target = writeTarget(ctx.tempDir);

    const acquisition = await acquireWorkingSet(target, ctx.tempDir);
    expect(acquisition.status.complete).toBe(true);
    expect(acquisition.status.retainedFiles).toBe(9);
    expect(acquisition.status.eligibleFiles).toBe(9);
    const retainedNames = acquisition.files.map(
      (file: ConnectedFile) => file.filePath,
    );
    const expected = Array.from({ length: 9 }, (_, i) =>
      join(ctx.tempDir, `mc${String(i).padStart(3, '0')}.ts`),
    );
    expect(retainedNames).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// REQ-3232-2: bounded working-set aggregate-byte policy.
// ---------------------------------------------------------------------------

describe('REQ-3232-2: bounded working-set aggregate-byte policy', () => {
  const ctx = useTempDir();
  const quarter = WORKING_SET_BYTE_BUDGET / 4;

  beforeEach(() => {
    gitInit(ctx.tempDir);
  });

  function sizedEntries(
    names: readonly string[],
    sizeBytes: number,
  ): ReadonlyArray<{ name: string; seed: string; modified: string }> {
    return names.map((name, i) => ({
      name,
      seed: paddedDeclarations(1, `s${i}_`, sizeBytes),
      modified: paddedDeclarations(1, `m${i}_`, sizeBytes),
    }));
  }

  it('reports an exactly-at-budget working set as complete', async () => {
    seedAndModify(
      ctx.tempDir,
      sizedEntries(['big0.ts', 'big1.ts', 'big2.ts', 'big3.ts'], quarter),
    );
    const target = writeTarget(ctx.tempDir);
    const result = await runRead(createFakeToolHost(ctx.tempDir), target);
    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('WORKING SET CONTEXT:');
    expect(output).not.toContain('(partial');
    const acquisition = await acquireWorkingSet(target, ctx.tempDir);
    expect(acquisition.status.complete).toBe(true);
    expect(acquisition.status.retainedFiles).toBe(4);
    expect(acquisition.status.retainedSourceBytes).toBe(
      WORKING_SET_BYTE_BUDGET,
    );
  });

  it('marks one-over-budget as partial without reading the over file', async () => {
    seedAndModify(
      ctx.tempDir,
      sizedEntries(['big0.ts', 'big1.ts', 'big2.ts', 'big3.ts'], quarter),
    );
    seedAndModify(ctx.tempDir, [
      {
        name: 'zz-extra.ts',
        seed: declarationsBody(1, 'zs_'),
        modified: declarationsBody(2, 'zm_'),
      },
    ]);
    const target = writeTarget(ctx.tempDir);
    const observing = new ObservingExtractor();
    const acquisition = await acquireWorkingSet(target, ctx.tempDir, observing);
    expect(acquisition.status.complete).toBe(false);
    expect(acquisition.status.partialReason).toBe('source-bytes');
    expect(acquisition.status.retainedSourceBytes).toBe(
      WORKING_SET_BYTE_BUDGET,
    );
    expect(acquisition.status.retainedFiles).toBe(4);
    // The authoritative stop happened before the over-budget file was read.
    expect(observing.extractionEnters).toHaveLength(4);

    const result = await runRead(createFakeToolHost(ctx.tempDir), target);
    const output = String(result.llmContent);
    expect(output).toContain(
      'WORKING SET CONTEXT (partial: stopped at the aggregate source-byte budget',
    );
    expect(output).not.toContain('zz-extra.ts');
  });

  it('bounds concurrent in-flight acquisition bytes to the aggregate budget', async () => {
    // Four files each individually inside the budget but jointly ~3.5x over
    // it: at most the first may be admitted, so concurrent materialization
    // never approaches four independent full budgets.
    const bigBytes = WORKING_SET_BYTE_BUDGET - 512 * 1024;
    seedAndModify(
      ctx.tempDir,
      sizedEntries(['b0.ts', 'b1.ts', 'b2.ts', 'b3.ts'], bigBytes),
    );
    const target = writeTarget(ctx.tempDir);
    const observing = new ObservingExtractor({ delayMs: 25 });
    const acquisition = await acquireWorkingSet(target, ctx.tempDir, observing);
    expect(acquisition.status.partialReason).toBe('source-bytes');
    expect(acquisition.status.retainedFiles).toBe(1);
    expect(observing.extractionEnters).toHaveLength(1);
    expect(observing.peakActiveContentBytes).toBeLessThanOrEqual(
      WORKING_SET_BYTE_BUDGET,
    );
  });

  it('skips an oversized single file and keeps the target read healthy', async () => {
    seedAndModify(
      ctx.tempDir,
      sizedEntries(['huge.ts'], WORKING_SET_BYTE_BUDGET + 1024),
    );
    seedAndModify(ctx.tempDir, [
      {
        name: 'small-a.ts',
        seed: declarationsBody(1, 'ss_'),
        modified: declarationsBody(2, 'sm_'),
      },
    ]);
    const target = writeTarget(ctx.tempDir);
    const result = await runRead(createFakeToolHost(ctx.tempDir), target);
    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('WORKING SET CONTEXT (partial');
    expect(output).toContain('1 oversized');
    expect(output).not.toContain('huge.ts:');
    expect(output).toContain('small-a.ts');
    const acquisition = await acquireWorkingSet(target, ctx.tempDir);
    expect(acquisition.status.complete).toBe(false);
    expect(acquisition.status.partialReason).toBe('skipped-files');
    expect(acquisition.status.oversizedFiles).toBe(1);
    expect(acquisition.status.retainedFiles).toBe(1);
    expect(acquisition.status.traversalComplete).toBe(true);
  });

  it('skips a working-set path that became a directory (cross-platform unreadable)', async () => {
    // Deterministic platform-neutral unreadable case: the tracked path is
    // replaced by a directory, so it exists but can never be read as a file.
    writeFileSync(
      join(ctx.tempDir, 'locked.ts'),
      declarationsBody(1, 'lk_'),
      'utf-8',
    );
    writeFileSync(
      join(ctx.tempDir, 'open.ts'),
      declarationsBody(1, 'op_'),
      'utf-8',
    );
    gitCommitAll(ctx.tempDir, 'seed');
    rmSync(join(ctx.tempDir, 'locked.ts'));
    mkdirSync(join(ctx.tempDir, 'locked.ts'));
    writeFileSync(
      join(ctx.tempDir, 'open.ts'),
      declarationsBody(2, 'op2_'),
      'utf-8',
    );
    const target = writeTarget(ctx.tempDir);

    const result = await runRead(createFakeToolHost(ctx.tempDir), target);
    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('WORKING SET CONTEXT (partial');
    expect(output).toContain('1 unreadable');
    expect(output).toContain('open.ts');
    const acquisition = await acquireWorkingSet(target, ctx.tempDir);
    expect(acquisition.status.complete).toBe(false);
    expect(acquisition.status.partialReason).toBe('skipped-files');
    expect(acquisition.status.skippedFiles).toBe(1);
    expect(acquisition.status.retainedFiles).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// REQ-3232-2: stat/read growth handling with bounded reads.
// ---------------------------------------------------------------------------

describe('REQ-3232-2: bounded reads handle files that grow after stat', () => {
  const ctx = useTempDir();
  const SMALL_GROWTH_BYTES = 200;
  const LARGE_GROWTH_BYTES = READ_SENTINEL_BYTES + 4096;

  beforeEach(() => {
    gitInit(ctx.tempDir);
  });

  function setupGrowthFixture(): {
    target: string;
    readonly expectedRetainedBytes: number;
  } {
    const grownEntries = [
      {
        name: 'g1.ts',
        seed: paddedDeclarations(1, 'gs1_', 2048),
        modified: paddedDeclarations(1, 'gm1_', 2048),
      },
      {
        name: 'g2.ts',
        seed: paddedDeclarations(1, 'gs2_', 2048),
        modified: paddedDeclarations(1, 'gm2_', 2048),
      },
    ];
    const anchorEntries = [0, 1, 2, 3].map((i) => ({
      name: `a${i}.ts`,
      seed: declarationsBody(1, `as${i}_`),
      modified: declarationsBody(2, `am${i}_`),
    }));
    seedAndModify(ctx.tempDir, [...anchorEntries, ...grownEntries]);
    const target = writeTarget(ctx.tempDir);
    const anchorsBytes = anchorEntries.reduce(
      (sum, entry) => sum + Buffer.byteLength(entry.modified),
      0,
    );
    return {
      target,
      expectedRetainedBytes: anchorsBytes + (2048 + SMALL_GROWTH_BYTES) + 2048,
    };
  }

  it('charges actual grown bytes when growth stays inside the read sentinel', async () => {
    const fixture = setupGrowthFixture();
    const observing = new ObservingExtractor({
      onFirstExtraction: () => {
        appendFileSync(
          join(ctx.tempDir, 'g1.ts'),
          'x'.repeat(SMALL_GROWTH_BYTES),
        );
      },
    });
    const acquisition = await acquireWorkingSet(
      fixture.target,
      ctx.tempDir,
      observing,
    );
    const retained = acquisition.files.map((f: ConnectedFile) => f.filePath);
    expect(retained).toContain(join(ctx.tempDir, 'g1.ts'));
    // The aggregate charge is the actual (grown) byte length, not the stale
    // size captured before the concurrent growth.
    expect(acquisition.status.retainedSourceBytes).toBe(
      fixture.expectedRetainedBytes,
    );
    expect(acquisition.status.complete).toBe(true);
  });

  it('skips a file that grows past its bounded read window as oversized', async () => {
    const fixture = setupGrowthFixture();
    const observing = new ObservingExtractor({
      onFirstExtraction: () => {
        appendFileSync(
          join(ctx.tempDir, 'g2.ts'),
          'x'.repeat(LARGE_GROWTH_BYTES),
        );
      },
    });
    const acquisition = await acquireWorkingSet(
      fixture.target,
      ctx.tempDir,
      observing,
    );
    expect(acquisition.status.complete).toBe(false);
    expect(acquisition.status.partialReason).toBe('skipped-files');
    expect(acquisition.status.oversizedFiles).toBe(1);
    expect(
      acquisition.files.some((f: ConnectedFile) =>
        f.filePath.endsWith('g2.ts'),
      ),
    ).toBe(false);
    expect(
      acquisition.files.some((f: ConnectedFile) =>
        f.filePath.endsWith('g1.ts'),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// REQ-3232-2: retained-declaration policy with bounded extraction.
// ---------------------------------------------------------------------------

describe('REQ-3232-2: bounded working-set retained-declaration policy', () => {
  const ctx = useTempDir();

  beforeEach(() => {
    gitInit(ctx.tempDir);
  });

  function setup(count: number, perFile: number, prefix = 'd'): string {
    seedAndModify(
      ctx.tempDir,
      Array.from({ length: count }, (_, i) => {
        const name = `${prefix}${String(i).padStart(3, '0')}.ts`;
        return {
          name,
          seed: declarationsBody(perFile - 1, `s${i}_`),
          modified: declarationsBody(perFile, `m${i}_`),
        };
      }),
    );
    return writeTarget(ctx.tempDir);
  }

  it('reports exactly-at-limit retained declarations as complete', async () => {
    const target = setup(MAX_WORKING_SET_DECLARATIONS / 20, 20);
    const result = await runRead(createFakeToolHost(ctx.tempDir), target);
    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).not.toContain('(partial');
    const acquisition = await acquireWorkingSet(target, ctx.tempDir);
    expect(acquisition.status.complete).toBe(true);
    expect(acquisition.status.retainedDeclarations).toBe(
      MAX_WORKING_SET_DECLARATIONS,
    );
  });

  it('marks one-over retained declarations as partial', async () => {
    const target = setup(26, 20);
    const result = await runRead(createFakeToolHost(ctx.tempDir), target);
    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain(
      'WORKING SET CONTEXT (partial: stopped at the retained-declaration limit',
    );
    const acquisition = await acquireWorkingSet(target, ctx.tempDir);
    expect(acquisition.status.complete).toBe(false);
    expect(acquisition.status.partialReason).toBe('declarations');
    expect(acquisition.status.retainedDeclarations).toBe(
      MAX_WORKING_SET_DECLARATIONS,
    );
    expect(acquisition.status.retainedFiles).toBe(25);
    expect(output).not.toContain('d025.ts');
  });

  it('observes the true 501st declaration as the one-over sentinel', async () => {
    // 25 files x 20 declarations = exactly 500; the final candidate holds
    // the literal 501st declaration and must not be retained. The sentinel
    // sorts after all d-prefixed fixtures so it is the last chunk acquired.
    const target = setup(25, 20, 'x');
    seedAndModify(ctx.tempDir, [
      {
        name: 'zz-last.ts',
        seed: 'export const last = 1;\n',
        modified: declarationsBody(1, 'last_'),
      },
    ]);
    const acquisition = await acquireWorkingSet(target, ctx.tempDir);
    expect(acquisition.status.partialReason).toBe('declarations');
    expect(acquisition.status.retainedDeclarations).toBe(
      MAX_WORKING_SET_DECLARATIONS,
    );
    expect(acquisition.status.retainedFiles).toBe(25);
    expect(
      acquisition.files.some((f: ConnectedFile) =>
        f.filePath.endsWith('zz-last.ts'),
      ),
    ).toBe(false);
  });

  it('acquires at most remaining+1 declarations from a declaration-dense file', async () => {
    // One first candidate with 3000 declarations: the bounded extractor may
    // materialize at most 501 (one-over sentinel), never the full array.
    const dense = declarationsBody(3000, 'dense_');
    seedAndModify(ctx.tempDir, [
      { name: 'dense.ts', seed: dense, modified: dense },
    ]);
    const target = writeTarget(ctx.tempDir);

    const observing = new ObservingExtractor();
    const acquisition = await acquireWorkingSet(target, ctx.tempDir, observing);
    expect(acquisition.status.partialReason).toBe('declarations');
    expect(acquisition.status.retainedDeclarations).toBe(0);
    expect(acquisition.status.retainedFiles).toBe(0);
    expect(observing.boundedLengths).toEqual([
      MAX_WORKING_SET_DECLARATIONS + 1,
    ]);
    const result = await runRead(createFakeToolHost(ctx.tempDir), target);
    const output = String(result.llmContent);
    expect(output).toContain('stopped at the retained-declaration limit (500)');
    expect(output).not.toContain('dense.ts:');
  });
});
