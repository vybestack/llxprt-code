/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for ast_read_file cancellation, max-in-flight observation,
 * and skipped-only/failed contexts (issue #3232, REQ-3232-3/4, Finding 8).
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { writeFileSync, rmSync, chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ASTQueryExtractor } from '../ast-query-extractor.js';
import { ASTContextCollector } from '../context-collector.js';
import { ASTReadFileToolInvocation } from '../ast-read-file-invocation.js';
import { RepositoryContextProvider } from '../repository-context-provider.js';
import { enrichWithWorkingSetContext } from '../workspace-context-provider.js';
import { createFakeToolHost, useTempDir } from './test-helpers.js';
import {
  runRead,
  acquireWorkingSet,
  gitInit,
  gitCommitAll,
  declarationsBody,
  paddedDeclarations,
  seedAndModify,
  writeTarget,
  simpleModifiedEntries,
  ObservingExtractor,
  MAX_WORKING_SET_FILES,
  MAX_WORKING_SET_DECLARATIONS,
  WORKING_SET_CONCURRENCY,
  WORKING_SET_BYTE_BUDGET,
} from './ast-read-file-bounded-helpers.js';
// ---------------------------------------------------------------------------
// REQ-3232-2: competing-limit reason precedence.
// ---------------------------------------------------------------------------

describe('REQ-3232-2: competing-limit reason precedence', () => {
  const ctx = useTempDir();

  beforeEach(() => {
    gitInit(ctx.tempDir);
  });

  const observeReportsFileCountWhenCountBytesAndDeclarationsTripTogetherAt46 =
    async () => {
      const perFileBytes = Math.floor(WORKING_SET_BYTE_BUDGET / 50);
      seedAndModify(
        ctx.tempDir,
        Array.from({ length: MAX_WORKING_SET_FILES + 1 }, (_, i) => {
          const isSentinel = i === MAX_WORKING_SET_FILES;
          const size = isSentinel ? 4096 : perFileBytes;
          const decls = isSentinel ? 1 : 10;
          return {
            name: `c${String(i).padStart(3, '0')}.ts`,
            seed: paddedDeclarations(decls, `s${i}_`, size),
            modified: paddedDeclarations(decls, `m${i}_`, size),
          };
        }),
      );
      const target = writeTarget(ctx.tempDir);
      const observing = new ObservingExtractor();
      const acquisition = await acquireWorkingSet(
        target,
        ctx.tempDir,
        observing,
      );
      return { perFileBytes, observing, acquisition };
    };

  it('reports file-count when count, bytes, and declarations trip together', async () => {
    const { perFileBytes, observing, acquisition } =
      await observeReportsFileCountWhenCountBytesAndDeclarationsTripTogetherAt46();
    expect(acquisition.status.partialReason).toBe('file-count');
    expect(acquisition.status.retainedFiles).toBe(MAX_WORKING_SET_FILES);
    expect(acquisition.status.retainedDeclarations).toBe(
      MAX_WORKING_SET_DECLARATIONS,
    );
    expect(acquisition.status.retainedSourceBytes).toBe(
      perFileBytes * MAX_WORKING_SET_FILES,
    );
    expect(observing.extractionEnters).toHaveLength(MAX_WORKING_SET_FILES);
  });

  const observeReportsSourceBytesBeforeDeclarationsWhenBothWouldTripAt79 =
    async () => {
      const perFileBytes = 167721;
      seedAndModify(
        ctx.tempDir,
        Array.from({ length: 26 }, (_, i) => {
          const isOver = i === 25;
          const size = isOver ? 2048 : perFileBytes;
          const decls = isOver ? 2 : 20;
          return {
            name: `p${String(i).padStart(3, '0')}.ts`,
            seed: paddedDeclarations(decls, `s${i}_`, size),
            modified: paddedDeclarations(decls, `m${i}_`, size),
          };
        }),
      );
      const target = writeTarget(ctx.tempDir);
      const observing = new ObservingExtractor();
      const acquisition = await acquireWorkingSet(
        target,
        ctx.tempDir,
        observing,
      );
      return { observing, acquisition };
    };

  it('reports source-bytes before declarations when both would trip', async () => {
    const { observing, acquisition } =
      await observeReportsSourceBytesBeforeDeclarationsWhenBothWouldTripAt79();
    expect(acquisition.status.partialReason).toBe('source-bytes');
    expect(acquisition.status.retainedFiles).toBe(25);
    expect(acquisition.status.retainedDeclarations).toBe(
      MAX_WORKING_SET_DECLARATIONS,
    );
    expect(observing.extractionEnters).toHaveLength(25);
  });
});

// ---------------------------------------------------------------------------
// REQ-3232-4 / accurate completeness: skipped-only and failed contexts.
// ---------------------------------------------------------------------------

describe('REQ-3232-4: accurate completeness and skipped-only contexts', () => {
  const ctx = useTempDir();

  beforeEach(() => {
    gitInit(ctx.tempDir);
  });

  it('renders partial accounting when the only eligible file went missing', async () => {
    writeFileSync(
      join(ctx.tempDir, 'gone.ts'),
      declarationsBody(1, 'gone_'),
      'utf-8',
    );
    gitCommitAll(ctx.tempDir, 'seed');
    rmSync(join(ctx.tempDir, 'gone.ts'));
    const target = writeTarget(ctx.tempDir);

    const acquisition = await acquireWorkingSet(target, ctx.tempDir);
    expect(acquisition.files).toHaveLength(0);
    expect(acquisition.status.complete).toBe(false);
    expect(acquisition.status.partialReason).toBe('skipped-files');
    expect(acquisition.status.missingFiles).toBe(1);
    expect(acquisition.status.eligibleFiles).toBe(1);
    expect(acquisition.status.traversalComplete).toBe(true);

    const result = await runRead(createFakeToolHost(ctx.tempDir), target);
    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('WORKING SET CONTEXT (partial');
    expect(output).toContain('no working-set files retained');
    expect(output).toContain('1 missing');
  });

  it('renders partial accounting when the only eligible file is oversized', async () => {
    seedAndModify(ctx.tempDir, [
      {
        name: 'only.ts',
        seed: paddedDeclarations(1, 'os_', WORKING_SET_BYTE_BUDGET + 512),
        modified: paddedDeclarations(1, 'om_', WORKING_SET_BYTE_BUDGET + 512),
      },
    ]);
    const target = writeTarget(ctx.tempDir);

    const acquisition = await acquireWorkingSet(target, ctx.tempDir);
    expect(acquisition.files).toHaveLength(0);
    expect(acquisition.status.complete).toBe(false);
    expect(acquisition.status.partialReason).toBe('skipped-files');
    expect(acquisition.status.oversizedFiles).toBe(1);

    const result = await runRead(createFakeToolHost(ctx.tempDir), target);
    const output = String(result.llmContent);
    expect(output).toContain('no working-set files retained');
    expect(output).toContain('1 oversized');
  });

  it('renders a Git error to the LLM instead of an empty complete set', async () => {
    const sha = seedAndModify(ctx.tempDir, simpleModifiedEntries(1, 'ge'));
    const target = writeTarget(ctx.tempDir);
    // Corrupt the commit object that HEAD points to: the repository probe
    // passes, the unstaged diff phase succeeds (it does not need HEAD), but
    // the staged diff phase fails when it tries to resolve the index tree
    // against the corrupt commit. Discovery keeps its earlier candidate
    // and surfaces the error.
    const objectPath = join(
      ctx.tempDir,
      '.git',
      'objects',
      sha.slice(0, 2),
      sha.slice(2),
    );
    chmodSync(objectPath, 0o644);
    writeFileSync(objectPath, 'garbage', 'utf-8');

    const acquisition = await acquireWorkingSet(target, ctx.tempDir);
    expect(acquisition.status.complete).toBe(false);
    expect(acquisition.status.partialReason).toBe('git-error');
    // Candidates discovered before the failing phase are still retained.
    expect(acquisition.status.retainedFiles).toBe(1);

    const result = await runRead(createFakeToolHost(ctx.tempDir), target);
    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('Git working-set discovery failed');
    expect(output).toContain('ge000.ts');
  });

  it('renders Git-error eligible counts as lower bounds', async () => {
    // Candidates were observed before the failing phase, but the true
    // eligible set was never exhausted: the rendered count must read
    // "at least N" instead of an exact total, exactly like truncation.
    const sha = seedAndModify(ctx.tempDir, simpleModifiedEntries(2, 'lb'));
    const target = writeTarget(ctx.tempDir);
    const objectPath = join(
      ctx.tempDir,
      '.git',
      'objects',
      sha.slice(0, 2),
      sha.slice(2),
    );
    chmodSync(objectPath, 0o644);
    writeFileSync(objectPath, 'garbage', 'utf-8');

    const acquisition = await acquireWorkingSet(target, ctx.tempDir);
    expect(acquisition.status.partialReason).toBe('git-error');
    expect(acquisition.status.eligibleFiles).toBe(2);

    const result = await runRead(createFakeToolHost(ctx.tempDir), target);
    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('at least 2');
    expect(output).not.toContain(' of 2 ');
    expect(output).toContain('lb000.ts');
    expect(output).toContain('lb001.ts');
  });
});

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// REQ-3232-2: acquisition never rejects on a single bad file (read boundary).
// ---------------------------------------------------------------------------

describe('REQ-3232-2: acquisition never rejects on a mid-read fault', () => {
  const ctx = useTempDir();

  beforeEach(() => {
    gitInit(ctx.tempDir);
  });

  it('counts a candidate whose read fails after planning as unreadable, never rejecting', async () => {
    // Eight eligible files: the first chunk (four files) is acquired while a
    // deliberate real fault replaces a second-chunk candidate with a
    // directory. Its stat already ran, so the failure lands at the open/read
    // boundary of acquisition — the exact contract under test.
    seedAndModify(ctx.tempDir, simpleModifiedEntries(8, 'fl'));
    const victim = join(ctx.tempDir, 'fl006.ts');
    const target = writeTarget(ctx.tempDir);
    const observing = new ObservingExtractor({
      delayMs: 100,
      onFirstExtraction: () => {
        rmSync(victim);
        mkdirSync(victim);
      },
    });

    const acquisition = await acquireWorkingSet(target, ctx.tempDir, observing);
    expect(acquisition.status.complete).toBe(false);
    expect(acquisition.status.partialReason).toBe('skipped-files');
    expect(acquisition.status.skippedFiles).toBe(1);
    // The other seven candidates were still retained.
    expect(acquisition.status.retainedFiles).toBe(7);

    const result = await runRead(createFakeToolHost(ctx.tempDir), target);
    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('1 unreadable');
    expect(output).toContain('fl000.ts');
  });

  it('charges the exact raw bytes read for a file containing invalid UTF-8', async () => {
    // Four bytes of 0x80 are invalid UTF-8: re-encoding the decoded text
    // back to UTF-8 would replace them with U+FFFD sequences (12 bytes) and
    // mis-charge the budget. The authoritative charge is the raw read count.
    const body = 'export function bad(): void {}\n';
    const raw = Buffer.concat([
      Buffer.from(body, 'utf-8'),
      Buffer.from([0x80, 0x80, 0x80, 0x80]),
    ]);
    writeFileSync(join(ctx.tempDir, 'invalid.ts'), raw);
    gitCommitAll(ctx.tempDir, 'seed invalid');
    writeFileSync(
      join(ctx.tempDir, 'anchor.ts'),
      'export const a = 1;\n',
      'utf-8',
    );
    gitCommitAll(ctx.tempDir, 'seed anchor');
    writeFileSync(join(ctx.tempDir, 'invalid.ts'), raw);
    writeFileSync(
      join(ctx.tempDir, 'anchor.ts'),
      'export const a = 2;\n',
      'utf-8',
    );
    const target = writeTarget(ctx.tempDir);

    const acquisition = await acquireWorkingSet(target, ctx.tempDir);
    expect(
      acquisition.files.some(
        (file) => file.filePath === join(ctx.tempDir, 'invalid.ts'),
      ),
    ).toBe(true);
    const anchorBytes = Buffer.byteLength('export const a = 2;\n');
    expect(acquisition.status.retainedSourceBytes).toBe(
      raw.length + anchorBytes,
    );
  });
});
// REQ-3232-3: cancellation threading.
// ---------------------------------------------------------------------------

describe('REQ-3232-3: invocation signal threading', () => {
  const ctx = useTempDir();

  beforeEach(() => {
    gitInit(ctx.tempDir);
    seedAndModify(ctx.tempDir, [
      {
        name: 'ws-one.ts',
        seed: declarationsBody(2, 'w1s_'),
        modified: declarationsBody(3, 'w1m_'),
      },
    ]);
  });

  it('a pre-aborted signal schedules no working-set acquisition', async () => {
    const target = writeTarget(ctx.tempDir);
    const controller = new AbortController();
    controller.abort();
    const result = await runRead(
      createFakeToolHost(ctx.tempDir),
      target,
      controller.signal,
    );
    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('LLXPRT READ: ');
    expect(output).toContain('CONTEXT ANALYSIS:');
    expect(output).not.toContain('ws-one.ts');
    expect(output).toContain('WORKING SET CONTEXT (partial: cancelled');
    const acquisition = await acquireWorkingSet(
      target,
      ctx.tempDir,
      new ASTQueryExtractor(),
      controller.signal,
    );
    expect(acquisition.status.complete).toBe(false);
    expect(acquisition.status.partialReason).toBe('cancelled');
    expect(acquisition.status.retainedFiles).toBe(0);
    expect(acquisition.status.eligibleFiles).toBe(0);
  });

  it('aborting during discovery terminates the Git child and reports cancelled', async () => {
    seedAndModify(ctx.tempDir, simpleModifiedEntries(40, 'ab'));
    const target = writeTarget(ctx.tempDir);
    const controller = new AbortController();
    const pending = acquireWorkingSet(
      target,
      ctx.tempDir,
      new ASTQueryExtractor(),
      controller.signal,
    );
    // The abort lands while the async Git discovery child is still running;
    // it must terminate that exact child and surface cancellation.
    controller.abort();
    const acquisition = await pending;
    expect(acquisition.files).toHaveLength(0);
    expect(acquisition.status.complete).toBe(false);
    expect(acquisition.status.partialReason).toBe('cancelled');
  });

  it('mid-collection abort stops scheduling new work after in-flight items finish', async () => {
    seedAndModify(ctx.tempDir, simpleModifiedEntries(20, 'mi'));
    const target = writeTarget(ctx.tempDir);

    const controller = new AbortController();
    const observing = new ObservingExtractor({
      onFirstExtraction: () => {
        controller.abort();
      },
    });
    const acquisition = await enrichWithWorkingSetContext(
      target,
      ctx.tempDir,
      new RepositoryContextProvider(),
      observing,
      controller.signal,
    );
    // In-flight chunk items finish (bounded by the concurrency policy)...
    expect(acquisition.files).toHaveLength(WORKING_SET_CONCURRENCY);
    expect(acquisition.files.length).toBeLessThan(20);
    expect(acquisition.status.complete).toBe(false);
    expect(acquisition.status.partialReason).toBe('cancelled');
    expect(acquisition.status.retainedFiles).toBe(WORKING_SET_CONCURRENCY);
    // The beforeEach working-set file is also eligible.
    expect(acquisition.status.eligibleFiles).toBe(21);
    // ...and no additional acquisition starts after the abort: exactly the
    // first chunk was read and parsed, nothing beyond it.
    expect(observing.extractionEnters).toHaveLength(WORKING_SET_CONCURRENCY);
  });

  it('renders cancelled working-set accounting with a lower-bound eligible count', async () => {
    // A mid-collection abort retains only the in-flight chunk while more
    // eligible files were already observed: cancellation proves a lower
    // bound, never an exact total, so the rendered header must read
    // "at least N" exactly like discovery truncation.
    seedAndModify(ctx.tempDir, simpleModifiedEntries(20, 'rc'));
    const target = writeTarget(ctx.tempDir);

    const controller = new AbortController();
    const observing = new ObservingExtractor({
      onFirstBoundedExtraction: () => {
        controller.abort();
      },
    });
    const invocation = new ASTReadFileToolInvocation(
      createFakeToolHost(ctx.tempDir),
      { file_path: target },
      new ASTContextCollector(observing),
    );
    const result = await invocation.execute(controller.signal);
    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('partial: cancelled before completion');
    // The beforeEach working-set file makes the observed eligible set 21.
    expect(output).toContain(
      `retained ${WORKING_SET_CONCURRENCY} of at least 21 files`,
    );
    expect(output).not.toContain(' of 21 ');
  });
});

// ---------------------------------------------------------------------------
// Finding 8: genuine max-in-flight acquisition observation.
// ---------------------------------------------------------------------------

describe('max-in-flight acquisition stays within the concurrency policy', () => {
  const ctx = useTempDir();

  beforeEach(() => {
    gitInit(ctx.tempDir);
  });

  it('observes peak active real acquisitions at or below the policy', async () => {
    seedAndModify(ctx.tempDir, simpleModifiedEntries(12, 'kk'));
    const target = writeTarget(ctx.tempDir);

    // Deterministic chunk barrier: every extraction holds until the
    // policy-sized chunk has fully entered, so overlap is observed because
    // of the concurrency policy itself, not a timing window. A regression
    // that serializes acquisition is released by the barrier's bounded
    // failure timer and fails the peak assertion below instead of hanging.
    const observing = new ObservingExtractor({
      barrierWidth: WORKING_SET_CONCURRENCY,
    });
    const acquisition = await acquireWorkingSet(target, ctx.tempDir, observing);
    expect(acquisition.status.complete).toBe(true);
    expect(observing.peakActive).toBe(WORKING_SET_CONCURRENCY);
  });
});
