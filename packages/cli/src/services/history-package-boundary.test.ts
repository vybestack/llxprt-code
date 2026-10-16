/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createRowCounters } from '@vybestack/llxprt-code-core/recording/journalCounters.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { HistoryMediaOwnership } from '@vybestack/llxprt-code-core/storage/history-media-ownership.js';
import { SessionPersistenceService } from '@vybestack/llxprt-code-core/storage/SessionPersistenceService.js';

describe('history package boundary', () => {
  it('exports journal dependencies to package consumers without source aliases', () => {
    for (const subpath of [
      'recording/journalCounters',
      'recording/rowOwnership',
      'storage/history-media-ownership',
      'storage/SessionPersistenceService',
    ]) {
      const result = spawnSync(
        'node',
        [
          '--input-type=module',
          '-e',
          `console.log(import.meta.resolve('@vybestack/llxprt-code-core/${subpath}.js'))`,
        ],
        { cwd: new URL('../../../../', import.meta.url), encoding: 'utf8' },
      );
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`/dist/src/${subpath}.js`);
    }
  });

  it('loads journal ownership and counters through the workspace public API', () => {
    const ownership = new RowOwnership();
    const row = { text: 'owned' };
    ownership.retain(row);
    expect(ownership.snapshot().liveRows).toBe(1);
    ownership.release(row);
    expect(ownership.snapshot().liveRows).toBe(0);
    const { counters, snapshot } = createRowCounters();
    counters.rowDecoded();
    counters.rowReleased();
    expect(snapshot().peakDecodedRows).toBe(1);
    expect(HistoryMediaOwnership).toBeFunction();
    expect(SessionPersistenceService).toBeFunction();
  });
});
