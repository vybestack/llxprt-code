/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, it, expect } from 'bun:test';
import { readdirSync } from 'node:fs';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { resolvePendingBoundarySnapshot } from '../boundary-recovery-snapshot.js';
import { diskFixture, row } from './boundary-snapshot-test-helpers.js';
describe('boundary snapshot lifecycle', () => {
  it('closes sources on cancellation and closes borrowed readers on return or owner close', async () => {
    const fixture = diskFixture({
      name: 'lifecycle',
      before: [row('h'), row('p')],
      after: [row('h'), row('edited')],
      pending: [row('p')],
    });
    const scratch = readdirSync(fixture.root).sort();
    try {
      const controller = new AbortController();
      const before = {
        count: fixture.before.count,
        async *openReader(
          signal?: AbortSignal,
        ): AsyncGenerator<IContent, void, unknown> {
          const reader = fixture.before.openReader(signal);
          try {
            for await (const content of reader) {
              controller.abort(new Error('cancel boundary'));
              yield content;
            }
          } finally {
            await reader.return();
          }
        },
      };
      await expect(
        resolvePendingBoundarySnapshot({
          ...fixture,
          before,
          signal: controller.signal,
        }),
      ).rejects.toThrow('cancel boundary');
      expect(fixture.active()).toBe(0);
      expect(fixture.scratch()).toStrictEqual(scratch);
      const result = await resolvePendingBoundarySnapshot(fixture);
      const reader = result.contents.openReader();
      const pendingReader = result.pendingSelection?.openReader();
      expect((await reader.next()).done).toBe(false);
      await reader.return();
      expect((await reader.next()).done).toBe(true);
      const abort = new AbortController();
      const cancelled = result.contents.openReader(abort.signal);
      expect((await cancelled.next()).done).toBe(false);
      abort.abort(new Error('cancel reader'));
      await expect(cancelled.next()).rejects.toThrow('cancel reader');
      result.close();
      await expect(pendingReader?.next()).rejects.toThrow(
        'Boundary snapshot closed',
      );
      expect(fixture.scratch()).toStrictEqual(scratch);
    } finally {
      fixture.close();
    }
  });
});
