/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const DEFAULT_STREAMING_JSON_CHUNK_BYTES = 64 * 1024;
export const DEFAULT_HTTP_JSON_ENVELOPE_BYTES = 128 * 1024 * 1024;

export interface BoundedJsonHttpBody {
  readonly stream: ReadableStream<Uint8Array>;
  readonly byteLength: number;
  readonly accounting: () => BoundedJsonBodyAccounting;
}

export interface BoundedJsonBodyLimits {
  readonly maxChunkBytes: number;
  readonly maxEnvelopeBytes: number;
}

export interface BoundedJsonBodyAccounting {
  readonly envelopeBytes: number;
  readonly activeStreamCount: number;
  readonly activeChunkBytes: number;
  readonly highWaterChunkBytes: number;
  readonly highWaterEncodingInputCodeUnits: number;
}

type Segment =
  | {
      readonly kind: 'literal';
      readonly value: string;
      readonly byteLength: number;
    }
  | {
      readonly kind: 'string';
      readonly value: string;
      readonly byteLength: number;
    };

interface SerializationPlan {
  readonly segments: readonly Segment[];
  readonly byteLength: number;
}

const encoder = new TextEncoder();

function validateLimit(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

function hexEscape(codeUnit: number): string {
  return `\\u${codeUnit.toString(16).padStart(4, '0')}`;
}

function isShortJsonEscape(codeUnit: number): boolean {
  return [0x08, 0x09, 0x0a, 0x0c, 0x0d].includes(codeUnit);
}

function stringByteLength(value: string): number {
  let length = 2;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit === 0x22 || codeUnit === 0x5c) {
      length += 2;
    } else if (isShortJsonEscape(codeUnit)) {
      length += 2;
    } else if (codeUnit <= 0x1f) {
      length += 6;
    } else if (codeUnit <= 0x7f) {
      length += 1;
    } else if (codeUnit <= 0x7ff) {
      length += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        length += 4;
        index += 1;
      } else {
        length += 6;
      }
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      length += 6;
    } else {
      length += 3;
    }
  }
  return length;
}

function isPlainJsonCodeUnit(codeUnit: number): boolean {
  if (codeUnit <= 0x1f || codeUnit === 0x22 || codeUnit === 0x5c) return false;
  return codeUnit < 0xd800 || codeUnit > 0xdfff;
}

function* escapedStringUnits(
  value: string,
  maxPlainUnitCodeUnits: number,
): Generator<string, void, unknown> {
  yield '"';
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit === 0x22) {
      yield String.fromCharCode(0x5c, 0x22);
    } else if (codeUnit === 0x5c) {
      yield String.fromCharCode(0x5c, 0x5c);
    } else if (codeUnit === 0x08) {
      yield String.fromCharCode(0x5c, 0x62);
    } else if (codeUnit === 0x09) {
      yield String.fromCharCode(0x5c, 0x74);
    } else if (codeUnit === 0x0a) {
      yield String.fromCharCode(0x5c, 0x6e);
    } else if (codeUnit === 0x0c) {
      yield String.fromCharCode(0x5c, 0x66);
    } else if (codeUnit === 0x0d) {
      yield String.fromCharCode(0x5c, 0x72);
    } else if (codeUnit <= 0x1f) {
      yield hexEscape(codeUnit);
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdfff) {
      const next = value.charCodeAt(index + 1);
      if (codeUnit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        yield value.slice(index, index + 2);
        index += 1;
      } else {
        yield hexEscape(codeUnit);
      }
    } else {
      const start = index;
      const end = Math.min(value.length, start + maxPlainUnitCodeUnits);
      while (
        index + 1 < end &&
        isPlainJsonCodeUnit(value.charCodeAt(index + 1))
      ) {
        index += 1;
      }
      yield value.slice(start, index + 1);
    }
  }
  yield '"';
}

function hasToJson(value: object): value is object & { toJSON: unknown } {
  return 'toJSON' in value;
}

class PlanBuilder {
  private readonly segments: Segment[] = [];
  private readonly ancestors = new Set<object>();
  private byteLength = 0;

  build(value: unknown): SerializationPlan {
    if (!this.appendValue(value, '', false)) {
      throw new TypeError('JSON request body is not serializable');
    }
    return { segments: this.segments, byteLength: this.byteLength };
  }

  private appendLiteral(value: string): void {
    this.segments.push({ kind: 'literal', value, byteLength: value.length });
    this.byteLength += value.length;
  }

  private appendString(value: string): void {
    const byteLength = stringByteLength(value);
    this.segments.push({ kind: 'string', value, byteLength });
    this.byteLength += byteLength;
  }

