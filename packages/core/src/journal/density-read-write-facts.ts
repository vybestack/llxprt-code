/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  NativeFactIndexReader,
  NativeFactIndexWriter,
  NativeFactKey,
} from './nativeFactIndex.js';

export type DensityToolOccurrence =
  | { readonly kind: 'write'; readonly path: string }
  | {
      readonly kind: 'read';
      readonly id: string;
      readonly paths: readonly string[];
    }
  | {
      readonly kind: 'response';
      readonly id: string;
      readonly bucket: string;
      readonly block: number;
      readonly eligible: boolean;
    };

export class DensityReadWriteFacts {
  constructor(
    readonly reader: NativeFactIndexReader,
    readonly generation: readonly number[],
  ) {}
  key(parts: NativeFactKey): NativeFactKey {
    return [this.generation[0], this.generation[1], 'rw', ...parts];
  }
  async get(parts: NativeFactKey): Promise<readonly number[] | undefined> {
    return this.reader.get(this.key(parts));
  }
  async stale(ordinal: number, id: string): Promise<boolean> {
    const key = await this.get(['call-id', id]);
    return (
      key !== undefined &&
      (await this.get(['stale', ordinal, key[0]])) !== undefined
    );
  }
  async staleId(id: string): Promise<boolean> {
    const key = await this.get(['call-id', id]);
    return (
      key !== undefined && (await this.get(['stale-id', key[0]])) !== undefined
    );
  }
  async changes(): Promise<number> {
    return (await this.get(['changes']))?.[0] ?? 0;
  }
  async prefix(bucket: number, end: number): Promise<number> {
    let total = 0;
    for (let index = end; index > 0; index -= index & -index)
      total += (await this.get(['sum', bucket, index]))?.[0] ?? 0;
    return total;
  }
  async remaining(ordinal: number, block: number): Promise<number> {
    const response = await this.get(['position', ordinal, block]);
    if (response === undefined) return 0;
    const bucket = await this.get(['bucket', response[0]]);
    return (
      (bucket?.[1] ?? 0) - (await this.prefix(response[0], response[1] - 1))
    );
  }
}

export class DensityReadWriteWriter extends DensityReadWriteFacts {
  constructor(
    private readonly writer: NativeFactIndexWriter,
    generation: readonly number[],
  ) {
    super(writer, generation);
  }
  async set(parts: NativeFactKey, values: readonly number[]): Promise<void> {
    await this.writer.set(this.key(parts), values);
  }
  async allocate(): Promise<number> {
    const next = ((await this.get(['next']))?.[0] ?? 0) + 1;
    await this.set(['next'], [next]);
    return next;
  }
  async intern(kind: string, value: string): Promise<number> {
    const old = await this.get([kind, value]);
    if (old !== undefined) return old[0];
    const id = await this.allocate();
    await this.set([kind, value], [id]);
    return id;
  }
  async response(
    event: Extract<DensityToolOccurrence, { kind: 'response' }>,
    ordinal: number,
  ): Promise<void> {
    if (!event.eligible || (await this.staleId(event.id))) return;
    const bucket = await this.intern('bucket-id', event.bucket);
    const old = (await this.get(['bucket', bucket])) ?? [0, 0];
    const index = old[0] + 1;
    const subtotal =
      (await this.prefix(bucket, index - 1)) -
      (await this.prefix(bucket, index - (index & -index)));
    await this.set(['sum', bucket, index], [subtotal + 1]);
    await this.set(['bucket', bucket], [index, old[1] + 1]);
    const node = await this.allocate();
    const id = await this.intern('call-id', event.id);
    const head = (await this.get(['responses', id]))?.[0] ?? 0;
    await this.set(['response', node], [bucket, index, head]);
    await this.set(['responses', id], [node]);
    await this.set(['position', ordinal, event.block], [bucket, index]);
  }
  async invalidate(id: number): Promise<void> {
    if ((await this.get(['stale-id', id])) !== undefined) return;
    await this.set(['stale-id', id], [1]);
    let node = (await this.get(['responses', id]))?.[0] ?? 0;
    while (node !== 0) {
      const response = await this.get(['response', node]);
      if (response === undefined)
        throw new Error('Missing density response link');
      const [bucket, position, next] = response;
      const state = await this.get(['bucket', bucket]);
      if (state === undefined)
        throw new Error('Missing density response bucket');
      for (let index = position; index <= state[0]; index += index & -index) {
        const value = await this.get(['sum', bucket, index]);
        if (value === undefined || value[0] === 0)
          throw new Error('Invalid density response count');
        await this.set(['sum', bucket, index], [value[0] - 1]);
      }
      await this.set(['bucket', bucket], [state[0], state[1] - 1]);
      node = next;
    }
  }
}
