/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaAdmissionService } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import { admitSessionHistory } from './sessionHistoryAdmission.js';
import {
  FailOnceReleaseStore,
  inlineMediaHistory,
} from './__tests__/support/client-media-history-fixtures.js';

describe('session history admission', () => {
  it('retries scoped media cleanup without releasing a sibling admission', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'scoped-history-admission-'),
    );
    const store = new FailOnceReleaseStore({
      rootDirectory: directory,
      quotaBytes: 1024 * 1024,
    });
    const admission = new MediaAdmissionService(store);
    const first = admitSessionHistory(
      [...inlineMediaHistory(), ...inlineMediaHistory()],
      admission,
      'same-label',
    );
    const second = admitSessionHistory(
      inlineMediaHistory(),
      admission,
      'same-label',
    );
    try {
      let contentId: string | undefined;
      for await (const row of first.rows) {
        const block = row.blocks[0];
        if (block.type === 'media' && block.encoding === 'reference')
          contentId = block.contentId;
      }
      for await (const row of second.rows) void row;
      if (contentId === undefined)
        throw new Error('Missing admitted reference');
      await expect(first.release()).rejects.toThrow(
        'induced history release failure',
      );
      await first.release();
      expect(await store.hasReservations(contentId)).toBe(true);
      await second.release();
      expect(await store.hasReservations(contentId)).toBe(false);
    } finally {
      await first.release();
      await second.release();
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
