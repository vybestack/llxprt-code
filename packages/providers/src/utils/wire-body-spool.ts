/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { closeSync, openSync, readSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { createScratchDirSync } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import {
  DEFAULT_HTTP_JSON_ENVELOPE_BYTES,
  DEFAULT_STREAMING_JSON_CHUNK_BYTES,
  envelopeTooLargeError,
  type BoundedJsonBodyAccounting,
  type BoundedJsonHttpBody,
} from './boundedJsonBody.js';

const WRITE_BUFFER_BYTES = DEFAULT_STREAMING_JSON_CHUNK_BYTES;

let activeSpools = 0;

/** Spools created and not yet disposed. Tests assert it returns to its start. */
export function activeWireBodySpoolCount(): number {
  return activeSpools;
}

export interface WireBodySpoolOptions {
  /** Checked on every append. */
  readonly signal?: AbortSignal;
  readonly maxEnvelopeBytes?: number;
}

function writeAll(fd: number, bytes: Uint8Array): void {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const written = writeSync(fd, bytes, offset, bytes.byteLength - offset);
    if (written === 0) throw new Error('Wire body spool I/O made no progress');
    offset += written;
  }
}

/**
 * One read handle on the sealed file. The spool owns it until it closes, so a
 * cancelled or finished stream, and a disposed spool, all release the fd.
 */
class SpoolReader {
  private fd: number | undefined;
  private served = 0;
  private lastChunkBytes = 0;

  constructor(
    path: string,
    private readonly declared: number,
    private readonly onClosed: (reader: SpoolReader) => void,
    private readonly onChunk: (bytes: number) => void,
  ) {
    this.fd = openSync(path, 'r');
  }

  get activeChunkBytes(): number {
    return this.lastChunkBytes;
  }

  /** The next chunk, or `undefined` once the declared length has been served. */
  read(): Uint8Array | undefined {
    const fd = this.fd;
    if (fd === undefined) throw new Error('Wire body stream was closed');
    this.lastChunkBytes = 0;
    if (this.served === this.declared) {
      this.assertNoMoreBytes(fd);
      return undefined;
    }
    const chunk = new Uint8Array(
      Math.min(DEFAULT_STREAMING_JSON_CHUNK_BYTES, this.declared - this.served),
    );
    let filled = 0;
    while (filled < chunk.byteLength) {
      const count = readSync(
        fd,
        chunk,
        filled,
        chunk.byteLength - filled,
        this.served + filled,
      );
      if (count === 0) {
        throw new Error(
          `Request body served ${this.served + filled} bytes but declared ${this.declared}`,
        );
      }
      filled += count;
    }
    this.served += filled;
    this.lastChunkBytes = filled;
    this.onChunk(filled);
    return chunk;
  }

  close(): void {
    const fd = this.fd;
    if (fd === undefined) return;
    this.fd = undefined;
    this.lastChunkBytes = 0;
    this.onClosed(this);
    closeSync(fd);
  }

  private assertNoMoreBytes(fd: number): void {
    if (readSync(fd, new Uint8Array(1), 0, 1, this.declared) > 0) {
      throw new Error(
        `Request body served more than ${this.declared} bytes but declared ${this.declared}`,
      );
    }
  }
}

export interface WireBodySpoolStream {
  readonly stream: ReadableStream<Uint8Array>;
  /** Closes the read handle. Safe to call after the stream finished. */
  dispose(): void;
}

type SpoolState = 'writing' | 'sealed' | 'disposed';

/**
 * A request body written once into a request-scoped scratch file and then
 * streamed from it, any number of times. The sealed size is the exact
 * `Content-Length`, so no second pass can disagree with the bytes sent.
 *
 * The owner disposes the spool: read handles close first, then the scratch
 * directory is removed. Anything still reading sees an error on its next pull.
 */
export class WireBodySpool {
  private state: SpoolState = 'writing';
  private bytes = 0;
  private writeFd: number | undefined;
  private readonly buffer = Buffer.allocUnsafe(WRITE_BUFFER_BYTES);
  private buffered = 0;
  private highWaterChunkBytes = 0;
  private readonly readers = new Set<SpoolReader>();

  private constructor(
    private readonly directory: string,
    readonly path: string,
    private readonly options: WireBodySpoolOptions,
    private readonly maxEnvelopeBytes: number,
  ) {
    this.writeFd = openSync(path, 'w', 0o600);
  }

