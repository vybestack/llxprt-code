/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { StreamedDumpBody, bestEffortDump } from './dumpSDKContext.js';
import type { DumpRequest, DumpRequestResult } from './dumpContext.js';
import {
  openNativeDumpWriter,
  type NativeDumpWriter,
} from './native-dump-writer.js';
import { sanitizeDiagnosticData, shouldOmitKey } from './mediaDiagnostics.js';
import { jsonValueChunks } from './boundedJsonBody.js';

export interface NativeDumpPiece {
  readonly wire: Uint8Array;
  diagnostic(): Uint8Array;
}

export function nativeDumpEnvelope(
  envelope: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(envelope)
      .filter(([key]) => !shouldOmitKey(key))
      .map(([key, value]) => [key, sanitizeDiagnosticData(value)]),
  );
}

export function nativeDumpLiteral(
  value: string | Uint8Array,
  diagnostic: string | Uint8Array = value,
): NativeDumpPiece {
  const wire = typeof value === 'string' ? Buffer.from(value) : value;
  return {
    wire,
    diagnostic: () =>
      typeof diagnostic === 'string' ? Buffer.from(diagnostic) : diagnostic,
  };
}

export function* nativeDumpValue(value: unknown): Generator<NativeDumpPiece> {
  const chunks = jsonValueChunks(value);
  if (chunks === undefined)
    throw new TypeError('Native dump value is not JSON');
  let first = true;
  for (const wire of chunks) {
    const emit = first;
    yield {
      wire,
      diagnostic: () =>
        emit
          ? Buffer.from(JSON.stringify(sanitizeDiagnosticData(value)))
          : new Uint8Array(0),
    };
    first = false;
  }
}

export class NativeDumpBody {
  private writer: NativeDumpWriter | undefined;
  private sent = false;
  readonly dump: StreamedDumpBody;

  constructor(
    private readonly pieces: () => AsyncIterable<NativeDumpPiece>,
    private readonly pretty = true,
  ) {
    this.dump = new StreamedDumpBody(
      () => this.diagnosticBytes(),
      (request, provider) => this.start(request, provider),
    );
  }

  private async *diagnosticBytes(): AsyncGenerator<Uint8Array> {
    for await (const piece of this.pieces()) yield piece.diagnostic();
  }

  private async start(
    request: DumpRequest,
    provider: string,
  ): Promise<DumpRequestResult> {
    const writer = await openNativeDumpWriter(request, provider, this.pretty);
    if (this.sent) {
      try {
        for await (const chunk of this.diagnosticBytes())
          await writer.append(chunk);
        await writer.finish();
      } catch (error) {
        await writer.discard();
        throw error;
      }
    } else this.writer = writer;
    return writer.result;
  }

  private async append(piece: NativeDumpPiece): Promise<void> {
    const writer = this.writer;
    if (writer === undefined) return;
    await bestEffortDump('native-body', 'native', async () => {
      try {
        await writer.append(piece.diagnostic());
      } catch (error) {
        this.writer = undefined;
        await writer.discard();
        throw error;
      }
    });
  }

  private async drain(iterator: AsyncIterator<NativeDumpPiece>): Promise<void> {
    if (this.writer === undefined) return;
    for (;;) {
      const next = await iterator.next();
      if (next.done === true) break;
      await this.append(next.value);
    }
    await this.finish();
  }

  async *stream(): AsyncGenerator<Uint8Array> {
    this.sent = true;
    const iterator = this.pieces()[Symbol.asyncIterator]();
    try {
      for (;;) {
        const next = await iterator.next();
        if (next.done === true) break;
        await this.append(next.value);
        yield next.value.wire;
      }
    } finally {
      try {
        await this.drain(iterator);
      } finally {
        await iterator.return?.();
      }
    }
  }

  private async finish(): Promise<void> {
    const writer = this.writer;
    this.writer = undefined;
    if (writer === undefined) return;
    await bestEffortDump('native-finish', 'native', async () => {
      try {
        await writer.finish();
      } catch (error) {
        await writer.discard();
        throw error;
      }
    });
  }

  async dispose(): Promise<void> {
    if (this.writer === undefined) return;
    for await (const piece of this.pieces()) await this.append(piece);
    await this.finish();
  }
}
