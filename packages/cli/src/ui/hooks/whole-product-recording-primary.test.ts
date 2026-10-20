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
