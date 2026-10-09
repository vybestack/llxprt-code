/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, it, expect } from 'bun:test';
import { readdirSync } from 'node:fs';
import type { HookSnapshotRows } from '@vybestack/llxprt-code-core/hooks/hookOutputSnapshot.js';
import { resolvePendingBoundarySnapshot } from '../boundary-recovery-snapshot.js';
import { diskFixture, row } from './boundary-snapshot-test-helpers.js';

function interrupted(
  source: HookSnapshotRows,
  abort: AbortController,
  active: { count: number },
): HookSnapshotRows {
  return {
    count: source.count,
    async *openReader(
      signal?: AbortSignal,
    ): AsyncGenerator<unknown, void, unknown> {
      const reader = source.openReader(signal);
      active.count++;
      try {
        for await (const content of reader) {
          abort.abort(new Error('boundary cancelled'));
          yield content;
        }
      } finally {
        await reader.return();
        active.count--;
      }
    },
  };
}

describe('boundary snapshot input failure cleanup', () => {
  for (const stage of ['before', 'rawPending', 'after']) {
    it(`closes every reader when cancelled while reading ${stage}`, async () => {
      const fixture = diskFixture({
        name: 'cancel stage',
        before: [row('h'), row('p')],
        after: [row('h'), row('new')],
        pending: [row('p')],
      });
      const scratch = readdirSync(fixture.root).sort();
      const abort = new AbortController();
      const active = { count: 0 };
      const sources: Record<string, HookSnapshotRows> = {
        before: fixture.before,
        rawPending: fixture.rawPending,
        after: fixture.after,
      };
      const source = sources[stage];
      try {
        await expect(
          resolvePendingBoundarySnapshot({
            ...fixture,
            [stage]: interrupted(source, abort, active),
            signal: abort.signal,
          }),
        ).rejects.toThrow('boundary cancelled');
        expect(active.count).toBe(0);
        expect(fixture.active()).toBe(0);
        expect(fixture.scratch()).toStrictEqual(scratch);
      } finally {
        fixture.close();
      }
    });
  }
});

describe('boundary snapshot malformed input cleanup', () => {
  it('closes every input reader and scratch on an advertised count mismatch', async () => {
    const fixture = diskFixture({
      name: 'count mismatch',
      before: [row('h'), row('p')],
      after: [row('h'), row('new')],
      pending: [row('p')],
    });
    const scratch = readdirSync(fixture.root).sort();
    try {
      await expect(
        resolvePendingBoundarySnapshot({
          ...fixture,
          rawPending: { ...fixture.rawPending, count: 2 },
        }),
      ).rejects.toThrow('Boundary source count mismatch');
      expect(fixture.active()).toBe(0);
      expect(fixture.scratch()).toStrictEqual(scratch);
    } finally {
      fixture.close();
    }
  });
  it('closes the hook reader when external replacement rows are malformed', async () => {
    const fixture = diskFixture({
      name: 'invalid row',
      before: [row('h')],
      after: [],
      pending: [],
    });
    const scratch = readdirSync(fixture.root).sort();
    let active = 0;
    const after = {
      count: 1,
      async *openReader(): AsyncGenerator<unknown, void, unknown> {
        active++;
        try {
          yield { speaker: 'human', blocks: null };
        } finally {
          active--;
        }
      },
    };
    try {
      await expect(
        resolvePendingBoundarySnapshot({ ...fixture, after }),
      ).rejects.toThrow('Invalid hook content row');
      expect(active).toBe(0);
      expect(fixture.active()).toBe(0);
      expect(fixture.scratch()).toStrictEqual(scratch);
    } finally {
      fixture.close();
    }
  });
});
