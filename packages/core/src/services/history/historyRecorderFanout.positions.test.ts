/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { journalBackendSelected } from '@vybestack/llxprt-code-test-utils/core/backend-test-gates.js';
import {
  FanoutHarness,
  rowText,
  textRow,
} from './__tests__/support/fanout-harness.js';

const harness = new FanoutHarness();

describe('per-origin positions in recorder mirrors', () => {
  beforeEach(() => harness.setup());
  afterEach(() => harness.teardown());

  it.skipIf(journalBackendSelected)(
    'a cut at another origin row removes only the cutting mirror rows at or after it',
    async () => {
      const { service, ownerA, ownerB, a, b } = await harness.twoOrigins();
      for (const [text, owner] of [
        ['A1', ownerA],
        ['B1', ownerB],
        ['A2', ownerA],
        ['B2', ownerB],
      ] as const)
        service.add(textRow(text), undefined, owner);
      await service.waitForCommit();
      expect(await harness.replayed(a)).toStrictEqual(['seed', 'A1', 'A2']);
      expect(await harness.replayed(b)).toStrictEqual(['seed', 'B1', 'B2']);

      const rows = await harness.shared(service);
      expect(rows.map(rowText)).toStrictEqual(['seed', 'A1', 'B1', 'A2', 'B2']);
      await service.replaceAll(rows.slice(0, 2), undefined, { origin: ownerA });
      await service.waitForCommit();

      expect((await harness.shared(service)).map(rowText)).toStrictEqual([
        'seed',
        'A1',
      ]);
      expect(await harness.replayed(a)).toStrictEqual(['seed', 'A1']);
      expect(await harness.replayed(b)).toStrictEqual(['seed']);
    },
  );
});
