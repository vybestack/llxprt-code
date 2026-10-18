/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { journalBackendSelected } from '@vybestack/llxprt-code-test-utils/core/backend-test-gates.js';
import {
  FanoutHarness,
  rowText,
  textRow,
} from './__tests__/support/fanout-harness.js';

const harness = new FanoutHarness();

describe('every row written to the shared journal carries its origin', () => {
  beforeEach(() => harness.setup());
  afterEach(() => harness.teardown());

  it.skipIf(journalBackendSelected)(
    'keeps rows owned when the sole origin re-attaches to a new recorder',
    async () => {
      const service = harness.history();
      const ownerA = {};
      const ownerB = {};
      await service.attachJournal(
        harness.recorder('a1'),
        true,
        undefined,
        ownerA,
      );
      service.add(textRow('A1'), undefined, ownerA);
      await service.waitForCommit();
      const a2 = harness.recorder('a2');
      await service.attachJournal(a2, true, undefined, ownerA);
      const b = harness.recorder('b');
      await service.attachJournal(b, true, undefined, ownerB);
      service.add(textRow('B1'), undefined, ownerB);
      await service.waitForCommit();
      expect(await harness.replayed(a2)).toStrictEqual(['A1']);
      expect(await harness.replayed(b)).toStrictEqual(['B1']);
    },
  );

  it.skipIf(journalBackendSelected)(
    'keeps rows owned when a failed transform is compensated',
    async () => {
      const service = harness.history();
      const ownerA = {};
      const ownerB = {};
      const a = harness.recorder('a');
      await service.attachJournal(a, true, undefined, ownerA);
      service.add(textRow('A1'), undefined, ownerA);
      service.add(textRow('A2'), undefined, ownerA);
      await service.waitForCommit();
      await expect(
        service.detachedValues.transform(
          async (source, sink) => {
            for await (const row of source.streamRows())
              await sink.appendValue(textRow(`changed-${rowText(row)}`));
          },
          undefined,
          {
            origin: ownerA,
            afterPublication: () => {
              throw new Error('reject');
            },
          },
        ),
      ).rejects.toThrow('reject');
      const b = harness.recorder('b');
      await service.attachJournal(b, true, undefined, ownerB);
      await service.waitForCommit();
      expect((await harness.shared(service)).map(rowText)).toStrictEqual([
        'A1',
        'A2',
      ]);
      expect(await harness.replayed(a)).toStrictEqual(['A1', 'A2']);
      expect(await harness.replayed(b)).toStrictEqual([]);
    },
  );
});
