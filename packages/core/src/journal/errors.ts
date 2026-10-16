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
