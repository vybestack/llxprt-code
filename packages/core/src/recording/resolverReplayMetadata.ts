/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ResolverReplayObserver } from './journalResolver.js';
import type { ProjectedLine } from './resolverScan.js';
import { field, validSeq } from './resolverProjection.js';
import {
  applyParsedEvent,
  type ReplayAccumulators,
} from './replayMetadataFold.js';
import type { ReplayResult } from './types.js';
import { isRecordWithNonNegativeIntegerPair } from './semanticMediaPurgeReplayValidation.js';

export class ReplayMetadataFailure extends Error {
  constructor(readonly result: ReplayResult) {
    super('Replay metadata rejected');
  }
}

export class ResolverReplayMetadata implements ResolverReplayObserver {
  constructor(
    private readonly acc: ReplayAccumulators,
    private readonly projectHash: string,
    private readonly throughSeq?: number,
  ) {}

  line(line: ProjectedLine): void {
    const acc = this.acc;
    acc.lineNumber = line.lineNumber;
    acc.totalLines = line.lineNumber;
    if (line.blank) return;
    if (line.invalid) {
      acc.unparseableLineCount++;
      acc.warnings.push(`Line ${line.lineNumber}: failed to parse JSON`);
      return;
    }
    if (line.parsed === null) return;
    const seq = field(line.parsed, 'seq');
    if (validSeq(seq) && this.throughSeq !== undefined && seq > this.throughSeq)
      return;
    const parsed: Record<string, unknown> = {};
    for (const key of ['v', 'seq', 'ts', 'type', 'payload'])
      parsed[key] = field(line.parsed, key);
    const failure = applyParsedEvent(parsed, acc, this.projectHash);
    if (failure !== undefined) throw new ReplayMetadataFailure(failure);
  }

  malformed(type: unknown, payload: object, lineNumber: number): void {
    this.acc.malformedCount++;
    const count = field(payload, 'itemsRemoved');
    const warning =
      type === 'rewind' && typeof count === 'number' && count >= 0
        ? 'malformed rewind cut marker, falling back to item count'
        : `malformed ${String(type)} event, skipping`;
    this.acc.warnings.push(`Line ${lineNumber}: ${warning}`);
  }

  purge(frontier: unknown): void {
    if (!isRecordWithNonNegativeIntegerPair(frontier))
      throw new Error('Invalid resolved purge frontier');
    this.acc.semanticMediaPurgeFrontier = {
      contentIndex: frontier.contentIndex,
      blockIndex: frontier.blockIndex,
    };
  }
}
