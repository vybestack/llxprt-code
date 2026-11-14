/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withPublicHistory } from './helpers/public-history-fixture.js';

const cases = [
  [512, false],
  [512, true],
  [8192, false],
  [8192, true],
] as const;

describe('AgentImpl public history reader', () => {
  it.each(cases)(
    'offers only a scoped public reader at %i, active=%s',
    async (size, active) => {
      await withPublicHistory(
        size,
        active,
        async (agent, _history, reader, decoded) => {
          expect('getHistory' in agent).toBe(false);
          const cursor = agent.streamHistory();
          expect(decoded()).toBe(0);
          try {
            const first = await cursor.next();
            if (first.done === true) throw new Error('Missing public history');
            expect(first.value.metadata?.chronology?.seq).toBe(1);
            expect(decoded()).toBe(1);
            expect(reader.snapshot().liveRows).toBe(1);
          } finally {
            await cursor.return();
          }
          expect(reader.snapshot().liveRows).toBe(0);
        },
      );
    },
    180000,
  );
});
