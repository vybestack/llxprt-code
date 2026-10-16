/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  isContent,
  pinReadableFile,
  resolveRowContent,
  type PinnedFile,
} from '../../recording/durableRowFold.js';
import type { NumericRow } from '../../recording/mutableRowDirectory.js';
import { ResolverRowReader } from '../../recording/resolverScan.js';
import type { IContent } from './IContent.js';

const CHUNK_BYTES = 64 * 1024;

/**
 * Reads single rows of a journal back by the byte range the shared row index
 * recorded. The file is pinned on the first read and released by `close()`.
 */
export class JournalRowReader {
  private pinned: PinnedFile | undefined;
  private reader: ResolverRowReader | undefined;

  constructor(private readonly filePath: string) {}

  async read(row: NumericRow): Promise<IContent> {
    if (row.source !== 'durable')
      throw new Error(`Shared row index holds a ${row.source} row`);
    this.pinned ??= pinReadableFile(this.filePath);
    this.reader ??= new ResolverRowReader(
      this.pinned.handle,
      CHUNK_BYTES,
      this.pinned.size,
    );
    const content = await this.reader.read(row.offset, row.bytes);
    if (!isContent(content))
      throw new Error('History journal row changed since it was indexed');
    return resolveRowContent(content, row);
  }

  close(): void {
    this.pinned?.release();
    this.pinned = undefined;
    this.reader = undefined;
  }
}
