/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import { strictProbe } from './__tests__/support/source-strict-logger-fixture.js';

const root = sourceRootSetup();
// The outfile also holds non-log records (spans, metrics) without attributes.
const record = z.object({
  attributes: z.record(z.string(), z.unknown()).optional(),
});
const chunk = z.object({
  chunk_index: z.number(),
  chunk_byte_offset: z.number(),
  chunk_data: z.string(),
});
const complete = z.object({
  chunk_count: z.number(),
  content_complete: z.literal(true),
  content_bytes: z.number(),
  content_sha256: z.string(),
  row_count: z.number(),
});

function exportedRecords(path: string): Array<Record<string, unknown>> {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => record.parse(JSON.parse(line)).attributes)
    .filter((attributes) => attributes !== undefined);
}

describe('request body artifact reaches the exported log through a real provider send', () => {
  it('writes the staged request rows as ordered chunks that reassemble to the artifact digest', async () => {
    const receipt = await strictProbe(root(), 'none', true);
    expect(receipt.error).toBeNull();
    expect(receipt.output).toBe('finished');

    const records = exportedRecords(receipt.logPath);
    const chunks = records
      .filter(
        (attributes) =>
          attributes['event.name'] === 'llxprt_code.api_request_chunk',
      )
      .map((attributes) => chunk.parse(attributes));
    expect(chunks.length).toBeGreaterThan(0);
    const done = complete.parse(
      records.find(
        (attributes) =>
          attributes['event.name'] === 'llxprt_code.api_request_complete',
      ),
    );
    expect(done.chunk_count).toBe(chunks.length);

    let offset = 0;
    const parts: Buffer[] = [];
    chunks.forEach((entry, index) => {
      expect(entry.chunk_index).toBe(index);
      expect(entry.chunk_byte_offset).toBe(offset);
      const bytes = Buffer.from(entry.chunk_data, 'base64');
      parts.push(bytes);
      offset += bytes.length;
    });
    const content = Buffer.concat(parts);
    expect(content.length).toBe(done.content_bytes);
    expect(createHash('sha256').update(content).digest('hex')).toBe(
      done.content_sha256,
    );

    const rows = z
      .array(z.unknown())
      .parse(JSON.parse(content.toString('utf8')));
    expect(rows).toHaveLength(done.row_count);
    expect(rows).toHaveLength(64);
    const last = z
      .object({ blocks: z.array(z.object({ text: z.string() })) })
      .parse(rows[63]);
    expect(last.blocks[0].text.startsWith('63: "quoted" \\ 雪\n')).toBe(true);
  }, 60000);
});
