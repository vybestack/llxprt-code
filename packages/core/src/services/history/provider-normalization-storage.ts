/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import {
  closeSync,
  ftruncateSync,
  openSync,
  readSync,
  renameSync,
  statSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { isRecord } from './historyJournalGuards.js';

const WIDTH = 48;
/** A probe reads this many consecutive slots in one call; runs are short at load <= 0.5. */
const PROBE_SLOTS = 16;
/** Rehashing reads the old table in chunks of this many slots. */
const REHASH_CHUNK_SLOTS = 1024;
const PAGE_SLOTS = 64;
const PAGE_BYTES = PAGE_SLOTS * WIDTH;
/** The new table is written through at most this many resident pages. */
const REHASH_PAGES = 64;
/** Appended values are batched into one sequential write of at most this many bytes. */
const VALUE_BUFFER_BYTES = 256 * 1024;

function transfer(
  fd: number,
  bytes: Buffer,
  position: number,
  write: boolean,
): void {
  let offset = 0;
  while (offset < bytes.length) {
    const count = write
      ? writeSync(fd, bytes, offset, bytes.length - offset, position + offset)
      : readSync(fd, bytes, offset, bytes.length - offset, position + offset);
    if (count === 0)
      throw new Error('Provider normalization storage made no I/O progress');
    offset += count;
  }
}

/**
 * The table being built by a rehash. Entries from one chunk of the old table
 * land in two nearby regions of the new one, so a few resident pages absorb
 * the writes that would otherwise each cost a probe read and a slot write.
 */
class RehashTable {
  private readonly pages = new Map<number, Buffer>();

  constructor(
    private readonly fd: number,
    private readonly capacity: number,
  ) {}

  insert(address: Buffer): void {
    let slot = address.readUInt32LE(0) % this.capacity;
    for (;;) {
      const page = this.page(Math.floor(slot / PAGE_SLOTS));
      const at = (slot % PAGE_SLOTS) * WIDTH;
      if (page.readDoubleLE(at + 32) === 0) {
        address.copy(page, at);
        return;
      }
      slot = (slot + 1) % this.capacity;
    }
  }

  flush(): void {
    for (const [number, page] of this.pages)
      transfer(this.fd, page, number * PAGE_BYTES, true);
    this.pages.clear();
  }

  private page(number: number): Buffer {
    const resident = this.pages.get(number);
    if (resident !== undefined) {
      this.pages.delete(number);
      this.pages.set(number, resident);
      return resident;
    }
    if (this.pages.size >= REHASH_PAGES) this.evictOldest();
    const page = Buffer.alloc(PAGE_BYTES);
    transfer(this.fd, page, number * PAGE_BYTES, false);
    this.pages.set(number, page);
    return page;
  }

  private evictOldest(): void {
    for (const [number, page] of this.pages) {
      transfer(this.fd, page, number * PAGE_BYTES, true);
      this.pages.delete(number);
      return;
    }
  }
}

/** Where a key lives in the index; carries no value so it retains no row. */
interface Probe {
  readonly key: string;
  readonly hash: Buffer;
  readonly slot: number;
  readonly address: Buffer;
  readonly occupied: boolean;
}

interface Found {
  readonly probe: Probe;
  /** Present when the slot holds `key`; read once while checking the key. */
  readonly record?: { readonly key: string; readonly value: unknown };
}

/** Keys and values live on disk. Rehashing holds one fixed-width address at a time. */
export class ProviderNormalizationStorage {
  private index: number;
  private readonly values: number;
  private capacity = 256;
  private count = 0;
  private end = 0;
  /** Bytes below this offset are on disk; [flushed, end) are in `pending`. */
  private flushed = 0;
  private readonly pending = Buffer.allocUnsafe(VALUE_BUFFER_BYTES);
  private closed = false;
  /** The last probe, kept so a write right after a read of the same key skips the search. */
  private probed: Probe | undefined;

  constructor(private readonly directory: string) {
    this.index = openSync(join(directory, 'index'), 'wx+', 0o600);
    try {
      ftruncateSync(this.index, this.capacity * WIDTH);
      this.values = openSync(join(directory, 'values'), 'wx+', 0o600);
    } catch (error) {
      closeSync(this.index);
      throw error;
    }
  }

  private check(): void {
    if (this.closed)
      throw new Error('Provider normalization storage is closed');
  }

  /**
   * Unix FDs survive unlink, so callers verify the scratch directory still
   * exists once per stream or batch of rows instead of once per key operation.
   */
  verify(): void {
    this.check();
    try {
      statSync(this.directory);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Provider normalization scratch directory is unavailable: ${reason}`,
        { cause: error },
      );
    }
  }

  private flush(): void {
    const length = this.end - this.flushed;
    if (length === 0) return;
    transfer(this.values, this.pending.subarray(0, length), this.flushed, true);
    this.flushed = this.end;
  }

  private append(bytes: Buffer): void {
    if (bytes.length > VALUE_BUFFER_BYTES) {
      this.flush();
      transfer(this.values, bytes, this.end, true);
      this.end += bytes.length;
      this.flushed = this.end;
      return;
    }
    if (this.end - this.flushed + bytes.length > VALUE_BUFFER_BYTES)
      this.flush();
    bytes.copy(this.pending, this.end - this.flushed);
    this.end += bytes.length;
  }

  private readValue(start: number, length: number): Buffer {
    const bytes = Buffer.alloc(length);
    if (start >= this.flushed) {
      this.pending.copy(
        bytes,
        0,
        start - this.flushed,
        start - this.flushed + length,
      );
      return bytes;
    }
    transfer(this.values, bytes, start, false);
    return bytes;
  }

  private entries(first: number, count: number): Buffer {
    const addresses = Buffer.alloc(count * WIDTH);
    transfer(this.index, addresses, first * WIDTH, false);
    return addresses;
  }

  private record(address: Buffer): { key: string; value: unknown } {
    const bytes = this.readValue(
      address.readDoubleLE(32) - 1,
      address.readDoubleLE(40),
    );
    const record: unknown = JSON.parse(bytes.toString('utf8'));
    if (!isRecord(record) || typeof record.key !== 'string')
      throw new Error('Invalid provider normalization storage value');
    return { key: record.key, value: record.value };
  }

  private search(key: string): Found {
    const hash = createHash('sha256').update(key).digest();
    let slot = hash.readUInt32LE(0) % this.capacity;
    for (let scanned = 0; scanned < this.capacity; ) {
      const span = Math.min(
        PROBE_SLOTS,
        this.capacity - slot,
        this.capacity - scanned,
      );
      const window = this.entries(slot, span);
      for (let offset = 0; offset < span; offset++) {
        const address = window.subarray(offset * WIDTH, (offset + 1) * WIDTH);
        const probe = {
          key,
          hash,
          slot: slot + offset,
          address,
          occupied: address.readDoubleLE(32) !== 0,
        };
        if (!probe.occupied) return { probe };
        if (!address.subarray(0, 32).equals(hash)) continue;
        const record = this.record(address);
        if (record.key === key) return { probe, record };
      }
      scanned += span;
      slot = (slot + span) % this.capacity;
    }
    throw new Error('Provider normalization index is full');
  }

  get(key: string): unknown {
    this.check();
    const { probe, record } = this.search(key);
    this.probed = { ...probe, occupied: record !== undefined };
    return record?.value;
  }

  set(key: string, value: unknown): void {
    this.check();
    if (this.count * 2 >= this.capacity) this.grow();
    const { hash, slot, address, occupied } =
      this.probed?.key === key ? this.probed : this.probe(key);
    this.probed = undefined;
    const bytes = Buffer.from(JSON.stringify({ key, value }));
    const start = this.end;
    this.append(bytes);
    hash.copy(address, 0);
    address.writeDoubleLE(start + 1, 32);
    address.writeDoubleLE(bytes.length, 40);
    transfer(this.index, address, slot * WIDTH, true);
    if (!occupied) this.count++;
  }

  private probe(key: string): Probe {
    const { probe, record } = this.search(key);
    return { ...probe, occupied: record !== undefined };
  }

  private rehashChunk(table: RehashTable, first: number): void {
    const count = Math.min(REHASH_CHUNK_SLOTS, this.capacity - first);
    const chunk = this.entries(first, count);
    for (let offset = 0; offset < count; offset++) {
      const address = chunk.subarray(offset * WIDTH, (offset + 1) * WIDTH);
      if (address.readDoubleLE(32) !== 0) table.insert(address);
    }
  }

  private grow(): void {
    this.probed = undefined;
    const capacity = this.capacity * 2;
    const nextPath = join(this.directory, 'index-next');
    const next = openSync(nextPath, 'w+', 0o600);
    try {
      ftruncateSync(next, capacity * WIDTH);
      const table = new RehashTable(next, capacity);
      for (let first = 0; first < this.capacity; first += REHASH_CHUNK_SLOTS)
        this.rehashChunk(table, first);
      table.flush();
      renameSync(nextPath, join(this.directory, 'index'));
    } catch (error) {
      closeSync(next);
      throw error;
    }
    closeSync(this.index);
    this.index = next;
    this.capacity = capacity;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      closeSync(this.index);
    } finally {
      closeSync(this.values);
    }
  }
}
