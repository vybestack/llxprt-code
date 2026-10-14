/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  StreamedSegment,
  writeEnvelope,
  type EnvelopeSink,
} from './envelope-writer.js';
import { WireBodySpool } from './wire-body-spool.js';

class CollectingSink implements EnvelopeSink {
  private readonly parts: Buffer[] = [];

  append(data: string | Uint8Array): void {
    this.parts.push(Buffer.from(data));
  }

  text(): string {
    return Buffer.concat(this.parts).toString('utf8');
  }
}

function envelopeText(envelope: Record<string, unknown>): string {
  const sink = new CollectingSink();
  writeEnvelope(sink, envelope);
  return sink.text();
}

function arraySegment(items: readonly unknown[]): StreamedSegment {
  return new StreamedSegment((sink) => {
    sink.append('[');
    items.forEach((item, index) => {
      if (index > 0) sink.append(',');
      sink.append(JSON.stringify(item));
    });
    sink.append(']');
  });
}

describe('writeEnvelope', () => {
  it('writes keys in insertion order, integer-like keys first, as JSON.stringify does', () => {
    const envelope = {
      model: 'm',
      messages: [],
      7: 'seven',
      stream: true,
      3: 'three',
      stream_options: { include_usage: true },
    };

    expect(envelopeText(envelope)).toBe(JSON.stringify(envelope));
    expect(Object.keys(envelope)).toStrictEqual([
      '3',
      '7',
      'model',
      'messages',
      'stream',
      'stream_options',
    ]);
  });

  it('skips undefined, function and symbol members without stray commas', () => {
    const envelope = {
      first: undefined,
      model: 'm',
      tools: undefined,
      callback: () => 1,
      tag: Symbol('t'),
      last: 'end',
      trailing: undefined,
    };

    expect(envelopeText(envelope)).toBe('{"model":"m","last":"end"}');
    expect(envelopeText(envelope)).toBe(JSON.stringify(envelope));
  });

  it('writes an envelope with nothing to write as an empty object', () => {
    expect(envelopeText({ a: undefined })).toBe('{}');
    expect(envelopeText({})).toBe('{}');
  });

  it('writes a streamed segment at its position among small values', () => {
    const messages = [{ role: 'user', content: 'hi "there"\u2028' }, 'x'];
    const envelope = {
      model: 'kimi',
      messages: arraySegment(messages),
      stream: true,
      tools: undefined,
      tail: { n: 1 },
    };

    expect(envelopeText(envelope)).toBe(
      JSON.stringify({ model: 'kimi', messages, stream: true, tail: { n: 1 } }),
    );
  });

  it('writes a streamed segment first, last and alone', () => {
    expect(envelopeText({ input: arraySegment([1, 2]), model: 'm' })).toBe(
      '{"input":[1,2],"model":"m"}',
    );
    expect(envelopeText({ model: 'm', input: arraySegment([1, 2]) })).toBe(
      '{"model":"m","input":[1,2]}',
    );
    expect(envelopeText({ input: arraySegment([]) })).toBe('{"input":[]}');
  });

  it('escapes keys and passes the member key to toJSON', () => {
    const envelope = {
      'we"ird\ud800key': 1,
      when: { toJSON: (key: string) => `at ${key}` },
    };

    expect(envelopeText(envelope)).toBe(JSON.stringify(envelope));
  });

  it('propagates a segment failure', () => {
    const failing = new StreamedSegment(() => {
      throw new Error('row conversion failed');
    });

    expect(() => envelopeText({ messages: failing })).toThrow(
      'row conversion failed',
    );
  });

  it('writes into a spool whose stream carries exactly the sealed bytes', async () => {
    const spool = WireBodySpool.create('envelope-writer-test');
    try {
      const messages = Array.from({ length: 2000 }, (_, index) => ({
        role: 'user',
        content: `message ${index} 😀`,
      }));
      writeEnvelope(spool, {
        model: 'm',
        messages: arraySegment(messages),
        stream: true,
      });
      const length = spool.seal();
      const expected = Buffer.from(
        JSON.stringify({ model: 'm', messages, stream: true }),
      );

      const handle = spool.openStream();
      const chunks: Uint8Array[] = [];
      const reader = handle.stream.getReader();
      for (let next = await reader.read(); !next.done; ) {
        chunks.push(next.value);
        next = await reader.read();
      }
      handle.dispose();

      expect(length).toBe(expected.byteLength);
      expect(Buffer.concat(chunks).equals(expected)).toBe(true);
    } finally {
      spool.dispose();
    }
  });
});
