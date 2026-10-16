/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @plan PLAN-20260917-ISSUE854.P05
 * @requirement G2
 *
 * RED session for P05b1 (implementation-plan.md §6): durable mutations as
 * journal ops. Every live history mutation must have a durable journal
 * operation, and the journal format is EXTENDED with three append-only event
 * kinds so the previously lossy or unjournalled mutations reproduce exactly:
 *
 *   density_mutation   — chronology seqs removed outright, plus each
 *                        replacement as {replacedSeq, replacement} where the
 *                        replacement inherits the replaced marker.
 *   synthetic_insert   — the inserted IContent, its own chronology seq, and
 *                        the anchor entry's chronology seq.
 *   compression_detail — the destroyed span (fromSeq, toSeq) + item count;
 *                        content suppression unchanged, payload has no
 *                        content.
 *
 * Pinned write-side API (assumed surface, named for the green session):
 *
 *   SessionRecordingService.recordDensityChange(payload: DensityMutationPayload)
 *   SessionRecordingService.recordSyntheticInsert(payload: SyntheticInsertPayload)
 *   SessionRecordingService.recordCompressionDetail(payload: CompressionDetailPayload)
 *
 * each appending one envelope via enqueue and returning the SessionRecordLine,
 * or null when inactive (recordSessionFork payload-object style).
 *
 * Pinned read-side behavior: JournalResolver (and ReplayEngine) fold the new
 * kinds — density replacement swaps the survivor row at the original content
 * envelope in place; removed seqs drop survivor rows; a synthetic insert adds
 * a row attributed to its own envelope at the anchor position even when fold
 * order stops matching envelope order; a compression detail changes no rows
 * (whole-history replacement stays with `compressed`) and a malformed detail
 * is skipped and counted like any malformed event. Legacy journals without
 * the new kinds replay with today's documented divergence.
 *
 * The oracle is the LIVE MODEL PROJECTION, not the replay engine alone: the
 * equivalence tests apply the same mutation script to a real HistoryService
 * and to a journal driven through the durable ops, then compare resolved rows
 * and the P03 membership spans against the live service. Tests-only in the
 * red session; the failures below are the contract the green session implements.
 */

import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import { SessionRecordingService } from './SessionRecordingService.js';
import { replaySession } from './ReplayEngine.js';
import {
  PROJECT_HASH,
  DENSITY_KIND,
  SYNTHETIC_KIND,
  COMPRESSION_DETAIL_KIND,
  marked,
  summaryFor,
  readEnvelopes,
  payloadContentOf,
  materializedPath,
  makeRecordingConfig,
  MutationJournalBuilder,
  collectResolverRows,
  projectDensityMutation,
  expectProjectedRowsEqual,
  toProjected,
  requireReplaySuccess,
  projectedFromContents,
  textOf,
  useDurableDirs,
  type DensityReplacementFixture,
  type ProjectedRow,
} from './durable-mutations.test.helpers.js';

