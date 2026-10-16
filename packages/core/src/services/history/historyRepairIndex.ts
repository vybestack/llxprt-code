/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createScratchDirSync } from '../../storage/scratch-root.js';

/** Membership and insertion anchors stay on disk, including duplicate call IDs. */
export class HistoryRepairIndex {
  private readonly directory = createScratchDirSync('history-repair-index-');

  private path(kind: string, id: string): string {
    return join(
      this.directory,
      kind + createHash('sha256').update(id).digest('hex'),
    );
  }

  add(kind: string, id: string): boolean {
    try {
      writeFileSync(this.path(kind, id), '', { flag: 'wx', mode: 0o600 });
      return true;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST')
        return false;
      throw error;
    }
  }

  has(id: string): boolean {
    try {
      readFileSync(this.path('response-', id));
      return true;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return false;
      throw error;
    }
  }

  writeAnchor(index: number, seq: number): void {
    const bytes = Buffer.alloc(8);
    bytes.writeDoubleLE(seq);
    writeFileSync(join(this.directory, `anchor-${index}`), bytes, {
      mode: 0o600,
    });
  }

  readAnchor(index: number): number {
    return readFileSync(join(this.directory, `anchor-${index}`)).readDoubleLE();
  }

  close(): void {
    rmSync(this.directory, { recursive: true, force: true });
  }
}
