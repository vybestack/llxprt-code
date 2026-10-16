/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { closeSync, openSync, readSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import type { RecordingFailureDetail } from './recording-failure-descriptor.js';
import { z } from 'zod';

const detailSchema = z.object({
  generation: z.number().int().positive(),
  path: z.string(),
  kind: z.string(),
  value: z.string().optional(),
  offset: z.number().int().nonnegative().optional(),
});
function parseDetail(line: string): RecordingFailureDetail {
  if (line.length > 32768)
    throw new Error('Recording failure descriptor exceeds its record budget');
  const value: unknown = JSON.parse(line);
  return detailSchema.parse(value);
}
export function* readFailureDetails(
  file: string,
): Generator<RecordingFailureDetail> {
  const descriptor = openSync(file, 'r');
  const buffer = Buffer.alloc(16384);
  const decoder = new StringDecoder('utf8');
  let pending = '';
  try {
    for (;;) {
      const bytes = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytes === 0) break;
      pending += decoder.write(buffer.subarray(0, bytes));
      let newline = pending.indexOf('\n');
      while (newline !== -1) {
        yield parseDetail(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf('\n');
      }
      if (pending.length > 32768)
        throw new Error(
          'Recording failure descriptor exceeds its record budget',
        );
    }
    pending += decoder.end();
    if (pending.length !== 0)
      throw new Error('Incomplete recording failure descriptor');
  } finally {
    closeSync(descriptor);
  }
}
