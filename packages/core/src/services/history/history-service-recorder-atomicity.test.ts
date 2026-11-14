/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { TRAILER_RECORD_BYTES } from '../../journal/trailerRecord.js';
import { RECORD_KIND } from '../../journal/recordKinds.js';
import { JournalWriterPoisonedError } from '../../journal/errors.js';
import { persistedMutationRows } from './__tests__/support/service-recorder-mutations.js';
import {
  atomicRig,
  atomicRow,
  diskVersion,
  fileOf,
  liveRows,
  reopenedRows,
  writes,
} from './__tests__/support/service-atomicity.js';

describe('HistoryService replacement acknowledgement and failed writer isolation', () => {
  it('keeps the published version and completion flag unchanged until the real replacement trailer is acknowledged', async () => {
    const rig = await atomicRig('held-trailer');
    const { history, primary } = rig;
    try {
      await history.addBatch([atomicRow('A'), atomicRow('B')]);
      await rig.flush();
      const previous = await persistedMutationRows(primary.recording);
      const session = await primary.recording.session();
      const version = session.store.published;
      const beforeTokens = history.getTotalTokens();
      const beforeRange = history.getContextRange();
      const trailers = primary.seams.events.filter(
        (event) => event.type === 'write' && event.kind === RECORD_KIND.TRAILER,
      ).length;
      primary.failures.gateTrailerAt = trailers;
      let completed = false;
      let acknowledged = false;
      const replacement = history.detachedValues
        .replace([atomicRow('C')], undefined, {
          onAcknowledged: () => {
            acknowledged = true;
          },
        })
        .then(() => {
          completed = true;
        });
      try {
        while (
          primary.seams.events.filter(
            (event) =>
              event.type === 'write' && event.kind === RECORD_KIND.TRAILER,
          ).length <= trailers
        )
          await new Promise<void>((resolve) => setImmediate(resolve));
        const written = primary.seams.events.filter(
          (event) => event.type === 'write',
        );
        const held = written[written.length - 1];
        expect(held).toMatchObject({ length: TRAILER_RECORD_BYTES });
        expect(Object.is(session.store.published, version)).toBe(true);
        expect(
          isDeepStrictEqual(
            await persistedMutationRows(primary.recording),
            previous,
          ),
        ).toBe(true);
        expect(await persistedMutationRows(rig.mirror.recording)).toStrictEqual(
          previous,
        );
        expect(history.getTotalTokens() - beforeTokens).toBe(0);
        expect(isDeepStrictEqual(history.getContextRange(), beforeRange)).toBe(
          true,
        );
        expect([completed, acknowledged]).toStrictEqual([false, false]);
      } finally {
        primary.seams.release();
      }
      await replacement;
      await rig.flush();
      expect([completed, acknowledged]).toStrictEqual([true, true]);
      expect(
        (await liveRows(history)).map(({ blocks }) => blocks),
      ).toStrictEqual([atomicRow('C').blocks]);
      expect(await persistedMutationRows(primary.recording)).toStrictEqual(
        await persistedMutationRows(rig.mirror.recording),
      );
    } finally {
      await rig.close();
    }
  });

  it('does not finish public service disposal before an admitted replacement trailer acknowledges', async () => {
    const rig = await atomicRig('held-close');
    try {
      await rig.history.addBatch([atomicRow('A')]);
      await rig.flush();
      const session = await rig.primary.recording.session();
      const previous = session.store.published;
      rig.primary.failures.gateWriteAt = writes(rig.primary) + 1;
      const replacement = rig.history.replaceAll([atomicRow('C')]);
      let closed = false;
      const closing = rig.history.dispose().then(() => {
        closed = true;
      });
      try {
        while (writes(rig.primary) <= (rig.primary.failures.gateWriteAt ?? 0))
          await new Promise<void>((resolve) => setImmediate(resolve));
        expect(closed).toBe(false);
        expect(Object.is(session.store.published, previous)).toBe(true);
      } finally {
        rig.primary.seams.release();
      }
      await replacement;
      await closing;
      expect(closed).toBe(true);
      await rig.integration.dispose();
      expect(
        (await persistedMutationRows(rig.primary.recording)).map(
          ({ content: { blocks } }) => blocks,
        ),
      ).toStrictEqual([atomicRow('C').blocks]);
      expect(await persistedMutationRows(rig.mirror.recording)).toStrictEqual(
        await persistedMutationRows(rig.primary.recording),
      );
    } finally {
      await rig.close();
    }
  });

  for (const stage of ['records', 'flush', 'trailer'] as const) {
    it(`rejects later replacements after ${stage} I/O failure without writing over the prior journal`, async () => {
      const rig = await atomicRig(`poison-${stage}`);
      const { history, primary } = rig;
      try {
        await history.addBatch([atomicRow('A'), atomicRow('B')]);
        await rig.flush();
        const previous = await persistedMutationRows(primary.recording);
        const version = await diskVersion(fileOf(primary.recording));
        const before = history.detachedValues.host().snapshot();
        if (stage === 'flush')
          primary.failures.failFlushAt = primary.seams.events.filter(
            (event) => event.type === 'flush',
          ).length;
        else
          primary.failures.failWriteAt =
            writes(primary) + (stage === 'trailer' ? 1 : 0);
        await expect(
          history.replaceAll([atomicRow('failed replacement')]),
        ).rejects.toThrow(
          `injected ${stage === 'flush' ? 'flush' : 'write'} failure`,
        );
        expect(
          isDeepStrictEqual(history.detachedValues.host().snapshot(), before),
        ).toBe(true);
        expect(await liveRows(history)).toStrictEqual(
          previous.map(({ content }) => content),
        );
        const torn = await readFile(fileOf(primary.recording));
        const writeCount = writes(primary);
        await expect(
          history.replaceAll([atomicRow('must not land')]),
        ).rejects.toBeInstanceOf(JournalWriterPoisonedError);
        expect(writes(primary) - writeCount).toBe(0);
        expect((await readFile(fileOf(primary.recording))).compare(torn)).toBe(
          0,
        );
        expect((await diskVersion(fileOf(primary.recording))) - version).toBe(
          0,
        );
        expect(
          isDeepStrictEqual(
            await persistedMutationRows(primary.recording),
            previous,
          ),
        ).toBe(true);
        expect(await persistedMutationRows(rig.mirror.recording)).toStrictEqual(
          previous,
        );
        await rig.close();
        expect(await reopenedRows(primary)).toStrictEqual(previous);
        expect(await reopenedRows(rig.mirror)).toStrictEqual(previous);
      } finally {
        await rig.close();
      }
    });
  }
});
