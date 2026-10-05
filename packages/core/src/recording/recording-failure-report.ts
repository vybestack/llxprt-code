/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFailureDetails } from './recording-failure-reader.js';
import {
  recordingFailureDetails,
  type RecordingFailureDetail,
} from './recording-failure-descriptor.js';
export type { RecordingFailureDetail } from './recording-failure-descriptor.js';

function weakCause(value: unknown): WeakRef<object> | undefined {
  return (typeof value === 'object' && value !== null) ||
    typeof value === 'function'
    ? new WeakRef(value)
    : undefined;
}
function writeChunk(descriptor: number, bytes: Buffer): void {
  for (let offset = 0; offset < bytes.length; ) {
    const written = writeSync(descriptor, bytes, offset);
    if (written === 0) throw new Error('Failure report write made no progress');
    offset += written;
  }
}
function writeFailureFile(
  file: string,
  generation: number,
  cause: unknown,
): void {
  const descriptor = openSync(file, 'wx', 0o600);
  let primaryFailure: { error: unknown } | undefined;
  try {
    for (const detail of recordingFailureDetails(generation, cause)) {
      writeChunk(
        descriptor,
        Buffer.from(`${JSON.stringify(detail)}
`),
      );
    }
  } catch (error: unknown) {
    primaryFailure = { error };
  }
  try {
    closeSync(descriptor);
  } catch (cleanupError: unknown) {
    if (primaryFailure !== undefined)
      throw new AggregateError(
        [primaryFailure.error, cleanupError],
        'Diagnostic write and descriptor cleanup failed',
      );
    throw cleanupError;
  }
  if (primaryFailure !== undefined) throw primaryFailure.error;
}
async function closeReport(
  report: RecordingFailureReport,
  primaryFailure?: { error: unknown },
): Promise<void> {
  try {
    await report.close();
  } catch (cleanupError: unknown) {
    if (primaryFailure !== undefined)
      throw new AggregateError(
        [primaryFailure.error, cleanupError],
        'Recording failure report read and cleanup failed',
      );
    throw cleanupError;
  }
}
function failureSummary(cause: unknown): string {
  if (!(cause instanceof Error)) return typeof cause;
  const message: unknown = Object.getOwnPropertyDescriptor(
    cause,
    'message',
  )?.value;
  return typeof message === 'string'
    ? Buffer.from(message.slice(0, 512), 'utf8').toString('utf8')
    : 'Error without a readable own message';
}
export class RecordingFailureStorageError extends Error {
  constructor(
    cause: unknown,
    readonly storageError: unknown,
    readonly cleanupError?: unknown,
  ) {
    super('Persistence failed and its diagnostic report could not be stored', {
      cause,
    });
    this.name = 'RecordingFailureStorageError';
  }
}
export class RecordingFailureNotice extends Error {
  constructor(
    readonly count: number,
    readonly firstGeneration: number,
    private readonly liveCause?: WeakRef<object>,
  ) {
    super(
      `Persistence failed: ${count} failures (first generation ${firstGeneration}); diagnostics transferred to another boundary report`,
    );
    this.name = 'RecordingFailureNotice';
  }
  override get cause(): unknown {
    return this.liveCause?.deref();
  }
}
export class RecordingFailureReport extends Error {
  private nextCleanupGeneration: number;
  private reading = false;
  private closed = false;
  private activeReader: Generator<RecordingFailureDetail> | undefined;
  constructor(
    readonly count: number,
    readonly firstGeneration: number,
    private readonly lastGeneration: number,
    private readonly directory: string,
    private readonly removeDirectory: boolean,
    message: string,
    private readonly liveCause?: WeakRef<object>,
  ) {
    super(message);
    this.name = 'RecordingFailureReport';
    this.nextCleanupGeneration = firstGeneration;
  }
  override get cause(): unknown {
    return this.liveCause?.deref();
  }
  async *details(): AsyncGenerator<RecordingFailureDetail> {
    if (this.closed) return;
    if (this.reading)
      throw new Error('Recording failure report already has a consumer');
    this.reading = true;
    let primaryFailure: { error: unknown } | undefined;
    let deliveredFailures = 0;
    try {
      for (
        let generation = this.firstGeneration;
        generation <= this.lastGeneration;
        generation += 1
      ) {
        const file = join(this.directory, `${generation}.jsonl`);
        if (!existsSync(file)) continue;
        const reader = readFailureDetails(file);
        this.activeReader = reader;
        try {
          deliveredFailures += yield* this.validateDetails(reader, generation);
        } finally {
          reader.return(undefined);
          this.activeReader = undefined;
        }
      }
      if (!this.isClosed() && deliveredFailures !== this.count)
        throw new Error(
          `Incomplete recording failure report: expected ${this.count}, delivered ${deliveredFailures}`,
        );
    } catch (error: unknown) {
      primaryFailure = { error };
      throw error;
    } finally {
      this.reading = false;
      await closeReport(this, primaryFailure);
    }
  }
  private *validateDetails(
    reader: Generator<RecordingFailureDetail>,
    generation: number,
  ): Generator<RecordingFailureDetail, number> {
    let count = 0;
    for (const detail of reader) {
      count += this.countDetail(detail, generation);
      yield detail;
    }
    return count;
  }
  private countDetail(
    detail: RecordingFailureDetail,
    generation: number,
  ): number {
    if (detail.generation !== generation)
      throw new Error('Recording failure report generation mismatch');
    return detail.kind === 'failure' ? 1 : 0;
  }
  private isClosed(): boolean {
    return this.closed;
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.activeReader?.return(undefined);
    this.activeReader = undefined;
    while (this.nextCleanupGeneration <= this.lastGeneration) {
      const file = join(this.directory, `${this.nextCleanupGeneration}.jsonl`);
      if (existsSync(file)) unlinkSync(file);
      this.nextCleanupGeneration += 1;
    }
    if (this.removeDirectory && existsSync(this.directory)) {
      try {
        rmdirSync(this.directory);
      } catch (error: unknown) {
        if (
          !(
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === 'ENOTEMPTY'
          )
        )
          throw error;
      }
    }
    this.closed = true;
  }
}

