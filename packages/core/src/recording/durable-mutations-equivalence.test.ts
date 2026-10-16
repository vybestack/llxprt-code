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
/** @plan PLAN-20260917-ISSUE854.P05 @requirement G2 */
import { collectRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import { describe, expect, it } from 'bun:test';
import {
  makeContent,
  toolCallContent,
  startLiveSession,
  addLiveRows,
  makeDensityResult,
  projectLive,
  resolveLiveJournal,
  expectProjectedRowsEqual,
  toProjected,
  expectLiveSpansResolved,
  rowEnvelopeMap,
  chronOf,
  textOf,
  useDurableDirs,
} from './durable-mutations.test.helpers.js';

describe('Durable mutations @plan:PLAN-20260917-ISSUE854.P05 @requirement:G2', () => {
  const dirs = useDurableDirs();
  // -------------------------------------------------------------------------
  // EQUIVALENCE harness — the same mutation script applied to a real
  // HistoryService and to a journal through the durable ops. RED today at the
  // missing recorder methods.
  // -------------------------------------------------------------------------

  it('density removal: journal through recordDensityChange resolves to the live projection with matching membership spans', async () => {
    const session = startLiveSession(dirs.chatsDir);
    await addLiveRows(session, [
      makeContent('A', 'human'),
      makeContent('B', 'ai'),
      makeContent('C', 'ai'),
    ]);

    await session.history.applyDensityResult(makeDensityResult([1]));
    await collectRowsForAssertions(
      session.history.streamRawHistory(),
      async (contentsForAssertions) => {
        const live = projectLive(contentsForAssertions);
        expect(live).toStrictEqual([
          { chron: 1, text: 'A' },
          { chron: 3, text: 'C' },
        ]);

        const resolved = await resolveLiveJournal(session);
        expectProjectedRowsEqual(toProjected(resolved), live);
        await expectLiveSpansResolved(session, resolved);
      },
    );
  });
  it('density replacement: the journal reproduces the replacement row under the inherited marker', async () => {
    const session = startLiveSession(dirs.chatsDir);
    await addLiveRows(session, [
      makeContent('A', 'human'),
      makeContent('B', 'ai'),
      makeContent('C', 'ai'),
    ]);

    await session.history.applyDensityResult(
      makeDensityResult([], new Map([[1, makeContent('B-dense', 'ai')]])),
    );
    await collectRowsForAssertions(
      session.history.streamRawHistory(),
      async (contentsForAssertions) => {
        const live = projectLive(contentsForAssertions);
        expect(live).toStrictEqual([
          { chron: 1, text: 'A' },
          { chron: 2, text: 'B-dense' },
          { chron: 3, text: 'C' },
        ]);

        const resolved = await resolveLiveJournal(session);
        expectProjectedRowsEqual(toProjected(resolved), live);
        await expectLiveSpansResolved(session, resolved);
      },
    );
  });
});

describe('Durable mutations @plan:PLAN-20260917-ISSUE854.P05 @requirement:G2 / live equivalence cases 2', () => {
  const dirs = useDurableDirs();
  it('synthetic insert: journal through recordSyntheticInsert resolves to the live validateAndFix projection', async () => {
    const session = startLiveSession(dirs.chatsDir);
    await addLiveRows(session, [
      makeContent('Q1', 'human'),
      toolCallContent('call-7', 'working'),
    ]);

    session.history.validateAndFix();
    await collectRowsForAssertions(
      session.history.streamRawHistory(),
      async (contentsForAssertions) => {
        const live = projectLive(contentsForAssertions);
        expect(live).toHaveLength(3);
        await collectRowsForAssertions(
          session.history.streamRawHistory(),
          async (contentsForAssertions) => {
            const synthetic = contentsForAssertions[2];

            const resolved = await resolveLiveJournal(session);
            expectProjectedRowsEqual(toProjected(resolved), live);

            // The inserted row is attributed to its own envelope, not the anchor's.
            const envelopeByChron = await rowEnvelopeMap(
              session.recording.getFilePath() as string,
            );
            const insertedEnvelope = resolved.rows[2]?.seq;
            expect(envelopeByChron.get(chronOf(synthetic))).toBe(
              insertedEnvelope,
            );
            expect(insertedEnvelope).not.toBe(envelopeByChron.get(2));
          },
        );
      },
    );
  });
  it('combined script: density removal, synthetic insert, and prefix rewind resolve to the live projection', async () => {
    const session = startLiveSession(dirs.chatsDir);
    await addLiveRows(session, [
      makeContent('A', 'human'),
      toolCallContent('call-9', 'B'),
      makeContent('C', 'ai'),
      makeContent('D', 'human'),
    ]);

    await session.history.applyDensityResult(makeDensityResult([2]));
    session.history.validateAndFix();
    await collectRowsForAssertions(
      session.history.streamRawHistory(),
      async (contentsForAssertions) => {
        const afterInsert = contentsForAssertions;
        const synthetic = afterInsert[2];
        expect(textOf(synthetic)).not.toBe('C');

        // Live prefix rewind (durable op: the existing cutSeq rewind).
        const remaining = [...afterInsert.slice(0, -1)];
        await session.history.replaceAll(remaining);
        await collectRowsForAssertions(
          session.history.streamRawHistory(),
          async (contentsForAssertions) => {
            const live = projectLive(contentsForAssertions);
            expect(live.map((row) => row.text)).toStrictEqual([
              'A',
              'B',
              textOf(synthetic),
            ]);

            const resolved = await resolveLiveJournal(session);
            expect(resolved.rows.map((row) => row.text)).toStrictEqual([
              'A',
              'B',
              textOf(synthetic),
            ]);
            expect(resolved.rows.map((row) => row.chron)).toStrictEqual(
              live.map((row) => row.chron),
            );
            await expectLiveSpansResolved(session, resolved);
          },
        );
      },
    );
  });
});
