/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fs from 'node:fs/promises';
import type { RecordingWriterIo } from './types.js';
import { debugLogger } from '../utils/debugLogger.js';

/** Default write seam: journal appends go through `fs/promises.appendFile`. */
export const defaultWriterIo: RecordingWriterIo = {
  appendFile(filePath, data, encoding) {
    return fs.appendFile(filePath, data, encoding);
  },
};

/** Whether a write error indicates disk space or permission issues. */
export function isDiskSpaceError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOSPC' || code === 'EACCES';
}

/**
 * Queue depth at which the writer is clearly not keeping up with production.
 * Deliberately no record is dropped: the JSONL file is the durable transcript,
 * and the queue is bounded in practice by disk throughput, which far exceeds
 * the rate at which a model can produce content.
 */
const QUEUE_HIGH_WATER_RECORDS = 4096;

/** Reports once that the writer has fallen far behind; true when it reported. */
export function reportQueueHighWater(
  pendingRecords: number,
  pendingBytes: number,
): boolean {
  if (pendingRecords < QUEUE_HIGH_WATER_RECORDS) return false;
  debugLogger.error(
    `[SessionRecording] pending queue exceeded ${QUEUE_HIGH_WATER_RECORDS} records ` +
      `(${pendingBytes} bytes); the session file writer is behind. ` +
      `No records are dropped.`,
  );
  return true;
}
