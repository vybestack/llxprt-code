/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { closeSync, openSync, readSync, writeSync } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { diskAssets, type CharacterClass } from './o200k-disk-assets.js';

export async function checkpoint(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await setImmediate();
  signal?.throwIfAborted();
}

async function writeAll(output: FileHandle, bytes: Buffer): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const result = await output.write(bytes, offset, bytes.length - offset);
    if (result.bytesWritten === 0)
      throw new Error('Filesystem made no write progress');
    offset += result.bytesWritten;
  }
}

async function normalizeBytes(
  input: FileHandle,
  output: FileHandle,
  encoding: 'utf8' | 'utf16le',
  signal?: AbortSignal,
): Promise<void> {
  const buffer = Buffer.alloc(65536);
  const decoder = new TextDecoder(
    encoding === 'utf16le' ? 'utf-16le' : 'utf-8',
    { ignoreBOM: true },
  );
  let result = await input.read(buffer);
  while (result.bytesRead > 0) {
    signal?.throwIfAborted();
    await writeAll(
      output,
      Buffer.from(
        decoder.decode(buffer.subarray(0, result.bytesRead), { stream: true }),
      ),
    );
    result = await input.read(buffer);
  }
  await writeAll(output, Buffer.from(decoder.decode()));
}

function utf8Width(first: number): number {
  if (first < 128) return 1;
  if (first < 224) return 2;
  return first < 240 ? 3 : 4;
}

export async function normalizeSource(
  path: string,
  destination: string,
  encoding: 'utf8' | 'utf16le',
  signal?: AbortSignal,
): Promise<void> {
  const input = await open(path, 'r');
  try {
    const output = await open(destination, 'w');
    try {
      await normalizeBytes(input, output, encoding, signal);
    } finally {
      await output.close();
    }
  } finally {
    await input.close();
  }
}

export interface Character {
  text: string;
  end: number;
  kind: CharacterClass;
}

export class DiskCharacters {
  private readonly fd: number;
  private readonly buffer = Buffer.alloc(65540);
  private start = -1;
  private length = 0;

  constructor(path: string) {
    this.fd = openSync(path, 'r');
  }

  at(position: number): Character | undefined {
    const block = Math.floor(position / 65536) * 65536;
    if (this.start !== block) {
      this.start = block;
      this.length = readSync(
        this.fd,
        this.buffer,
        0,
        this.buffer.length,
        block,
      );
    }
    const offset = position - block;
    if (offset >= this.length) return undefined;
    const first = this.buffer[offset];
    const width = utf8Width(first);
    const text = this.buffer.toString('utf8', offset, offset + width);
    return { text, end: position + width, kind: diskAssets().classify(text) };
  }

  close(): void {
    closeSync(this.fd);
  }
}

export class TokenFile {
  private readonly buffer = Buffer.alloc(65536);
  private length = 0;
  private offset = 0;
  private position = 0;
  private readonly fd: number;

  constructor(path: string) {
    this.fd = openSync(path, 'r');
  }

  next(): Buffer | undefined {
    const low = this.byte();
    if (low === undefined) return undefined;
    const high = this.byte();
    if (high === undefined) throw new Error('Truncated disk token record');
    const length = low + high * 256;
    if (length < 1 || length > 128)
      throw new Error('Invalid disk token record');
    const token = Buffer.alloc(length);
    for (let index = 0; index < length; index++) {
      const byte = this.byte();
      if (byte === undefined) throw new Error('Truncated disk token bytes');
      token[index] = byte;
    }
    return token;
  }

  private byte(): number | undefined {
    if (this.offset === this.length) {
      this.length = readSync(
        this.fd,
        this.buffer,
        0,
        this.buffer.length,
        this.position,
      );
      this.position += this.length;
      this.offset = 0;
      if (this.length === 0) return undefined;
    }
    return this.buffer[this.offset++];
  }

  close(): void {
    closeSync(this.fd);
  }
}

export class TokenWriter {
  private readonly buffer = Buffer.alloc(65536);
  private length = 0;
  private readonly fd: number;

  constructor(path: string) {
    this.fd = openSync(path, 'w');
  }

  write(token: Buffer): void {
    if (this.length + token.length + 2 > this.buffer.length) this.flush();
    this.buffer.writeUInt16LE(token.length, this.length);
    token.copy(this.buffer, this.length + 2);
    this.length += token.length + 2;
  }

  private flush(): void {
    let offset = 0;
    while (offset < this.length)
      offset += writeSync(this.fd, this.buffer, offset, this.length - offset);
    this.length = 0;
  }

  close(): void {
    try {
      this.flush();
    } finally {
      closeSync(this.fd);
    }
  }
}