  private appendValue(value: unknown, key: string, inArray: boolean): boolean {
    let serializable = value;
    if (
      typeof serializable === 'object' &&
      serializable !== null &&
      hasToJson(serializable) &&
      typeof serializable.toJSON === 'function'
    ) {
      serializable = Reflect.apply(serializable.toJSON, serializable, [key]);
    }

    if (serializable === null) {
      this.appendLiteral('null');
      return true;
    }
    if (typeof serializable === 'string') {
      this.appendString(serializable);
      return true;
    }
    if (typeof serializable === 'boolean') {
      this.appendLiteral(serializable ? 'true' : 'false');
      return true;
    }
    if (typeof serializable === 'number') {
      this.appendLiteral(
        Number.isFinite(serializable) ? String(serializable) : 'null',
      );
      return true;
    }
    if (typeof serializable === 'bigint') {
      throw new TypeError('Do not know how to serialize a BigInt');
    }
    if (
      serializable === undefined ||
      typeof serializable === 'function' ||
      typeof serializable === 'symbol'
    ) {
      if (inArray) {
        this.appendLiteral('null');
        return true;
      }
      return false;
    }
    if (typeof serializable !== 'object') {
      return false;
    }

    if (serializable instanceof Number) {
      return this.appendValue(serializable.valueOf(), key, inArray);
    }
    if (serializable instanceof String) {
      return this.appendValue(serializable.valueOf(), key, inArray);
    }
    if (serializable instanceof Boolean) {
      return this.appendValue(serializable.valueOf(), key, inArray);
    }
    if (this.ancestors.has(serializable)) {
      throw new TypeError('Converting circular structure to JSON');
    }

    this.ancestors.add(serializable);
    try {
      if (Array.isArray(serializable)) {
        this.appendArray(serializable);
      } else {
        this.appendObject(serializable);
      }
    } finally {
      this.ancestors.delete(serializable);
    }
    return true;
  }

  private appendArray(value: readonly unknown[]): void {
    this.appendLiteral('[');
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) this.appendLiteral(',');
      this.appendValue(Reflect.get(value, index), String(index), true);
    }
    this.appendLiteral(']');
  }

  private appendObject(value: object): void {
    this.appendLiteral('{');
    let included = 0;
    for (const key of Object.keys(value)) {
      const beforeSegments = this.segments.length;
      const beforeLength = this.byteLength;
      if (included > 0) this.appendLiteral(',');
      this.appendString(key);
      this.appendLiteral(':');
      if (!this.appendValue(Reflect.get(value, key), key, false)) {
        this.segments.length = beforeSegments;
        this.byteLength = beforeLength;
        continue;
      }
      included += 1;
    }
    this.appendLiteral('}');
  }
}

function segmentUnits(
  segment: Segment,
  maxPlainUnitCodeUnits: number,
): Iterable<string> {
  return segment.kind === 'literal'
    ? [segment.value]
    : escapedStringUnits(segment.value, maxPlainUnitCodeUnits);
}

class ChunkAccumulator {
  private chunk: Uint8Array | undefined;
  private readonly scalarScratch = new Uint8Array(4);
  private used = 0;

  constructor(
    private readonly maxChunkBytes: number,
    private readonly recordEncodingInput: (codeUnits: number) => void,
  ) {}

  *appendText(value: string): Generator<Uint8Array, void, unknown> {
    let index = 0;
    while (index < value.length) {
      const chunk = this.currentChunk();
      const available = this.maxChunkBytes - this.used;
      let end = Math.min(value.length, index + available);
      if (
        end < value.length &&
        end > index &&
        isHighSurrogate(value.charCodeAt(end - 1)) &&
        isLowSurrogate(value.charCodeAt(end))
      ) {
        end -= 1;
      }
      const source = value.slice(index, end);
      this.recordEncodingInput(source.length);
      const encoded = encoder.encodeInto(source, chunk.subarray(this.used));
      if (encoded.read > 0) {
        index += encoded.read;
        this.used += encoded.written;
      } else if (this.used > 0) {
        yield this.takeChunk();
      } else {
        const scalarEnd = nextScalarEnd(value, index);
        const scalar = value.slice(index, scalarEnd);
        this.recordEncodingInput(scalar.length);
        const encodedScalar = encoder.encodeInto(scalar, this.scalarScratch);
        if (encodedScalar.read !== scalar.length) {
          throw new Error('Bounded JSON scalar encoding was incomplete');
        }
        yield* this.appendBytes(
          this.scalarScratch.subarray(0, encodedScalar.written),
        );
        index = scalarEnd;
      }
      if (this.used === this.maxChunkBytes) yield this.takeChunk();
    }
  }

