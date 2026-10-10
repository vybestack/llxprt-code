/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { LocalMediaStore } from './local-media-store.js';

export class SessionMediaOwner {
  readonly store: LocalMediaStore;
  private readonly archive: LocalMediaStore;
  private disposal: Promise<void> | undefined;

  constructor(projectDirectory: string, quotaBytes: number) {
    this.archive = new LocalMediaStore({
      rootDirectory: join(projectDirectory, 'media'),
      quotaBytes,
    });
    this.store = new LocalMediaStore({
      rootDirectory: join(projectDirectory, 'media-live', randomUUID()),
      quotaBytes,
      recordingArchive: this.archive,
    });
  }

  dispose(): Promise<void> {
    this.disposal ??= this.close();
    return this.disposal;
  }

  private async close(): Promise<void> {
    const results = await Promise.allSettled([
      this.store.close(),
      this.archive.close(),
    ]);
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Session media cleanup failed');
    }
    await rm(this.store.rootDirectory, { recursive: true, force: true });
  }
}
