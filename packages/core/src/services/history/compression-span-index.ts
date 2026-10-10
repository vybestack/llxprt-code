/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getScratchRoot } from '../../storage/scratch-root.js';

export class CompressionSpanIndex {
  private readonly directory: string;

  constructor(root = getScratchRoot()) {
    this.directory = mkdtempSync(join(root, 'compression-span-'));
  }

  private path(seq: number): string {
    return join(
      this.directory,
      createHash('sha256').update(String(seq)).digest('hex'),
    );
  }

  private contains(seq: number): boolean {
    try {
      readFileSync(this.path(seq), 'utf8');
      return true;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return false;
      throw error;
    }
  }

  preserve(seq: number): void {
    writeFileSync(this.path(seq), '', { mode: 0o600 });
  }

  destroy(seq: number): boolean {
    if (this.contains(seq)) return false;
    this.preserve(seq);
    return true;
  }

  close(): void {
    rmSync(this.directory, { recursive: true, force: true });
  }
}
