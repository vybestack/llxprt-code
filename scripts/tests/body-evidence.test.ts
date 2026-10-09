/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  initializeEvidenceLane,
  writeCompactBody,
  writeBodyFile,
  appendBodyEvidence,
} from '../lib/body-evidence-writer.js';
import { laneFootprint } from '../lib/body-evidence-budget.js';

function freshLane(cap = 100 * 1024 * 1024): string {
  const scratch = process.env.BODY_EVIDENCE_TEST_SCRATCH;
  if (!scratch)
    throw new Error('Declare evidence test scratch inside this lane');
  const parent = mkdtempSync(join(scratch, 'case-'));
  const root = join(parent, 'evidence');
  initializeEvidenceLane(root, cap);
  return root;
}

function sha(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function config(root: string): NodeJS.ProcessEnv {
  return {
    BODY_EVIDENCE_MODE: 'sha256+gzip-stream',
    BODY_EVIDENCE_ROOT: root,
    BODY_EVIDENCE_ATTEMPT: 'unit-attempt',
  };
}

describe('compact BODY evidence', () => {
  it.each([512, 8192])(
    'restores all original Unicode bytes at %i rows',
    async (size) => {
      const root = freshLane();
      const body = Array.from(
        { length: size },
        (_, row) => `${row}:a😀é中\ud800\n`,
      ).join('');
      const receipt = await writeCompactBody(root, body, {
        attempt: 'unicode',
        case: String(size),
        side: 'actual',
      });
      const compressed = readFileSync(receipt.compressedPath);
      const decoded = gunzipSync(compressed);
      const original = Buffer.from(body);
      expect(decoded.equals(original)).toBe(true);
      expect(receipt.rawBytes).toBe(original.length);
      expect(receipt.rawSha256).toBe(sha(body));
      expect(receipt.compressedBytes).toBe(compressed.length);
      expect(receipt.compressedSha256).toBe(sha(compressed));
      expect(receipt.incomplete).toBe(false);
      expect(readdirSync(root).some((name) => name.endsWith('.part'))).toBe(
        false,
      );
    },
  );

  it('preserves UTF8 sequences split across byte chunks', async () => {
    const root = freshLane();
    const bytes = Buffer.from('first😀é中last');
    async function* split(): AsyncGenerator<Uint8Array> {
      for (const byte of bytes) yield Uint8Array.of(byte);
    }
    const receipt = await writeCompactBody(root, split(), {
      attempt: 'bytes',
      case: 'split',
      side: 'expected',
    });
    expect(gunzipSync(readFileSync(receipt.compressedPath)).equals(bytes)).toBe(
      true,
    );
    expect(receipt.rawSha256).toBe(sha(bytes));
  });
  it('keeps a surrogate pair crossing the string chunk boundary', async () => {
    const root = freshLane();
    const body = 'x'.repeat(8191) + '😀tail';
    const receipt = await writeCompactBody(root, body, {
      attempt: 'unicode-boundary',
      case: 'pair',
      side: 'actual',
    });
    expect(
      gunzipSync(readFileSync(receipt.compressedPath)).equals(
        Buffer.from(body),
      ),
    ).toBe(true);
    expect(receipt.rawSha256).toBe(sha(body));
  });
});

describe('compact BODY identities and append contracts', () => {
  it('keeps distinct retries and both unequal sides without overwriting', async () => {
    const root = freshLane();
    const first = await writeCompactBody(root, 'actual-one', {
      attempt: 'retry-1',
      case: 'same-case',
      side: 'actual',
    });
    const second = await writeCompactBody(root, 'actual-two', {
      attempt: 'retry-2',
      case: 'same-case',
      side: 'actual',
    });
    const expected = await writeCompactBody(root, 'oracle', {
      attempt: 'retry-2',
      case: 'same-case',
      side: 'expected',
    });
    expect(
      new Set([
        first.compressedPath,
        second.compressedPath,
        expected.compressedPath,
      ]).size,
    ).toBe(3);
    expect(gunzipSync(readFileSync(first.compressedPath)).toString()).toBe(
      'actual-one',
    );
    expect(first.rawSha256).not.toBe(second.rawSha256);
    expect(second.rawSha256).not.toBe(expected.rawSha256);
  });

  it('extends append JSONL records without changing their legacy fields', async () => {
    const root = freshLane();
    const output = join(root, 'pairs.jsonl');
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        appendBodyEvidence(
          output,
          { index, size: 512 },
          `actual-${index}`,
          `expected-${index}`,
          config(root),
        ),
      ),
    );
    const rows: unknown[] = readFileSync(output, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(rows).toHaveLength(8);
    expect(new Set(rows.map((row) => JSON.stringify(row))).size).toBe(8);
    for (const row of rows) {
      if (
        typeof row !== 'object' ||
        row === null ||
        !('size' in row) ||
        !('evidence' in row)
      )
        throw new Error('Lost JSONL record fields');
      expect(row.size).toBe(512);
      expect(Array.isArray(row.evidence)).toBe(true);
    }
  });

  it('leaves the legacy directory and JSONL contracts unchanged without opt in', async () => {
    const root = freshLane();
    const raw = join(root, 'legacy.json');
    const lines = join(root, 'legacy.jsonl');
    await writeBodyFile(raw, '😀raw', {});
    await appendBodyEvidence(lines, { bodyBytes: 7 }, 'actual', 'expected', {});
    expect(readFileSync(raw).equals(Buffer.from('😀raw'))).toBe(true);
    expect(readFileSync(lines, 'utf8')).toBe('{"bodyBytes":7}\n');
  });
});

