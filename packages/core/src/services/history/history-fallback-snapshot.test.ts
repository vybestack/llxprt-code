/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { journalBackendSelected } from '@vybestack/llxprt-code-test-utils/core/backend-test-gates.js';
import { readdirSync } from 'node:fs';
import {
  withRollbackFixture,
  rollbackRow,
} from './chronology-rollback-test-helpers.js';
import { getScratchRoot } from '../../storage/scratch-root.js';

function scratch(): string[] {
  return readdirSync(getScratchRoot())
    .filter(
      (name) =>
        name.startsWith('history-mutation-') ||
        name.startsWith('history-density-'),
    )
    .sort();
}

describe('scoped raw fallback snapshot', () => {
  it.skipIf(journalBackendSelected)(
    'closes scratch after consumer throw and pre-abort',
    async () => {
      await withRollbackFixture(async (history) => {
        history.add(rollbackRow(0));
        const before = scratch();
        await expect(
          history.withSnapshot(async () => {
            throw new Error('consumer failed');
          }),
        ).rejects.toThrow('consumer failed');
        const abort = new AbortController();
        abort.abort(new Error('cancelled snapshot'));
        await expect(
          history.withSnapshot(async () => {
            throw new Error('must not run');
          }, abort.signal),
        ).rejects.toThrow('cancelled snapshot');
        expect(
          scratch().filter((name) => !before.includes(name)),
        ).toStrictEqual([]);
      });
    },
  );
});
