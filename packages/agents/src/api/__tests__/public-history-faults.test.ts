/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  StreamOnlyHistory,
  withPublicHistory,
} from './helpers/public-history-fixture.js';

for (const size of [512, 8192]) {
  describe(`public history source failure with ${size} rows`, () => {
    it('propagates a source fault and releases the underlying pinned reader', async () => {
      await withPublicHistory(
        size,
        false,
        async (agent, history, reader, decoded) => {
          if (!(history instanceof StreamOnlyHistory))
            throw new Error('Missing fault source');
          history.failAfter = 1;
          let visited = 0;
          const consume = async (): Promise<void> => {
            for await (const _row of agent.streamHistory()) visited++;
          };
          await expect(consume()).rejects.toThrow('raw source fault');
          expect(visited).toBe(1);
          expect({
            decoded: decoded(),
            live: reader.snapshot().liveRows,
          }).toStrictEqual({ decoded: 1, live: 0 });
        },
      );
    }, 120_000);

    it('closes the entire iterator chain on a for-await early break', async () => {
      await withPublicHistory(
        size,
        false,
        async (agent, _history, reader, decoded) => {
          for await (const _row of agent.streamHistory()) break;
          expect({
            decoded: decoded(),
            live: reader.snapshot().liveRows,
          }).toStrictEqual({ decoded: 1, live: 0 });
        },
      );
    }, 120_000);
  });
}
