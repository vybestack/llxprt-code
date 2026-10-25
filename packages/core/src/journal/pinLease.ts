/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RecordAccess } from './recordAccess.js';
import type { Version } from './version.js';
import { JournalFormatError } from './errors.js';

/**
 * The pin of one read (design 10.1): a compaction does not run while any hold
 * on it is live. The creator holds it first; `hold` adds another hold for a
 * reader that outlives the creator's (a mirror delivery reading a group after
 * the caller of the commit has moved on). The lease is free when every hold
 * has been released, and then calls `onFree`.
 */
export class PinLease {
  private holders = 1;
  /** Releases the creator's hold. A second call is a mistake and throws. */
  readonly close: () => void | Promise<void>;

  constructor(private readonly onFree: () => void | Promise<void>) {
    this.close = this.releaser();
  }

  hold(): () => void | Promise<void> {
    this.require();
    this.holders += 1;
    return this.releaser();
  }

  require(): void {
    if (this.holders === 0) {
      throw new JournalFormatError(
        'A journal read was used after its pin was released',
      );
    }
  }

  private releaser(): () => void | Promise<void> {
    let released = false;
    return () => {
      if (released) throw new Error('A journal pin was released twice');
      released = true;
      this.holders -= 1;
      if (this.holders === 0) return this.onFree();
      return undefined;
    };
  }
}

export function releaseRead(
  read: { close(): void | Promise<void> },
  failure?: { readonly error: unknown },
): void | Promise<void> {
  const rethrow = (cleanup: unknown): never => {
    if (failure !== undefined) {
      throw new AggregateError(
        [failure.error, cleanup],
        'Journal read and descriptor release failed',
      );
    }
    throw cleanup;
  };
  try {
    return read.close()?.catch(rethrow);
  } catch (cleanup) {
    return rethrow(cleanup);
  }
}

/** The reads of `raw`, each refused once the lease is free (a swap may have moved what they reach). */
function leased(raw: RecordAccess, lease: PinLease): RecordAccess {
  return {
    get rowWindowStats() {
      return raw.rowWindowStats;
    },
    recordError(head, error) {
      lease.require();
      return raw.recordError(head, error);
    },
    readRecordHead(offset, what, prefetchBytes, readAhead) {
      lease.require();
      return raw.readRecordHead(offset, what, prefetchBytes, readAhead);
    },
    readRecordStart(offset, what, prefetchBytes) {
      lease.require();
      return raw.readRecordStart(offset, what, prefetchBytes);
    },
    readRecordRange(head, offset, length) {
      lease.require();
      return raw.readRecordRange(head, offset, length);
    },
    async *readRecordBody(head, chunkBytes, what) {
      lease.require();
      for await (const chunk of raw.readRecordBody(head, chunkBytes, what)) {
        lease.require();
        yield chunk;
      }
    },
  };
}

/**
 * A published version and the reads that reach its records, pinned for as
 * long as the read is open. It is the only way to obtain a `RecordAccess` from
 * a store, so a read by offset cannot outlive the pin that keeps the offsets
 * valid. Close it when done; using it after that throws.
 */
export class PinnedRead {
  private readonly guarded: RecordAccess | undefined;

  /** `version` is undefined for a journal with no committed group. */
  constructor(
    readonly version: Version | undefined,
    raw: RecordAccess | undefined,
    private readonly lease: PinLease,
  ) {
    this.guarded = raw === undefined ? undefined : leased(raw, lease);
  }

  get access(): RecordAccess {
    if (this.guarded === undefined) {
      throw new JournalFormatError('The journal has no committed group');
    }
    return this.guarded;
  }

  /** Throws once the pin is released; for a reader that may answer from a cache without touching the file. */
  requireOpen(): void {
    this.lease.require();
  }

  /** Another hold on the pin, for a reader that outlives the one who opened this; the returned function releases it. */
  hold(): () => void | Promise<void> {
    return this.lease.hold();
  }

  close(): void | Promise<void> {
    return this.lease.close();
  }
}
