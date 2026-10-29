/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { loadFlushRecords } from '@vybestack/llxprt-code-core/journal/flushRecords.js';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import {
  decodeTrailerHeader,
  TRAILER_RECORD_BYTES,
} from '@vybestack/llxprt-code-core/journal/trailerRecord.js';
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import { recordingConfig, diskToolState } from './service-tool-recorders.js';
import { toolGate } from './service-tool-runtime.js';

export async function callerRecording(directory: string, name: string) {
  const seams = testJournalSeams();
  const open = seams.dependencies.open;
  const flush = await loadFlushRecords();
  const gate = toolGate();
  let flushes = 0;
  let barriers = 0;
  let groupRecordsWritten = false;
  let target: number | undefined;
  let held:
    | {
        seq: number;
        rows: number;
        flushes: number;
        barriers: number;
        before: Awaited<ReturnType<typeof diskToolState>>;
      }
    | undefined;
  const recording = await JournalRecordingService.createLocked({
    ...recordingConfig(directory, name),
    journal: {
      journal: {
        ...seams.dependencies,
        open: async (path, flags) => {
          const handle = await open(path, flags);
          return {
            ...handle,
            writev: (buffers, position) => {
              groupRecordsWritten = true;
              return handle.writev(buffers, position);
            },
            write: async (buffer, offset, length, position) => {
              if (
                length === TRAILER_RECORD_BYTES &&
                target !== undefined &&
                held === undefined
              ) {
                const trailer = decodeTrailerHeader(
                  buffer.subarray(offset + 20, offset + length - 4),
                );
                if (trailer.rootAggregate.rows === target) {
                  held = {
                    seq: trailer.commitSeq,
                    rows: target,
                    flushes,
                    barriers,
                    before: await diskToolState(path),
                  };
                  await gate.promise;
                }
              }
              if (length !== TRAILER_RECORD_BYTES) groupRecordsWritten = true;
              return handle.write(buffer, offset, length, position);
            },
          };
        },
        flush: (fd) => {
          flush(fd);
          if (!groupRecordsWritten) barriers++;
          groupRecordsWritten = false;
          flushes++;
        },
      },
    },
  });
  return {
    recording,
    flushes: () => flushes,
    barriers: () => barriers,
    held: () => held,
    arm: (rows: number): void => {
      target = rows;
    },
    release: (): void => {
      gate.resolve();
    },
  };
}
