/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  ioDifference,
  observeWholeProductIo,
} from '../../__tests__/support/whole-product-io.js';
import {
  wholeProductFixture,
  send,
} from '../../__tests__/support/whole-product-fixture.js';

describe('foreground recording-primary topology', () => {
  for (const transition of ['stop', 'reload'] as const) {
    it(`keeps a public history reader alive across recording ${transition}`, async () => {
      const fixture = await wholeProductFixture();
      const reader = fixture.live.streamHistory();
      try {
        await fixture.live.session.setRecording({ enabled: true });
        await send(
          fixture.live,
          'Read this turn across the recording transition.',
        );
        await fixture.live.session.flushRecording();
        const before = await fixture.live.session.getHistory();
        expect(before.length).toBeGreaterThan(1);
        expect((await reader.next()).value).toMatchObject({
          blocks: before[0].blocks,
        });
        await fixture.live.session.setRecording({ enabled: false });
        if (transition === 'reload') {
          await fixture.live.session.resume(
            fixture.live.session.getSessionId(),
          );
        }
        const remaining = [];
        for await (const row of reader) remaining.push(row.blocks);
        expect(remaining).toStrictEqual(
          before.slice(1).map((row) => row.blocks),
        );
        expect(
          (await fixture.live.session.getHistory()).map((row) => row.blocks),
        ).toStrictEqual(before.map((row) => row.blocks));
      } finally {
        await reader.return();
        await fixture.close();
      }
    });
  }

  it('persists each public Agent row group in one file rather than a primary and a mirror', async () => {
    const io = await observeWholeProductIo();
    const fixture = await wholeProductFixture();
    try {
      await fixture.live.session.setRecording({ enabled: true });
      const before = io.snapshot();
      await send(
        fixture.live,
        'A foreground turn with one durable history copy.',
      );
      await fixture.live.session.flushRecording();
      const delta = ioDifference(io.snapshot(), before);
      await Bun.write(
        `${fixture.root}/topology-io.json`,
        JSON.stringify(
          {
            before,
            after: io.snapshot(),
            delta,
            session: fixture.live.session.getRecording(),
          },
          null,
          2,
        ),
      );
      expect(delta.mirror.rowBytes).toBeGreaterThan(0);
      expect(delta.primary.rowBytes).toBe(0);
      expect(delta.mirror.groups).toBeGreaterThan(0);
    } finally {
      await fixture.close();
      io.restore();
    }
  });
});
