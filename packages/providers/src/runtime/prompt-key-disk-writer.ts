/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { closeSync, openSync, writeSync } from 'node:fs';
import { parseImageDimensionsFromBase64 } from '@vybestack/llxprt-code-tools/utils/imageDimensions.js';
import { estimateImageTokens } from '@vybestack/llxprt-code-tools/utils/imageTokenEstimation.js';
import { base64Code, dataHeader } from './prompt-data-uri-scanner.js';

const omitted = '[binary media bytes omitted]';
const chunkCharacters = 8192;
const headerCharacters = 256 + 174764 * 2;

function highSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}
function lowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
function absent(value: unknown): boolean {
  return (
    value === undefined ||
    typeof value === 'function' ||
    typeof value === 'symbol'
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function imageMime(value: unknown): boolean {
  return typeof value === 'string' && value.toLowerCase().startsWith('image/');
}

/** A request-local writer, retaining only scalar file handles and counters. */
export class PromptKeyDiskWriter {
  readonly #fd: number;
  readonly #costFd: number;
  readonly #model: string;
  readonly #signal: AbortSignal | undefined;
  imageCount = 0;

  constructor(
    path: string,
    costs: string,
    model: string,
    signal?: AbortSignal,
    private readonly encoding: 'utf8' | 'utf16le' = 'utf8',
  ) {
    this.#fd = openSync(path, 'w', 0o600);
    try {
      this.#costFd = openSync(costs, 'a', 0o600);
    } catch (error) {
      closeSync(this.#fd);
      throw error;
    }
    this.#model = model;
    this.#signal = signal;
  }

  append(text: string): void {
    this.#signal?.throwIfAborted();
    this.write(this.#fd, Buffer.from(text, this.encoding));
  }

  private write(fd: number, bytes: Buffer): void {
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(fd, bytes, offset, bytes.length - offset);
      if (written === 0) throw new Error('Prompt segment I/O made no progress');
      offset += written;
    }
  }

  private image(base64: unknown): void {
    const dimensions =
      typeof base64 === 'string'
        ? parseImageDimensionsFromBase64(base64.slice(0, headerCharacters))
        : undefined;
    const cost = estimateImageTokens({
      provider: 'openai-responses',
      model: this.#model,
      dimensions,
    });
    this.write(
      this.#costFd,
      Buffer.from(`${JSON.stringify({ cost, dimensions })}\n`),
    );
    this.imageCount++;
  }

  private textRange(
    value: string,
    start: number,
    end: number,
    quoted: boolean,
  ): void {
    for (let offset = start; offset < end; ) {
      let limit = Math.min(offset + chunkCharacters, end);
      const last = value.charCodeAt(limit - 1);
      const next = value.charCodeAt(limit);
      if (limit < end && highSurrogate(last) && lowSurrogate(next)) limit--;
      const chunk = value.slice(offset, limit);
      this.append(quoted ? JSON.stringify(chunk).slice(1, -1) : chunk);
      offset = limit;
    }
  }

  string(value: string, quoted = true): void {
    if (quoted) this.append('"');
    let offset = 0;
    for (let index = 0; index < value.length; index++) {
      const header = dataHeader(value, index);
      if (header === undefined) continue;
      const payloadStart = header.payload;
      let end = payloadStart;
      while (end < value.length && base64Code(value.charCodeAt(end))) end++;
      this.textRange(value, offset, payloadStart, quoted);
      this.append(omitted);
      if (header.image)
        this.image(
          value.slice(
            payloadStart,
            Math.min(end, payloadStart + headerCharacters),
          ),
        );
      offset = end;
      index = end - 1;
    }
    this.textRange(value, offset, value.length, quoted);
    if (quoted) this.append('"');
  }

  value(value: unknown): void {
    if (typeof value === 'string') {
      this.string(value);
      return;
    }
    if (Array.isArray(value)) {
      this.append('[');
      for (let index = 0; index < value.length; index++) {
        if (index !== 0) this.append(',');
        this.value(value[index]);
      }
      this.append(']');
    } else if (record(value)) this.object(value);
    else {
      this.append(absent(value) ? 'null' : JSON.stringify(value));
    }
  }

  private object(value: Record<string, unknown>): void {
    this.append('{');
    let separator = '';
    for (const key in value) {
      const binary = key === 'data' && value.type === 'base64';
      const child = value[key];
      if (
        Object.getOwnPropertyDescriptor(value, key) === undefined ||
        (!binary && absent(child))
      )
        continue;
      this.append(separator);
      this.append(`${JSON.stringify(key)}:`);
      if (binary) {
        if (imageMime(value.media_type)) this.image(child);
        this.string(omitted);
      } else this.value(child);
      separator = ',';
    }
    this.append('}');
  }

  close(): void {
    try {
      closeSync(this.#fd);
    } finally {
      closeSync(this.#costFd);
    }
  }
}
