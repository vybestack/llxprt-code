/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RecordAccess } from './recordAccess.js';

/** A copy can stop between source reads without changing its published source. */
export function cancellableAccess(
  access: RecordAccess,
  signal?: AbortSignal,
): RecordAccess {
  if (signal === undefined) return access;
  return {
    ...access,
    readRecordHead: (...args) => {
      signal.throwIfAborted();
      return access.readRecordHead(...args);
    },
    readRecordStart: (...args) => {
      signal.throwIfAborted();
      return access.readRecordStart(...args);
    },
    readRecordRange: (...args) => {
      signal.throwIfAborted();
      return access.readRecordRange(...args);
    },
    async *readRecordBody(...args) {
      signal.throwIfAborted();
      for await (const chunk of access.readRecordBody(...args)) {
        signal.throwIfAborted();
        yield chunk;
      }
    },
  };
}
