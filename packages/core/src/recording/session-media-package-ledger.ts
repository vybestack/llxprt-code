/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createReadStream } from 'node:fs';
import { open, rm, type FileHandle } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import type { IContent } from '../services/history/IContent.js';
import type {
  MediaAdmissionRelease,
  MediaAdmissionService,
} from '../storage/media-admission-service.js';

function mediaOnly(content: IContent): IContent {
  const turnId = content.metadata?.turnId;
  return {
    speaker: content.speaker,
    blocks: content.blocks.filter((block) => block.type === 'media'),
    ...(turnId === undefined ? {} : { metadata: { turnId } }),
  };
}

/**
 * Disk index of export reservations. Entries grow with recording rows, so
 * they are appended to a file and replayed one at a time on release.
 */
export class ReservationLedger {
  private handle: FileHandle | undefined;

  constructor(
    private readonly path: string,
    private readonly admission: MediaAdmissionService,
  ) {}

  async record(release: MediaAdmissionRelease): Promise<void> {
    const contents = release.contents
      .map(mediaOnly)
      .filter((content) => content.blocks.length > 0);
    if (contents.length === 0) return;
    this.handle ??= await open(this.path, 'wx', 0o600);
    await this.handle.write(`${JSON.stringify({ ...release, contents })}\n`);
  }

  /** Releases every recorded reservation and removes the ledger file. */
  async releaseAll(): Promise<void> {
    const handle = this.handle;
    if (handle === undefined) return;
    this.handle = undefined;
    const failures: unknown[] = [];
    try {
      await handle.close();
      const lines = createInterface({
        input: createReadStream(this.path, { encoding: 'utf8' }),
        crlfDelay: Infinity,
      });
      for await (const line of lines) {
        try {
          await this.admission.releaseAdmissions([
            JSON.parse(line) as MediaAdmissionRelease,
          ]);
        } catch (error) {
          failures.push(error);
        }
      }
    } catch (error) {
      failures.push(error);
    }
    try {
      await rm(this.path, { force: true });
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Export reservation release failed');
    }
  }
}