describe('Durable mutations @plan:PLAN-20260917-ISSUE854.P05 @requirement:G2', () => {
  const dirs = useDurableDirs();
  // WRITE side — the durable-mutation recorder API appends exact envelopes.
  // RED today: the methods do not exist on SessionRecordingService.
  // -------------------------------------------------------------------------

  it('recordDensityChange appends a density_mutation envelope carrying removed seqs and replacement records', async () => {
    const recording = new SessionRecordingService(
      makeRecordingConfig(dirs.chatsDir),
    );
    recording.recordContent(marked('human', 'A', 1));
    await recording.flush();
    const sessionFile = materializedPath(recording);
    const bytesBefore = await fs.readFile(sessionFile, 'utf8');

    const line = recording.recordDensityChange({
      removedSeqs: [2],
      replacements: [
        { replacedSeq: 3, replacement: marked('ai', 'C-dense', 3) },
      ],
    });
    await recording.flush();
    await recording.dispose();

    // Append-only: every byte written before the density event is untouched.
    const bytesAfter = await fs.readFile(sessionFile, 'utf8');
    expect(bytesAfter.startsWith(bytesBefore)).toBe(true);

    const envelopes = await readEnvelopes(sessionFile);
    const density = envelopes[envelopes.length - 1];
    expect(density.type).toBe(DENSITY_KIND);
    expect(density.seq).toBe(3);
    expect(density.payload['removedSeqs']).toStrictEqual([2]);
    expect(density.payload['replacements']).toStrictEqual([
      { replacedSeq: 3, replacement: marked('ai', 'C-dense', 3) },
    ]);
    expect(line).not.toBeNull();
    if (line === null) {
      throw new Error('recordDensityChange returned null while active');
    }
    expect(line.seq).toBe(density.seq);
  });
  it('recordSyntheticInsert appends a synthetic_insert envelope with the inserted content, its marker, and the anchor', async () => {
    const recording = new SessionRecordingService(
      makeRecordingConfig(dirs.chatsDir),
    );
    const inserted = marked('tool', 'synthetic response', 4);
    recording.recordContent(marked('human', 'A', 1));
    recording.recordContent(marked('ai', 'B', 2));

    recording.recordSyntheticInsert({
      content: inserted,
      chronologySeq: 4,
      afterSeq: 2,
    });
    await recording.flush();
    await recording.dispose();

    const envelopes = await readEnvelopes(materializedPath(recording));
    const insert = envelopes[envelopes.length - 1];
    expect(insert.type).toBe(SYNTHETIC_KIND);
    expect(Object.keys(insert.payload).sort()).toStrictEqual([
      'afterSeq',
      'chronologySeq',
      'content',
    ]);
    expect(insert.payload['chronologySeq']).toBe(4);
    expect(insert.payload['afterSeq']).toBe(2);
    expect(payloadContentOf(insert.payload)).toStrictEqual(inserted);
  });
});

describe('Durable mutations @plan:PLAN-20260917-ISSUE854.P05 @requirement:G2 / read-side and recorder cases 2', () => {
  const dirs = useDurableDirs();
  it('recordCompressionDetail appends a compression_detail envelope whose payload carries only the destroyed span and count — no content', async () => {
    const recording = new SessionRecordingService(
      makeRecordingConfig(dirs.chatsDir),
    );
    recording.recordContent(marked('human', 'A', 1));

    recording.recordCompressionDetail({
      fromSeq: 1,
      toSeq: 3,
      itemsCompressed: 3,
    });
    await recording.flush();
    await recording.dispose();

    const envelopes = await readEnvelopes(materializedPath(recording));
    const detail = envelopes[envelopes.length - 1];
    expect(detail.type).toBe(COMPRESSION_DETAIL_KIND);
    // Content suppression unchanged: the detail record carries scalars only.
    expect(Object.keys(detail.payload).sort()).toStrictEqual([
      'fromSeq',
      'itemsCompressed',
      'toSeq',
    ]);
    expect(detail.payload['fromSeq']).toBe(1);
    expect(detail.payload['toSeq']).toBe(3);
    expect(detail.payload['itemsCompressed']).toBe(3);
  });
  it('returns null from every durable-mutation recorder when recording is inactive', async () => {
    const recording = new SessionRecordingService(
      makeRecordingConfig(dirs.chatsDir),
    );
    await recording.dispose();

    expect(
      recording.recordDensityChange({ removedSeqs: [1], replacements: [] }),
    ).toBeNull();
    expect(
      recording.recordSyntheticInsert({
        content: marked('tool', 'S', 2),
        chronologySeq: 2,
        afterSeq: 1,
      }),
    ).toBeNull();
    expect(
      recording.recordCompressionDetail({
        fromSeq: 1,
        toSeq: 1,
        itemsCompressed: 1,
      }),
    ).toBeNull();
  });
});