  finish(): Uint8Array | undefined {
    return this.used > 0 ? this.takeChunk() : undefined;
  }

  private *appendBytes(
    bytes: Uint8Array,
  ): Generator<Uint8Array, void, unknown> {
    let offset = 0;
    while (offset < bytes.byteLength) {
      const chunk = this.currentChunk();
      const count = Math.min(
        this.maxChunkBytes - this.used,
        bytes.byteLength - offset,
      );
      chunk.set(bytes.subarray(offset, offset + count), this.used);
      this.used += count;
      offset += count;
      if (this.used === this.maxChunkBytes) yield this.takeChunk();
    }
  }

  private currentChunk(): Uint8Array {
    this.chunk ??= new Uint8Array(this.maxChunkBytes);
    return this.chunk;
  }

  private takeChunk(): Uint8Array {
    const chunk = this.chunk;
    if (chunk === undefined || this.used === 0) {
      throw new Error('Bounded JSON chunk accumulator is empty');
    }
    const result =
      this.used === this.maxChunkBytes ? chunk : chunk.subarray(0, this.used);
    this.chunk = undefined;
    this.used = 0;
    return result;
  }
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

function nextScalarEnd(value: string, index: number): number {
  return isHighSurrogate(value.charCodeAt(index)) &&
    isLowSurrogate(value.charCodeAt(index + 1))
    ? index + 2
    : index + 1;
}

function* chunksFor(
  segments: readonly Segment[],
  maxChunkBytes: number,
  recordEncodingInput: (codeUnits: number) => void,
): Generator<Uint8Array, void, unknown> {
  const accumulator = new ChunkAccumulator(maxChunkBytes, recordEncodingInput);
  const maxEncodingInputCodeUnits = Math.min(
    maxChunkBytes,
    DEFAULT_STREAMING_JSON_CHUNK_BYTES,
  );
  for (const segment of segments) {
    for (const unit of segmentUnits(segment, maxEncodingInputCodeUnits)) {
      recordEncodingInput(unit.length);
      yield* accumulator.appendText(unit);
    }
  }
  const finalChunk = accumulator.finish();
  if (finalChunk !== undefined) yield finalChunk;
}

export interface BoundedJsonStream {
  readonly stream: ReadableStream<Uint8Array>;
  dispose(reason?: unknown): Promise<void>;
}

type StreamDisposer = (reason?: unknown) => Promise<void>;

async function settleDisposals(
  disposals: ReadonlyArray<Promise<void>>,
): Promise<void> {
  const results = await Promise.allSettled(disposals);
  const errors = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Bounded JSON stream cleanup failed');
  }
}

function createPublicStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  dispose: StreamDisposer,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller): Promise<void> {
        try {
          const next = await reader.read();
          if (next.done) controller.close();
          else controller.enqueue(next.value);
        } catch (error) {
          controller.error(error);
        }
      },
      cancel: dispose,
    },
    { highWaterMark: 0 },
  );
}

export class BoundedJsonBody {
  private plan: SerializationPlan | undefined;
  private activeStreamCount = 0;
  private activeChunkBytes = 0;
  private highWaterChunkBytes = 0;
  private highWaterEncodingInputCodeUnits = 0;
  private readonly activeStreamDisposals = new Set<StreamDisposer>();
  private disposalPromise: Promise<void> | undefined;

  constructor(
    value: unknown,
    private readonly limits: BoundedJsonBodyLimits,
  ) {
    validateLimit('maxChunkBytes', limits.maxChunkBytes);
    validateLimit('maxEnvelopeBytes', limits.maxEnvelopeBytes);
    const plan = new PlanBuilder().build(value);
    if (plan.byteLength > limits.maxEnvelopeBytes) {
      throw new RangeError(
        `JSON request envelope exceeds ${limits.maxEnvelopeBytes} bytes (${plan.byteLength} bytes)`,
      );
    }
    if (plan.byteLength > 0 && limits.maxChunkBytes === 0) {
      throw new RangeError('JSON streaming chunk limit is zero');
    }
    this.plan = plan;
  }

  get byteLength(): number {
    return this.plan?.byteLength ?? 0;
  }

