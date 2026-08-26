/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for ast_read_file display and metadata compatibility
 * (issue #3232, Finding 6).
 */

import { describe, it, expect } from 'bun:test';
import { writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createFakeToolHost, useTempDir } from './test-helpers.js';
import {
  gitInit,
  runRead,
  recordOf,
  seedAndModify,
  simpleModifiedEntries,
  writeTarget,
  acquireWorkingSet,
} from './ast-read-file-bounded-helpers.js';
import type {
  WorkingSetAcquisitionStatus,
  WorkingSetPartialReason,
} from '../types.js';

// ---------------------------------------------------------------------------
// Item: WorkingSetAcquisitionStatus is a complete/partial discriminated union.
// ---------------------------------------------------------------------------

type Expect<T extends true> = T;
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

type CompleteStatus = Extract<WorkingSetAcquisitionStatus, { complete: true }>;
type PartialStatus = Extract<WorkingSetAcquisitionStatus, { complete: false }>;

/** A complete acquisition may not carry any partial reason. */
type CompleteForbidsReason = Expect<
  Equal<CompleteStatus['partialReason'], undefined>
>;
/** An incomplete acquisition must carry exactly one reason. */
type PartialRequiresReason = Expect<
  Equal<PartialStatus['partialReason'], WorkingSetPartialReason>
>;

// Compile-time witnesses (fail to compile if the union regresses).
const completeForbidsReason: CompleteForbidsReason = true;
const partialRequiresReason: PartialRequiresReason = true;
void completeForbidsReason;
void partialRequiresReason;

/**
 * Narrow a runtime status to its complete variant, failing loudly (never
 * conditionally) when acquisition was partial. Keeps the expects outside any
 * branch so the behavioral assertions stay unconditional.
 */
function assumeComplete(status: WorkingSetAcquisitionStatus): CompleteStatus {
  if (status.complete) {
    return status;
  }
  throw new Error(
    `expected a complete acquisition, got: ${String(status.partialReason)}`,
  );
}

/** Narrow a runtime status to its partial variant, failing loudly otherwise. */
function assumePartial(status: WorkingSetAcquisitionStatus): PartialStatus {
  if (!status.complete) {
    return status;
  }
  throw new Error('expected a partial acquisition, got a complete one');
}

describe('REQ-3232-4: display and metadata compatibility', () => {
  const ctx = useTempDir();

  it('keeps returnDisplay metadata exactly {language, declarationsCount}', async () => {
    gitInit(ctx.tempDir);
    const target = join(ctx.tempDir, 'plain.ts');
    writeFileSync(
      target,
      'export function one(): number { return 1; }\nexport function two(): number { return 2; }\n',
      'utf-8',
    );
    const result = await runRead(createFakeToolHost(ctx.tempDir), target);
    expect(result.error).toBeUndefined();
    const display = recordOf(result.returnDisplay, 'returnDisplay');
    expect(display.fileName).toBe('plain.ts');
    expect(String(display.content)).toContain('export function one()');
    const metadata = recordOf(display.metadata, 'metadata');
    // The public metadata contract is exactly these two fields — no
    // working-set accounting leaks into the display payload.
    expect(metadata).toStrictEqual({
      language: 'typescript',
      declarationsCount: 2,
    });
    const output = String(result.llmContent);
    expect(output).not.toContain('WORKING SET CONTEXT');
    expect(existsSync(target)).toBe(true);
  });
});

describe('REQ-3232-4: acquisition status discrimination', () => {
  const ctx = useTempDir();

  it('carries no partial reason on a complete acquisition', async () => {
    gitInit(ctx.tempDir);
    seedAndModify(ctx.tempDir, simpleModifiedEntries(2, 'cd'));
    const target = writeTarget(ctx.tempDir);

    const acquisition = await acquireWorkingSet(target, ctx.tempDir);
    const complete = assumeComplete(acquisition.status);
    // Narrowed to the complete variant: no reason key may exist at all.
    expect('partialReason' in complete).toBe(false);
    expect(complete.retainedFiles).toBe(2);
  });

  it('requires exactly one partial reason on an incomplete acquisition', async () => {
    gitInit(ctx.tempDir);
    // One retained candidate plus one that vanishes before acquisition: the
    // run is traversal-complete but partial because a file was skipped.
    seedAndModify(ctx.tempDir, simpleModifiedEntries(2, 'pd'));
    const target = writeTarget(ctx.tempDir);
    rmSync(join(ctx.tempDir, 'pd001.ts'));

    const acquisition = await acquireWorkingSet(target, ctx.tempDir);
    const partial = assumePartial(acquisition.status);
    expect(partial.partialReason).toBe('skipped-files');
    expect(partial.missingFiles).toBe(1);
    expect(partial.traversalComplete).toBe(true);
  });
});