describe('Durable mutations @plan:PLAN-20260917-ISSUE854.P05 @requirement:G2 / read-side and recorder cases 3', () => {
  const dirs = useDurableDirs();
  // -------------------------------------------------------------------------
  // READ side — resolver folds of the new kinds, oracle = live-model
  // projection. RED today: unknown event kinds never touch history, so the
  // rows resolve as if the mutation never happened.
  // -------------------------------------------------------------------------

  it('resolves a density_mutation by swapping the replacement in place at the original envelope and dropping removed rows', async () => {
    const builder = new MutationJournalBuilder(dirs.journalPath);
    await builder.start();
    const a = await builder.content('human', 'A');
    await builder.content('ai', 'B');
    const c = await builder.content('ai', 'C');
    const replacements: DensityReplacementFixture[] = [
      { replacedSeq: 3, replacement: marked('ai', 'C-dense', 3) },
    ];
    await builder.density([2], replacements);

    const baseRows: ProjectedRow[] = [
      { chron: 1, text: 'A' },
      { chron: 2, text: 'B' },
      { chron: 3, text: 'C' },
    ];
    // Oracle: the live-model projection of the same mutation, projected in
    // this test — not the journal-only rows and not the replay engine.
    const live = projectDensityMutation(baseRows, [2], replacements);
    const resolved = await collectResolverRows(dirs.journalPath);

    expectProjectedRowsEqual(toProjected(resolved), live);
    expect(toProjected(resolved)).not.toStrictEqual(baseRows);
    // The replacement is attributed to the original content envelope.
    expect(resolved.rows[1]?.seq).toBe(c.seq);
    expect(resolved.rows[1]?.rowIndex).toBe(0);
    expect(resolved.rows[0]?.seq).toBe(a.seq);
  });
  it('folds a count rewind over the density-mutated survivor set', async () => {
    const builder = new MutationJournalBuilder(dirs.journalPath);
    await builder.start();
    await builder.content('human', 'A');
    await builder.content('ai', 'B');
    await builder.content('ai', 'C');
    await builder.density([2], []);
    await builder.rewind(1);

    const baseRows: ProjectedRow[] = [
      { chron: 1, text: 'A' },
      { chron: 2, text: 'B' },
      { chron: 3, text: 'C' },
    ];
    // Live: density left [A, C]; the rewind removed the last survivor (C).
    const live = projectDensityMutation(baseRows, [2], []).slice(0, -1);
    const resolved = await collectResolverRows(dirs.journalPath);

    expect(resolved.rows).toHaveLength(1);
    expectProjectedRowsEqual(toProjected(resolved), live);
  });
});

describe('Durable mutations @plan:PLAN-20260917-ISSUE854.P05 @requirement:G2 / read-side and recorder cases 4', () => {
  const dirs = useDurableDirs();
  it('resolves a synthetic_insert as a row attributed to its own envelope at the anchor position', async () => {
    const builder = new MutationJournalBuilder(dirs.journalPath);
    await builder.start();
    const a = await builder.content('human', 'A');
    await builder.content('ai', 'B');
    const c = await builder.content('ai', 'C');
    const insert = await builder.syntheticInsert(marked('tool', 'S', 4), 4, 2);

    const resolved = await collectResolverRows(dirs.journalPath);
    const texts = resolved.rows.map((row) => row.text);
    const chrons = resolved.rows.map((row) => row.chron);

    // Live projection after the insert: [A, B, S, C] — S lands immediately
    // after its anchor (chron 2), one position past envelope order.
    expect(texts).toStrictEqual(['A', 'B', 'S', 'C']);
    expect(chrons).toStrictEqual([1, 2, 4, 3]);
    // The inserted row carries its OWN envelope, not its anchor's.
    expect(resolved.rows[2]?.seq).toBe(insert.seq);
    expect(resolved.rows[2]?.rowIndex).toBe(0);
    expect(resolved.rows[0]?.seq).toBe(a.seq);
    expect(resolved.rows[3]?.seq).toBe(c.seq);
    expect(resolved.resolvedRowCount).toBe(4);
  });
  it('keeps fold order over envelope order when a synthetic_insert anchors earlier than its append position', async () => {
    const builder = new MutationJournalBuilder(dirs.journalPath);
    await builder.start();
    await builder.content('human', 'A');
    await builder.content('ai', 'B');
    await builder.content('ai', 'C');
    // validateAndFix can splice anywhere: S appended last (envelope 5) but
    // anchored after A (chron 1), so live order is [A, S, B, C].
    await builder.syntheticInsert(marked('tool', 'S', 4), 4, 1);

    const resolved = await collectResolverRows(dirs.journalPath);
    const texts = resolved.rows.map((row) => row.text);
    const chrons = resolved.rows.map((row) => row.chron);

    expect(texts).toStrictEqual(['A', 'S', 'B', 'C']);
    expect(chrons).toStrictEqual([1, 4, 2, 3]);
    expect(resolved.rows[1]?.seq).toBe(5);
  });
  it('resolves compression_detail consistently with existing compressed semantics', async () => {
    const builder = new MutationJournalBuilder(dirs.journalPath);
    await builder.start();
    await builder.content('human', 'A');
    await builder.content('ai', 'B');
    await builder.content('ai', 'C');
    await builder.compressionDetail(1, 3, 3);
    const comp = await builder.compressed(summaryFor('rolled up'), 3);

    const resolved = await collectResolverRows(dirs.journalPath);
    const engine = await replaySession(dirs.journalPath, PROJECT_HASH);

    // The detail record pins membership; the rows still resolve exactly as a
    // bare `compressed` event resolves (whole-history replacement).
    expect(resolved.rows.map((row) => row.text)).toStrictEqual(['rolled up']);
    expect(resolved.rows[0]?.seq).toBe(comp.seq);
    requireReplaySuccess(engine);
    expect(engine.history.map(textOf)).toStrictEqual(['rolled up']);
  });
});

