/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { LocalMediaStore } from '../../storage/local-media-store.js';
import { DetachedMediaOwner } from './__tests__/support/detached-media-fixture.js';
import { exactTokenizer } from './chronology-rollback-test-helpers.js';
import { persistedMutationRows } from './__tests__/support/service-recorder-mutations.js';
import {
  atomicRig,
  atomicRow,
  diskVersion,
  fileOf,
  liveRows,
  reopenedRows,
  persistedEntries,
} from './__tests__/support/service-atomicity.js';

const stages = [
  'producer',
  'tokenizer',
  'prepare',
  'publish',
  'contentBatchAdded',
  'tokensUpdated',
  'onAcknowledged',
  'afterPublication',
  'finalize',
  'contextRangeChanged',
] as const;

describe('HistoryService replacement compensation with real primary and mirror', () => {
  for (const stage of stages) {
    it(`restores rows, owners, chronology, tokens and media after ${stage} rejection and reopens both files`, async () => {
      const rig = await atomicRig(`compensate-${stage}`);
      const { history, primary, mirror } = rig;
      const media = new LocalMediaStore({
        rootDirectory: join(rig.directory, 'media'),
        quotaBytes: 4096,
      });
      const owner = new DetachedMediaOwner(media);
      try {
        const previousMedia = await media.admit({
          bytes: new Uint8Array([1]),
          mimeType: 'image/png',
          semanticMetadata: {},
        });
        const candidateMedia = await media.admit({
          bytes: new Uint8Array([2]),
          mimeType: 'image/png',
          semanticMetadata: {},
        });
        history.setTokenizerFactory(exactTokenizer());
        await history.registerMediaOwner(owner);
        await history.addBatch(
          [
            {
              ...atomicRow('A'),
              blocks: [...atomicRow('A').blocks, previousMedia],
            },
          ],
          undefined,
          { origin: rig.origin },
        );
        await history.addBatch([atomicRow('B')]);
        await rig.flush();
        const previous = await persistedMutationRows(primary.recording);
        const before = {
          tokens: history.getTotalTokens(),
          range: history.getContextRange(),
          chronology: history.detachedValues.host().chronology.snapshot(),
          version: await diskVersion(fileOf(primary.recording)),
          mirrorVersion: await diskVersion(fileOf(mirror.recording)),
          primaryEntries: await persistedEntries(fileOf(primary.recording)),
          mirrorEntries: await persistedEntries(fileOf(mirror.recording)),
        };
        const failure = new Error(`rejected ${stage}`);
        const fail = (): never => {
          throw failure;
        };
        if (stage === 'tokenizer')
          history.setTokenizerFactory(exactTokenizer(fail));
        if (stage === 'prepare' || stage === 'publish' || stage === 'finalize')
          owner.stage = stage;
        if (
          stage === 'contentBatchAdded' ||
          stage === 'tokensUpdated' ||
          stage === 'contextRangeChanged'
        )
          history.once(stage, fail);
        await expect(
          history.detachedValues.transform(
            async (_source, sink) => {
              await sink.appendValue({
                ...atomicRow('C'),
                blocks: [...atomicRow('C').blocks, candidateMedia],
              });
              if (stage === 'producer') fail();
            },
            undefined,
            {
              publishBatch: true,
              onAcknowledged: () => {
                if (stage === 'onAcknowledged') fail();
              },
              afterPublication: () => {
                if (stage === 'afterPublication') fail();
              },
            },
          ),
        ).rejects.toBe(
          ['prepare', 'publish', 'finalize'].includes(stage)
            ? owner.failure
            : failure,
        );
        owner.stage = undefined;
        history.setTokenizerFactory(exactTokenizer());
        await rig.flush();
        expect(await liveRows(history)).toStrictEqual(
          previous.map(({ content }) => content),
        );
        expect(
          isDeepStrictEqual(
            await persistedMutationRows(primary.recording),
            previous,
          ),
        ).toBe(true);
        expect(await persistedMutationRows(mirror.recording)).toStrictEqual(
          previous,
        );
        expect(await persistedEntries(fileOf(primary.recording))).toStrictEqual(
          before.primaryEntries,
        );
        const mirrorEntries = await persistedEntries(fileOf(mirror.recording));
        const afterAck = [
          'contentBatchAdded',
          'tokensUpdated',
          'onAcknowledged',
          'afterPublication',
          'finalize',
          'contextRangeChanged',
        ].includes(stage);
        // Settled mirror checkpoints restore their original row records.
        expect(mirrorEntries).toStrictEqual(before.mirrorEntries);
        expect(
          (await diskVersion(fileOf(mirror.recording))) > before.mirrorVersion,
        ).toBe(afterAck);
        expect(before.tokens).toBeGreaterThan(0);
        expect(history.getTotalTokens() - before.tokens).toBe(0);
        expect(history.getContextRange()).toStrictEqual(before.range);
        expect(
          history.detachedValues.host().chronology.snapshot(),
        ).toStrictEqual(before.chronology);
        expect(await media.hasReservations(previousMedia.contentId)).toBe(true);
        expect(await media.hasReservations(candidateMedia.contentId)).toBe(
          false,
        );
        const releasedCandidate = stage !== 'tokenizer' && stage !== 'prepare';
        const session = await primary.recording.session();
        for (const key of ['rel:head', 'rel:tail'])
          expect(await session.store.getState(key)).toStrictEqual(
            releasedCandidate ? Buffer.from('1') : undefined,
          );
        expect(await diskVersion(fileOf(primary.recording))).toBe(
          before.version + (afterAck ? 2 : 0) + (releasedCandidate ? 2 : 0),
        );
        await history.addBatch([atomicRow('D')]);
        await rig.flush();
        const continued = await persistedMutationRows(primary.recording);
        expect(continued.slice(0, previous.length)).toStrictEqual(previous);
        expect(
          continued[continued.length - 1]?.content.metadata?.chronology?.seq,
        ).toBe(3);
        expect(await persistedMutationRows(mirror.recording)).toStrictEqual(
          continued,
        );
        await rig.close();
        expect(await reopenedRows(primary, media)).toStrictEqual(continued);
        expect(await reopenedRows(mirror, media)).toStrictEqual(continued);
        expect(await media.hasReservations(previousMedia.contentId)).toBe(
          false,
        );
      } finally {
        await rig.close();
        await owner.releaseAll();
        await media.close();
      }
    });
  }
});
