/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export class MediaMetricByteIndex {
  private directory: string | undefined;

  add(contentId: string, byteLength: number): number {
    this.directory ??= mkdtempSync(
      join(tmpdir(), 'llxprt-media-metric-index-'),
    );
    const path = join(
      this.directory,
      createHash('sha256').update(contentId).digest('hex'),
    );
    if (existsSync(path)) {
      const retained = Number(readFileSync(path, 'utf8'));
      if (retained !== byteLength) {
        throw new Error(
          `Media reference ${contentId} has inconsistent byte lengths`,
        );
      }
      return 0;
    }
    writeFileSync(path, String(byteLength), { mode: 0o600, flag: 'wx' });
    return byteLength;
  }

  close(): void {
    if (this.directory !== undefined)
      rmSync(this.directory, { recursive: true, force: true });
    this.directory = undefined;
  }
}
