/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  existsSync,
  mkdtempSync,
  opendirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  isMediaReferenceBlock,
  type MediaReferenceBlock,
} from '../services/history/IContent.js';
import type { RowOwnership } from '../recording/rowOwnership.js';

export class HistoryMediaIndex {
  private directory: string | undefined;

  constructor(private readonly rootDirectory = tmpdir()) {}

  private path(contentId: string): string | undefined {
    return this.directory === undefined
      ? undefined
      : join(
          this.directory,
          createHash('sha256').update(contentId).digest('hex'),
        );
  }

  has(contentId: string): boolean {
    const path = this.path(contentId);
    return path !== undefined && existsSync(path);
  }

  set(reference: MediaReferenceBlock): void {
    this.directory ??= mkdtempSync(
      join(this.rootDirectory, 'history-media-index-'),
    );
    const path = this.path(reference.contentId);
    if (path === undefined) throw new Error('Media index was not initialized');
    writeFileSync(path, JSON.stringify(reference), { mode: 0o600 });
  }

  delete(contentId: string): void {
    const path = this.path(contentId);
    if (path !== undefined) rmSync(path, { force: true });
  }

  *values(ownership?: RowOwnership): Iterable<MediaReferenceBlock> {
    if (this.directory === undefined) return;
    const directory = opendirSync(this.directory);
    try {
      for (
        let entry = directory.readSync();
        entry !== null;
        entry = directory.readSync()
      ) {
        const reference: unknown = JSON.parse(
          readFileSync(join(this.directory, entry.name), 'utf8'),
        );
        if (!isMediaReferenceBlock(reference))
          throw new Error('Invalid private media index entry');
        ownership?.retain(reference);
        try {
          yield reference;
        } finally {
          ownership?.release(reference);
        }
      }
    } finally {
      directory.closeSync();
    }
  }

  close(): void {
    if (this.directory !== undefined)
      rmSync(this.directory, { recursive: true, force: true });
    this.directory = undefined;
  }
}
