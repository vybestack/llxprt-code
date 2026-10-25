/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { IContent } from './IContent.js';
import type { TokenRowSource } from './history-token-tickets.js';
import { decodeStoredRow } from './journalRowCodec.js';

interface TokenRowHost {
  snapshot(): Promise<VersionSnapshot>;
  takeDraft(sequence: number | undefined): IContent | undefined;
  releaseDraft(sequence: number | undefined): void;
}

/** Appended rows share a version until a mutation can change their membership. */
export class JournalTokenRows {
  private current: TokenRowBatch | undefined;

  constructor(private readonly host: TokenRowHost) {}

  capture(index: number, sequence: number | undefined): TokenRowSource {
    let batch = this.current;
    if (batch === undefined) {
      const created: TokenRowBatch = new TokenRowBatch(this.host, () => {
        if (this.current === created) this.current = undefined;
      });
      this.current = created;
      batch = created;
    }
    return batch.capture(index, sequence);
  }

  seal(): void {
    void this.current?.seal();
  }
}

class TokenRowBatch {
  private readers = 0;
  private saved: Promise<VersionSnapshot> | undefined;
  private closing: Promise<void> | undefined;

  constructor(
    private readonly host: TokenRowHost,
    private readonly detached: () => void,
  ) {}

  capture(index: number, sequence: number | undefined): TokenRowSource {
    this.readers++;
    return new TokenRowRange(this, this.host, index, sequence);
  }

  release(): Promise<void> {
    this.readers--;
    if (this.readers === 0) {
      this.detached();
      const saved = this.saved;
      this.saved = undefined;
      this.closing ??= saved?.then((snapshot) => snapshot.close());
    }
    return this.closing ?? Promise.resolve();
  }

  seal(): Promise<VersionSnapshot> {
    if (this.saved === undefined) {
      this.detached();
      this.saved = this.host.snapshot();
    }
    return this.saved;
  }
}

class TokenRowRange implements TokenRowSource {
  private end: number;
  private closing: Promise<void> | undefined;
  constructor(
    private readonly batch: TokenRowBatch,
    private readonly host: TokenRowHost,
    private index: number,
    private sequence: number | undefined,
  ) {
    this.end = index + 1;
  }

  merge(source: TokenRowSource): boolean {
    if (!(source instanceof TokenRowRange)) return false;
    if (
      source.batch !== this.batch ||
      source.index !== this.end ||
      this.closing !== undefined
    )
      return false;
    const nextSequence =
      this.sequence === undefined
        ? undefined
        : this.sequence + this.end - this.index;
    if (source.sequence !== nextSequence) return false;
    this.end = source.end;
    source.closing = source.batch.release();
    return true;
  }

  hasNext(): boolean {
    return this.index < this.end;
  }

  async read(): Promise<IContent> {
    if (this.closing !== undefined)
      throw new Error('The token row source is closed');
    const snapshot = await this.batch.seal();
    const index = this.index++;
    const sequence = this.sequence;
    if (this.sequence !== undefined) this.sequence++;
    const content = this.host.takeDraft(sequence);
    if (content !== undefined) return content;
    return decodeStoredRow(
      await snapshot.readRow(await snapshot.entryAt(index)),
    );
  }

  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.host.releaseDraft(
      this.sequence === undefined
        ? undefined
        : this.sequence + this.end - this.index - 1,
    );
    this.closing = this.batch.release();
    return this.closing;
  }
}
