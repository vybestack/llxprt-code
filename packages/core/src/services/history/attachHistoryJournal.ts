/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
export class HistoryAttachmentError extends Error {
  constructor(
    cause: unknown,
    readonly committedRows: number,
    readonly destinationRewound: boolean,
  ) {
    super(
      `Journal attachment failed; destination retained ${committedRows} appended rows` +
        (destinationRewound ? ' after its history was rewound' : '') +
        `: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}