describe('Durable mutations @plan:PLAN-20260917-ISSUE854.P05 @requirement:G2 / read-side and recorder cases 5', () => {
  const dirs = useDurableDirs();
  it('skips and counts a malformed compression_detail record without corrupting rows', async () => {
    const builder = new MutationJournalBuilder(dirs.journalPath);
    await builder.start();
    await builder.content('human', 'A');
    await builder.compressionDetail(1, 3, 3);
    // Missing toSeq: malformed under the pinned payload shape.
    await builder.rawEvent(COMPRESSION_DETAIL_KIND, {
      fromSeq: 1,
      itemsCompressed: 2,
    });
    await builder.compressed(summaryFor('kept'), 3);

    const resolved = await collectResolverRows(dirs.journalPath);

    expect(resolved.rows.map((row) => row.text)).toStrictEqual(['kept']);
    expect(resolved.skippedRecordCount).toBe(1);
  });
  it('replays a legacy density-diverged journal with the documented divergence (no new behavior)', async () => {
    const builder = new MutationJournalBuilder(dirs.journalPath);
    await builder.start();
    await builder.content('human', 'A');
    await builder.content('ai', 'B');
    await builder.content('ai', 'C');
    // No density event: a legacy file. Live density removed B, the journal
    // never learned, so replay keeps B — the documented divergence.

    const resolved = await collectResolverRows(dirs.journalPath);
    const engine = await replaySession(dirs.journalPath, PROJECT_HASH);

    const baseRows: ProjectedRow[] = [
      { chron: 1, text: 'A' },
      { chron: 2, text: 'B' },
      { chron: 3, text: 'C' },
    ];
    // The live-model projection of the same mutation (density removed B).
    const liveDensity = projectDensityMutation(baseRows, [2], []);
    expect(resolved.rows).toHaveLength(3);
    expectProjectedRowsEqual(toProjected(resolved), baseRows);
    expect(toProjected(resolved)).not.toStrictEqual(liveDensity);
    requireReplaySuccess(engine);
    expectProjectedRowsEqual(projectedFromContents(engine.history), baseRows);
  });
  it('reproduces a pop exactly through the existing cutSeq rewind machinery', async () => {
    // Durable mapping pinned for pop()/removeLastIfMatches(): a rewind of one
    // item cut at the popped row's chronology marker. Existing kinds already
    // carry enough detail, so this holds today and must keep holding.
    const builder = new MutationJournalBuilder(dirs.journalPath);
    await builder.start();
    await builder.content('human', 'A');
    await builder.content('ai', 'B');
    await builder.content('ai', 'C');
    await builder.rewind(1, 3);

    const resolved = await collectResolverRows(dirs.journalPath);
    const engine = await replaySession(dirs.journalPath, PROJECT_HASH);

    const baseRows: ProjectedRow[] = [
      { chron: 1, text: 'A' },
      { chron: 2, text: 'B' },
      { chron: 3, text: 'C' },
    ];
    // Live projection after the pop: everything but the popped last row.
    const livePop = baseRows.slice(0, -1);
    expect(resolved.rows).toHaveLength(2);
    expectProjectedRowsEqual(toProjected(resolved), livePop);
    requireReplaySuccess(engine);
    expectProjectedRowsEqual(projectedFromContents(engine.history), livePop);
  });
});