export class RecordingFailureStore {
  private directory: string | undefined;
  private consumedThrough = 0;
  private firstGeneration = Infinity;
  private firstCause: WeakRef<object> | undefined;
  private firstMessage = '';
  constructor(private readonly root?: string) {}
  record(generation: number, cause: unknown): void {
    let temporary: string | undefined;
    try {
      this.directory ??=
        this.root ?? mkdtempSync(join(tmpdir(), 'llxprt-recording-failures-'));
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      const file = join(this.directory, `${generation}.jsonl`);
      temporary = `${file}.tmp`;
      writeFailureFile(temporary, generation, cause);
      renameSync(temporary, file);
    } catch (storageError: unknown) {
      let cleanupError: unknown;
      try {
        if (temporary !== undefined && existsSync(temporary))
          unlinkSync(temporary);
      } catch (error: unknown) {
        cleanupError = error;
      }
      throw new RecordingFailureStorageError(cause, storageError, cleanupError);
    }
    if (generation < this.firstGeneration) {
      this.firstGeneration = generation;
      this.firstCause = weakCause(cause);
      this.firstMessage = failureSummary(cause);
    }
  }
  takeThrough(
    generation: number,
    message: string,
    cause?: unknown,
  ): RecordingFailureReport | undefined {
    const start = this.consumedThrough + 1;
    this.consumedThrough = Math.max(this.consumedThrough, generation);
    if (this.directory === undefined) return undefined;
    let count = 0;
    let first = 0;
    for (let index = start; index <= generation; index += 1) {
      if (!existsSync(join(this.directory, `${index}.jsonl`))) continue;
      if (count === 0) first = index;
      count += 1;
    }
    if (count === 0) return undefined;
    let liveCause: WeakRef<object> | undefined;
    if (this.firstGeneration === first) liveCause = this.firstCause;
    else if (count === 1) liveCause = weakCause(cause);
    const firstMessage =
      this.firstGeneration === first
        ? this.firstMessage
        : failureSummary(cause);
    const summary =
      count === 1
        ? `Session persistence generation ${first} failed: ${firstMessage}`
        : `${message}: ${count} failures (first generation ${first})`;
    if (this.firstGeneration <= generation) {
      this.firstCause = undefined;
      this.firstGeneration = Infinity;
      this.firstMessage = '';
    }
    return new RecordingFailureReport(
      count,
      first,
      generation,
      this.directory,
      this.root === undefined,
      summary,
      liveCause,
    );
  }
}
