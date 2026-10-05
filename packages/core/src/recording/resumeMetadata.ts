/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { readMetadataJsonLines } from './metadataJsonLines.js';
import {
  createAccumulators,
  applyParsedEvent,
  finalizeReplay,
} from './replayMetadataFold.js';
import type { ReplayResult } from './types.js';
import type { JournalReadCounters } from './journalCounters.js';

export async function scanResumeMetadata(
  filePath: string,
  projectHash: string,
  maxBytes: number,
  counters?: JournalReadCounters,
): Promise<{ replay: ReplayResult; watermark: number }> {
  const acc = createAccumulators(counters ?? null);
  let watermark = 0;
  for await (const line of readMetadataJsonLines(filePath, maxBytes)) {
    acc.lineNumber = line.lineNumber;
    acc.totalLines = line.lineNumber;
    if (line.complete || line.parsed !== null) watermark = line.byteEnd;
    if (!line.blank && line.parsed === null) {
      acc.unparseableLineCount += 1;
      acc.warnings.push(`Line ${line.lineNumber}: failed to parse JSON`);
    } else if (!line.blank) {
      counters?.recordDecoded();
      const parsed = projectedEnvelope(line.parsed);
      const failure = applyParsedEvent(parsed, acc, projectHash);
      if (failure) return { replay: failure, watermark };
    }
  }
  return { replay: finalizeReplay(acc), watermark };
}

function projectedEnvelope(value: unknown): Record<string, unknown> {
  const parsed: Record<string, unknown> = {};
  if (typeof value !== 'object' || value === null) return parsed;
  for (const key of ['v', 'seq', 'ts', 'type', 'payload']) {
    if (key in value) parsed[key] = Reflect.get(value, key);
  }
  return parsed;
}
