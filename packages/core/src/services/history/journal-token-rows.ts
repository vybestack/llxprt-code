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
    let closing: Promise<void> | undefined;
    return {
      read: async () => {
        if (closing !== undefined)
          throw new Error('The token row source is closed');
        const snapshot = await this.seal();
        const content = this.host.takeDraft(sequence);
        if (content !== undefined) return content;
        return decodeStoredRow(
          await snapshot.readRow(await snapshot.entryAt(index)),
        );
      },
      close: () => {
        if (closing !== undefined) return closing;
        this.host.releaseDraft(sequence);
        this.readers--;
        if (this.readers === 0) {
          this.detached();
          const saved = this.saved;
          this.saved = undefined;
          this.closing ??= saved?.then((snapshot) => snapshot.close());
        }
        closing = this.closing ?? Promise.resolve();
        return closing;
      },
    };
  }

  seal(): Promise<VersionSnapshot> {
    if (this.saved === undefined) {
      this.detached();
      this.saved = this.host.snapshot();
    }
    return this.saved;
  }
}