describe('compact BODY validation and accounting', () => {
  it('rejects invalid mode and out-of-lane paths without touching old data', async () => {
    const root = freshLane();
    const old = join(root, '..', 'historical.json');
    writeFileSync(old, 'protected');
    await expect(writeBodyFile(old, 'new', config(root))).rejects.toThrow(
      'outside',
    );
    await expect(
      writeBodyFile(join(root, 'new.json'), 'new', {
        ...config(root),
        BODY_EVIDENCE_MODE: 'unknown',
      }),
    ).rejects.toThrow('mode');
    expect(readFileSync(old, 'utf8')).toBe('protected');
  });

  it('counts logs and scratch in logical and allocated lane accounting', async () => {
    const root = freshLane(1024 * 1024);
    writeFileSync(join(root, 'driver.log'), randomBytes(128 * 1024));
    writeFileSync(join(root, 'scratch.bin'), randomBytes(128 * 1024));
    const before = laneFootprint(root);
    const body = 'x'.repeat(3 * 1024 * 1024);
    const receipt = await writeCompactBody(root, body, {
      attempt: 'padded',
      case: 'one',
      side: 'actual',
    });
    const decoded = gunzipSync(readFileSync(receipt.compressedPath));
    expect(decoded.equals(Buffer.from(body))).toBe(true);
    expect(receipt.rawSha256).toBe(sha(decoded));
    const after = laneFootprint(root);
    expect(before.logical).toBeGreaterThanOrEqual(256 * 1024);
    expect(before.allocated).toBeGreaterThanOrEqual(256 * 1024);
    expect(after.logical).toBeGreaterThan(before.logical);
    expect(after.allocated).toBeLessThan(1024 * 1024);
  });
});

describe('compact BODY incomplete controls', () => {
  it('refuses an incompressible multi-MiB body and preserves incomplete evidence below cap', async () => {
    const root = freshLane(1024 * 1024);
    const bytes = randomBytes(3 * 1024 * 1024);
    await expect(
      writeCompactBody(root, bytes, {
        attempt: 'adverse',
        case: 'random',
        side: 'actual',
      }),
    ).rejects.toThrow('budget');
    const receipts = readdirSync(root).filter((name) =>
      name.endsWith('.receipt.json'),
    );
    expect(receipts).toHaveLength(1);
    const text = readFileSync(join(root, receipts[0]), 'utf8');
    expect(text).toContain('"incomplete":true');
    expect(text).toContain('budget');
    expect(text).toContain(`"rawBytes":${bytes.length}`);
    expect(text).toContain(`"rawSha256":"${sha(bytes)}"`);
    expect(laneFootprint(root).logical).toBeLessThan(1024 * 1024);
    expect(laneFootprint(root).allocated).toBeLessThan(1024 * 1024);
  });

  it('records cancellation and iterator failure instead of reporting completion', async () => {
    const root = freshLane();
    const controller = new AbortController();
    async function* cancelled(): AsyncGenerator<Uint8Array> {
      yield Buffer.from('prefix');
      controller.abort();
      yield Buffer.from('suffix');
    }
    await expect(
      writeCompactBody(root, cancelled(), {
        attempt: 'abort',
        case: 'one',
        side: 'actual',
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    async function* invalid(): AsyncGenerator<Uint8Array> {
      yield Buffer.from('prefix');
      throw new Error('source failed');
    }
    await expect(
      writeCompactBody(root, invalid(), {
        attempt: 'invalid',
        case: 'one',
        side: 'expected',
      }),
    ).rejects.toThrow('source failed');
    const texts = readdirSync(root)
      .filter((name) => name.endsWith('.receipt.json'))
      .map((name) => readFileSync(join(root, name), 'utf8'));
    expect(texts).toHaveLength(2);
    expect(texts.every((text) => text.includes('"incomplete":true'))).toBe(
      true,
    );
  });
});

describe('compact BODY invalid external chunks', () => {
  it('marks a malformed external byte stream incomplete', async () => {
    const root = freshLane();
    async function* malformed(): AsyncGenerator<unknown> {
      yield Uint8Array.of(1, 2, 3);
      yield 'not a byte chunk';
    }
    const result: unknown = Reflect.apply(writeCompactBody, undefined, [
      root,
      malformed(),
      {
        attempt: 'invalid-external',
        case: 'chunk',
        side: 'actual',
      },
    ]);
    await expect(result).rejects.toThrow('Invalid BODY byte chunk');
    const names = readdirSync(root).filter((name) =>
      name.endsWith('.receipt.json'),
    );
    expect(names).toHaveLength(1);
    expect(readFileSync(join(root, names[0]), 'utf8')).toContain(
      '"incomplete":true',
    );
  });
});
