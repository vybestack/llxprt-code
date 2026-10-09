/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { z } from 'zod';
import { EVENT_API_REQUEST } from './constants.js';
import { REQUEST_TEXT_CHUNK_BYTES } from './request-text-chunks.js';

const dimension = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const id = z.string().min(1).max(128);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const metadata = z.object({
  schema_version: z.literal(4),
  request_text_protocol: z.literal('json-string-chunks-v1'),
  publication_id: id,
  artifact_id: id,
  prompt_id: id,
  model: id,
  'session.id': id,
  serialization: z.enum([
    'independent-safe-json-rows-v1',
    'legacy-request-text-v1',
  ]),
  request_chars: dimension,
  content_chars: dimension,
  content_bytes: dimension,
  content_sha256: digest,
  row_count: dimension,
  visible_chars: dimension,
  visible_bytes: dimension,
  visible_sha256: digest,
  truncated: z.boolean(),
  content_format: z.literal('capped-request-text-json-string-utf8'),
  chunk_encoding: z.literal('base64'),
});

class JsonStringCounter {
  private readonly decoder = new StringDecoder('utf8');
  private state: 'start' | 'text' | 'escape' | 'unicode' | 'end' = 'start';
  private digits = 0;
  private chars = 0;
  update(bytes: Buffer): void {
    this.consume(this.decoder.write(bytes));
  }
  finish(expected: number): void {
    this.consume(this.decoder.end());
    if (this.state !== 'end' || this.chars !== expected)
      throw new Error('Request text JSON string character mismatch');
  }
  private consume(text: string): void {
    for (let index = 0; index < text.length; index++)
      this.consumeChar(text[index]);
  }
  private consumeChar(char: string): void {
    switch (this.state) {
      case 'start':
        if (char !== '"') throw new Error('Invalid request text JSON string');
        this.state = 'text';
        break;
      case 'text':
        if (char === '"') this.state = 'end';
        else if (char === '\\') this.state = 'escape';
        else {
          if (char.charCodeAt(0) < 32)
            throw new Error('Invalid request text JSON control');
          this.chars++;
        }
        break;
      case 'escape':
        if (char === 'u') {
          this.digits = 0;
          this.state = 'unicode';
        } else {
          if (!'"\\/bfnrt'.includes(char))
            throw new Error('Invalid request text JSON escape');
          this.chars++;
          this.state = 'text';
        }
        break;
      case 'unicode':
        if (!/[a-fA-F0-9]/.test(char))
          throw new Error('Invalid request text unicode escape');
        if (++this.digits === 4) {
          this.chars++;
          this.state = 'text';
        }
        break;
      default:
        throw new Error('Trailing request text JSON bytes');
    }
  }
}

class Publication {
  private index = 0;
  private offset = 0;
  private readonly hash = createHash('sha256');
  private readonly chars = new JsonStringCounter();
  private readonly fields: z.infer<typeof metadata>;
  constructor(attributes: Readonly<Record<string, unknown>>) {
    if ('request_text' in attributes)
      throw new Error('Chunk protocol cannot contain scalar request_text');
    this.fields = metadata.parse(attributes);
    const fields = this.fields;
    if (
      fields.request_chars !== fields.content_chars ||
      fields.visible_chars > fields.content_chars ||
      fields.truncated !== fields.visible_chars < fields.content_chars
    )
      throw new Error('Invalid request artifact counts');
  }
  accept(attributes: Readonly<Record<string, unknown>>): Buffer | undefined {
    if (
      JSON.stringify(metadata.parse(attributes)) !== JSON.stringify(this.fields)
    )
      throw new Error('Request artifact metadata changed');
    if ('request_text' in attributes)
      throw new Error('Chunk protocol cannot contain scalar request_text');
    if (attributes['event.name'] === `${EVENT_API_REQUEST}_complete`) {
      if (
        attributes.chunk_count !== this.index ||
        attributes.content_complete !== true ||
        this.offset !== this.fields.visible_bytes ||
        this.hash.digest('hex') !== this.fields.visible_sha256
      )
        throw new Error(
          'Request artifact completion digest or dimensions mismatch',
        );
      this.chars.finish(this.fields.visible_chars);
      return undefined;
    }
    if (
      attributes['event.name'] !== `${EVENT_API_REQUEST}_chunk` ||
      attributes.chunk_index !== this.index ||
      attributes.chunk_byte_offset !== this.offset
    )
      throw new Error('Request artifact chunk sequence mismatch');
    const data = z
      .string()
      .max(4 * Math.ceil(REQUEST_TEXT_CHUNK_BYTES / 3))
      .parse(attributes.chunk_data);
    const bytes = Buffer.from(data, 'base64');
    if (
      bytes.length === 0 ||
      bytes.length > REQUEST_TEXT_CHUNK_BYTES ||
      bytes.toString('base64') !== data
    )
      throw new Error('Invalid request artifact chunk encoding or size');
    if (this.offset + bytes.length > this.fields.visible_bytes)
      throw new Error('Request artifact chunk exceeds visible bytes');
    this.hash.update(bytes);
    this.chars.update(bytes);
    this.index++;
    this.offset += bytes.length;
    return bytes;
  }
}

export class RequestArtifactReceiver {
  private readonly publications = new Map<string, Publication>();
  accept(attributes: Readonly<Record<string, unknown>>): Buffer | undefined {
    if (attributes.schema_version !== 4) return undefined;
    const key = id.parse(attributes.publication_id);
    const name = attributes['event.name'];
    if (name === `${EVENT_API_REQUEST}_abort`) {
      this.publications.delete(key);
      return undefined;
    }
    if (name === EVENT_API_REQUEST) {
      if (this.publications.has(key))
        throw new Error('Duplicate request artifact publication');
      this.publications.set(key, new Publication(attributes));
      return undefined;
    }
    const publication = this.publications.get(key);
    if (publication === undefined)
      throw new Error('Missing request artifact publication header');
    const bytes = publication.accept(attributes);
    if (name === `${EVENT_API_REQUEST}_complete`) this.publications.delete(key);
    return bytes;
  }
  assertComplete(): void {
    if (this.publications.size !== 0)
      throw new Error('Truncated request artifact publication');
  }
  clear(): void {
    this.publications.clear();
  }
}
