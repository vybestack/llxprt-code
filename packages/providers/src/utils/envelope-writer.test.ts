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

async function envelopeText(
  envelope: Record<string, unknown>,
): Promise<string> {
  const sink = new CollectingSink();
  await writeEnvelope(sink, envelope);
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
  it('writes keys in insertion order, integer-like keys first, as JSON.stringify does', async () => {
    const envelope = {
      model: 'm',
      messages: [],
      7: 'seven',
      stream: true,
      3: 'three',
      stream_options: { include_usage: true },
    };

    expect(await envelopeText(envelope)).toBe(JSON.stringify(envelope));
    expect(Object.keys(envelope)).toStrictEqual([
      '3',
      '7',
      'model',
      'messages',
      'stream',
      'stream_options',
    ]);
  });

  it('skips undefined, function and symbol members without stray commas', async () => {
    const envelope = {
      first: undefined,
      model: 'm',
      tools: undefined,
      callback: () => 1,
      tag: Symbol('t'),
      last: 'end',
      trailing: undefined,
    };

    expect(await envelopeText(envelope)).toBe('{"model":"m","last":"end"}');
    expect(await envelopeText(envelope)).toBe(JSON.stringify(envelope));
  });

  it('writes an envelope with nothing to write as an empty object', async () => {
    expect(await envelopeText({ a: undefined })).toBe('{}');
    expect(await envelopeText({})).toBe('{}');
  });

  it('writes a streamed segment at its position among small values', async () => {
    const messages = [{ role: 'user', content: 'hi "there"\u2028' }, 'x'];
    const envelope = {
      model: 'kimi',
      messages: arraySegment(messages),
      stream: true,
      tools: undefined,
      tail: { n: 1 },
    };

    expect(await envelopeText(envelope)).toBe(
      JSON.stringify({ model: 'kimi', messages, stream: true, tail: { n: 1 } }),
    );
  });

  it('writes a streamed segment first, last and alone', async () => {
    expect(
      await envelopeText({ input: arraySegment([1, 2]), model: 'm' }),
    ).toBe('{"input":[1,2],"model":"m"}');
    expect(
      await envelopeText({ model: 'm', input: arraySegment([1, 2]) }),
    ).toBe('{"model":"m","input":[1,2]}');
    expect(await envelopeText({ input: arraySegment([]) })).toBe(
      '{"input":[]}',
    );
  });

  it('escapes keys and passes the member key to toJSON', async () => {
    const envelope = {
      'we"ird\ud800key': 1,
      when: { toJSON: (key: string) => `at ${key}` },
    };

    expect(await envelopeText(envelope)).toBe(JSON.stringify(envelope));
  });

  it('propagates a segment failure, synchronous or not', async () => {
    const failing = new StreamedSegment(() => {
      throw new Error('row conversion failed');
    });
    const failingLater = new StreamedSegment(async () => {
      await Promise.resolve();
      throw new Error('row read failed');
    });

    await expect(envelopeText({ messages: failing })).rejects.toThrow(
      'row conversion failed',
    );
    await expect(envelopeText({ messages: failingLater })).rejects.toThrow(
      'row read failed',
    );
  });

  it('waits for an asynchronous segment before writing the members after it', async () => {
    const delayed = new StreamedSegment(async (sink) => {
      sink.append('[');
      await Promise.resolve();
      sink.append('1');
      await new Promise((resolve) => setTimeout(resolve, 1));
      sink.append(',2]');
    });

    expect(await envelopeText({ a: delayed, b: 'after' })).toBe(
      '{"a":[1,2],"b":"after"}',
    );
  });

  it('writes into a spool whose stream carries exactly the sealed bytes', async () => {
    const spool = WireBodySpool.create('envelope-writer-test');
    try {
      const messages = Array.from({ length: 2000 }, (_, index) => ({
        role: 'user',
        content: `message ${index} 😀`,
      }));
      await writeEnvelope(spool, {
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