  toUint8Array(): Uint8Array {
    const plan = this.plan;
    if (plan === undefined) throw new Error('JSON request body was disposed');
    const envelope = new Uint8Array(plan.byteLength);
    let offset = 0;
    for (const segment of plan.segments) {
      for (const unit of segmentUnits(
        segment,
        Math.min(this.limits.maxChunkBytes, DEFAULT_STREAMING_JSON_CHUNK_BYTES),
      )) {
        this.recordEncodingInput(unit.length);
        const encoded = encoder.encodeInto(unit, envelope.subarray(offset));
        if (encoded.read !== unit.length) {
          throw new Error(
            'Bounded JSON envelope length did not match its plan',
          );
        }
        offset += encoded.written;
      }
    }
    if (offset !== plan.byteLength) {
      throw new Error('Bounded JSON envelope length did not match its plan');
    }
    return envelope;
  }

  accounting(): BoundedJsonBodyAccounting {
    return {
      envelopeBytes: this.byteLength,
      activeStreamCount: this.activeStreamCount,
      activeChunkBytes: this.activeChunkBytes,
      highWaterChunkBytes: this.highWaterChunkBytes,
      highWaterEncodingInputCodeUnits: this.highWaterEncodingInputCodeUnits,
    };
  }

  dispose(reason?: unknown): Promise<void> {
    if (this.disposalPromise !== undefined) return this.disposalPromise;
    this.plan = undefined;
    const disposals = [...this.activeStreamDisposals].map((disposeStream) =>
      disposeStream(reason),
    );
    this.disposalPromise = settleDisposals(disposals);
    return this.disposalPromise;
  }

  createStream(): ReadableStream<Uint8Array> {
    return this.createStreamHandle().stream;
  }

  createStreamHandle(): BoundedJsonStream {
    const plan = this.plan;
    if (plan === undefined) {
      throw new Error('JSON request body was disposed');
    }
    const iterator = chunksFor(
      plan.segments,
      this.limits.maxChunkBytes,
      (codeUnits) => this.recordEncodingInput(codeUnits),
    );
    this.activeStreamCount += 1;
    let activeChunkBytes = 0;
    let released = false;
    const releaseChunk = (): void => {
      this.activeChunkBytes -= activeChunkBytes;
      activeChunkBytes = 0;
    };
    const release = (): void => {
      if (released) return;
      released = true;
      try {
        iterator.return();
      } finally {
        releaseChunk();
        this.activeStreamCount -= 1;
        this.activeStreamDisposals.delete(dispose);
      }
    };
    const source = new ReadableStream<Uint8Array>(
      {
        pull: (controller): void => {
          try {
            releaseChunk();
            const next = iterator.next();
            if (next.done === true) {
              release();
              controller.close();
              return;
            }
            activeChunkBytes = next.value.byteLength;
            this.activeChunkBytes += activeChunkBytes;
            this.highWaterChunkBytes = Math.max(
              this.highWaterChunkBytes,
              activeChunkBytes,
            );
            controller.enqueue(next.value);
          } catch (error: unknown) {
            try {
              release();
            } catch (releaseError) {
              controller.error(
                new AggregateError(
                  [error, releaseError],
                  'Bounded JSON streaming and cleanup failed',
                ),
              );
              return;
            }
            controller.error(error);
          }
        },
        cancel: release,
      },
      { highWaterMark: 0 },
    );
    const reader = source.getReader();
    let streamDisposal: Promise<void> | undefined;
    const dispose: StreamDisposer = (reason?: unknown): Promise<void> => {
      streamDisposal ??= reader.cancel(reason);
      return streamDisposal;
    };
    this.activeStreamDisposals.add(dispose);
    return { stream: createPublicStream(reader, dispose), dispose };
  }

  private recordEncodingInput(codeUnits: number): void {
    this.highWaterEncodingInputCodeUnits = Math.max(
      this.highWaterEncodingInputCodeUnits,
      codeUnits,
    );
  }
}

export async function withBoundedJsonHttpBody<T>(
  value: unknown,
  consume: (body: BoundedJsonHttpBody) => Promise<T>,
  limits: BoundedJsonBodyLimits = {
    maxChunkBytes: DEFAULT_STREAMING_JSON_CHUNK_BYTES,
    maxEnvelopeBytes: DEFAULT_HTTP_JSON_ENVELOPE_BYTES,
  },
): Promise<T> {
  const body = new BoundedJsonBody(value, limits);
  const stream = body.createStream();
  let result: T;
  try {
    result = await consume({
      stream,
      byteLength: body.byteLength,
      accounting: () => body.accounting(),
    });
  } catch (error) {
    try {
      await body.dispose(error);
    } catch (disposalError) {
      throw new AggregateError(
        [error, disposalError],
        'Bounded JSON transport and cleanup failed',
      );
    }
    throw error;
  }
  await body.dispose();
  return result;
}