  static create(
    purpose: string,
    options: WireBodySpoolOptions = {},
  ): WireBodySpool {
    const directory = createScratchDirSync(`${purpose}-`);
    try {
      const spool = new WireBodySpool(
        directory,
        join(directory, 'body'),
        options,
        options.maxEnvelopeBytes ?? DEFAULT_HTTP_JSON_ENVELOPE_BYTES,
      );
      activeSpools += 1;
      return spool;
    } catch (error) {
      rmSync(directory, { recursive: true, force: true });
      throw error;
    }
  }

  /** The exact size of the sealed body. */
  get byteLength(): number {
    if (this.state !== 'sealed') {
      throw new Error('Wire body spool is not sealed');
    }
    return this.bytes;
  }

  /**
   * Appends bytes. Fails on abort, and with the `BoundedJsonBody` envelope
   * error once the body would pass the envelope limit.
   */
  append(data: string | Uint8Array): void {
    this.requireState('writing');
    this.options.signal?.throwIfAborted();
    const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const total = this.bytes + bytes.byteLength;
    if (total > this.maxEnvelopeBytes) {
      throw envelopeTooLargeError(this.maxEnvelopeBytes, total);
    }
    this.bytes = total;
    if (bytes.byteLength >= this.buffer.byteLength) {
      this.flush();
      writeAll(this.requireWriteFd(), bytes);
      return;
    }
    if (this.buffered + bytes.byteLength > this.buffer.byteLength) this.flush();
    this.buffer.set(bytes, this.buffered);
    this.buffered += bytes.byteLength;
  }

  /** Ends writing and returns the exact byte length. */
  seal(): number {
    this.requireState('writing');
    this.flush();
    const fd = this.requireWriteFd();
    this.writeFd = undefined;
    closeSync(fd);
    this.state = 'sealed';
    return this.bytes;
  }

  /** A fresh stream over a fresh read handle. Use one per transport attempt. */
  openStream(): WireBodySpoolStream {
    this.requireState('sealed');
    const reader = new SpoolReader(
      this.path,
      this.bytes,
      (closed) => this.readers.delete(closed),
      (chunkBytes) => {
        this.highWaterChunkBytes = Math.max(
          this.highWaterChunkBytes,
          chunkBytes,
        );
      },
    );
    this.readers.add(reader);
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller): void {
          try {
            const chunk = reader.read();
            if (chunk === undefined) {
              reader.close();
              controller.close();
            } else {
              controller.enqueue(chunk);
            }
          } catch (error) {
            reader.close();
            throw error;
          }
        },
        cancel: () => reader.close(),
      },
      { highWaterMark: 0 },
    );
    return { stream, dispose: () => reader.close() };
  }

  accounting(): BoundedJsonBodyAccounting {
    let activeChunkBytes = 0;
    for (const reader of this.readers) {
      activeChunkBytes += reader.activeChunkBytes;
    }
    return {
      envelopeBytes: this.bytes,
      activeStreamCount: this.readers.size,
      activeChunkBytes,
      highWaterChunkBytes: this.highWaterChunkBytes,
      highWaterEncodingInputCodeUnits: 0,
    };
  }

  /** Closes every handle, then removes the directory. Idempotent. */
  dispose(): void {
    if (this.state === 'disposed') return;
    this.state = 'disposed';
    activeSpools -= 1;
    try {
      for (const reader of [...this.readers]) reader.close();
      const fd = this.writeFd;
      this.writeFd = undefined;
      if (fd !== undefined) closeSync(fd);
    } finally {
      rmSync(this.directory, { recursive: true, force: true });
    }
  }

  private flush(): void {
    if (this.buffered === 0) return;
    const pending = this.buffer.subarray(0, this.buffered);
    this.buffered = 0;
    writeAll(this.requireWriteFd(), pending);
  }

  private requireWriteFd(): number {
    if (this.writeFd === undefined) {
      throw new Error('Wire body spool is not writable');
    }
    return this.writeFd;
  }

  private requireState(expected: SpoolState): void {
    if (this.state !== expected) {
      throw new Error(`Wire body spool is ${this.state}, expected ${expected}`);
    }
  }
}

/**
 * Runs `consume` with a fresh stream over the sealed spool, the spool-backed
 * counterpart of `withBoundedJsonHttpBody`. The attempt's read handle closes
 * when `consume` settles; the spool itself stays for the next attempt.
 */
export async function withSpooledJsonHttpBody<T>(
  spool: WireBodySpool,
  consume: (body: BoundedJsonHttpBody) => Promise<T>,
): Promise<T> {
  const handle = spool.openStream();
  try {
    return await consume({
      stream: handle.stream,
      byteLength: spool.byteLength,
      accounting: () => spool.accounting(),
    });
  } finally {
    handle.dispose();
  }
}
