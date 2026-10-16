/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/** A record or header whose bytes do not describe a valid journal structure. */
export class JournalFormatError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'JournalFormatError';
  }
}

/**
 * How a frame failed to validate. `does-not-fit` and `frame-crc-mismatch` are
 * a torn or incomplete write, tolerated only at the tail of the file (design
 * 2.2). `body-crc-mismatch` is found while the body streams and is corruption
 * wherever it occurs.
 */
export type JournalFrameErrorCode =
  | 'does-not-fit'
  | 'frame-crc-mismatch'
  | 'body-crc-mismatch';

export class JournalFrameError extends Error {
  readonly code: JournalFrameErrorCode;
  readonly offset: number;

  constructor(code: JournalFrameErrorCode, offset: number, detail: string) {
    super(`Journal frame at offset ${offset}: ${detail}`);
    this.name = 'JournalFrameError';
    this.code = code;
    this.offset = offset;
  }
}

/** The single refusal for a JSONL journal, a wrong magic or a wrong version (design 2.1). */
export class RetiredJournalError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(message);
    this.name = 'RetiredJournalError';
    this.path = path;
  }
}

/**
 * A candidate record that is intact but is not the trailer the search was
 * looking for: another kind of record, or a trailer-shaped record that does
 * not sit at the offset it names (a quoted marker, design 3.1). The search
 * moves on to the next candidate.
 */
export class JournalTrailerCandidateError extends JournalFormatError {
  constructor(message: string) {
    super(message);
    this.name = 'JournalTrailerCandidateError';
  }
}

/**
 * Damage under an intact trailer: a root or a record that a committed trailer
 * reaches fails its CRC or is missing. It is never skipped, never repaired and
 * never answered with an older trailer (design 2.2 and 3.1).
 */
export class JournalCorruptionError extends Error {
  readonly path: string;
  /** What the trailer says lives there, for example `rowRoot` or `record`. */
  readonly what: string;
  readonly offset: number;
  /** The intact trailer that led to the damaged record. */
  readonly trailerOffset: number;

  constructor(
    path: string,
    what: string,
    offset: number,
    trailerOffset: number,
    detail: string,
    options?: ErrorOptions,
  ) {
    super(
      `Journal ${path}: ${what} at offset ${offset} is damaged (reached from the trailer at offset ${trailerOffset}): ${detail}`,
      options,
    );
    this.name = 'JournalCorruptionError';
    this.path = path;
    this.what = what;
    this.offset = offset;
    this.trailerOffset = trailerOffset;
  }
}

/** A platform flush call failed. The writer is poisoned and nothing weaker is tried. */
export class JournalFlushError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'JournalFlushError';
  }
}

/** A write or flush failed earlier, so this writer accepts nothing more. */
export class JournalWriterPoisonedError extends Error {
  constructor(options: ErrorOptions) {
    super(
      'The journal writer failed earlier and accepts no more writes',
      options,
    );
    this.name = 'JournalWriterPoisonedError';
  }
}
