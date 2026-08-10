/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the tolerant streaming token-usage reader (D1, AC-3).
 *
 * The reader streams the telemetry-owned token-usage JSONL directory one file
 * at a time and structurally accepts turn rows. It must NOT import
 * packages/agents (it defines its own tolerant structural acceptance). It must
 * ignore non-turn lifecycle rows and tolerate malformed/future external JSONL
 * with countable self-health — without whole-directory buffering.
 *
 * All tests use real files and the package-private readable-stream seam — no
 * source-text assertions, no mocks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Readable } from 'node:stream';
import {
  consumeTokenUsageDirectory,
  streamTokenUsageDirectory,
  streamTokenUsageRecords,
} from './tokenUsageReader.js';
import type { TokenUsageStreamEntry } from './tokenUsageReader.js';
// The controlled-readable seam is package-private (not exported from the
// barrel); same-package tests import it directly from the internal module.
import { streamTokenUsageFromReadable } from './tokenUsageReader.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-usage-reader-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeFile(name: string, content: string): void {
  fs.writeFileSync(path.join(dir, name), content, 'utf8');
}

function turnLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    prompt_id: 'sess-1#agentic-loop#aaaa',
    actual_prompt_tokens: 1000,
    output_tokens: 500,
    ...overrides,
  });
}

describe('streamTokenUsageRecords — real file classification', () => {
  it('yields one turn entry per accepted turn row', async () => {
    writeFile(
      'tokens.jsonl',
      `${turnLine({ prompt_id: 'p1', actual_prompt_tokens: 100 })}\n` +
        `${turnLine({ prompt_id: 'p2', actual_prompt_tokens: 200 })}\n`,
    );
    const entries: TokenUsageStreamEntry[] = [];
    for await (const e of streamTokenUsageRecords(
      path.join(dir, 'tokens.jsonl'),
    )) {
      entries.push(e);
    }
    expect(entries.map((e) => e.kind)).toEqual(['turn', 'turn']);
    const first = entries[0];
    if (first.kind !== 'turn') throw new Error('unreachable');
    expect(first.row.actualPromptTokens).toBe(100);
  });

  it('ignores non-turn lifecycle rows and counts them', async () => {
    writeFile(
      'tokens.jsonl',
      `${turnLine()}\n` +
        `${JSON.stringify({ record_type: 'compression', before: 10, after: 5 })}\n` +
        `${JSON.stringify({ record_type: 'provider_switch', from: 'a', to: 'b' })}\n` +
        `${JSON.stringify({ record_type: 'model_switch' })}\n` +
        `${turnLine({ prompt_id: 'p2' })}\n`,
    );
    const entries = [];
    for await (const e of streamTokenUsageRecords(
      path.join(dir, 'tokens.jsonl'),
    )) {
      entries.push(e);
    }
    expect(entries.map((e) => e.kind)).toEqual([
      'turn',
      'lifecycle',
      'lifecycle',
      'lifecycle',
      'turn',
    ]);
  });

  it('tolerates malformed and blank lines without failing', async () => {
    writeFile(
      'tokens.jsonl',
      `${turnLine()}\n` +
        `this is not json\n` +
        `\n` +
        `   \n` +
        `${turnLine({ prompt_id: 'p2' })}\n` +
        `{not an object}\n`,
    );
    const entries = [];
    for await (const e of streamTokenUsageRecords(
      path.join(dir, 'tokens.jsonl'),
    )) {
      entries.push(e);
    }
    expect(entries.map((e) => e.kind)).toEqual([
      'turn',
      'malformed',
      'blank',
      'blank',
      'turn',
      'malformed',
    ]);
  });

  it('classifies a final truncated line as truncated', async () => {
    writeFile(
      'tokens.jsonl',
      `${turnLine()}\n` + `{"prompt_id":"truncated","actual_prompt_tok`, // no newline
    );
    const entries = [];
    for await (const e of streamTokenUsageRecords(
      path.join(dir, 'tokens.jsonl'),
    )) {
      entries.push(e);
    }
    expect(entries.map((e) => e.kind)).toEqual(['turn', 'truncated']);
  });

  it('classifies a complete mid-file invalid JSON line as malformed (not truncated)', async () => {
    writeFile(
      'tokens.jsonl',
      `${turnLine()}\nbad json line\n${turnLine({ prompt_id: 'p2' })}\n`,
    );
    const entries = [];
    for await (const e of streamTokenUsageRecords(
      path.join(dir, 'tokens.jsonl'),
    )) {
      entries.push(e);
    }
    expect(entries.map((e) => e.kind)).toEqual(['turn', 'malformed', 'turn']);
  });

  it('treats a non-object JSON value as malformed', async () => {
    writeFile('tokens.jsonl', `${turnLine()}\n[1,2,3]\n42\n"string"\nnull\n`);
    const entries = [];
    for await (const e of streamTokenUsageRecords(
      path.join(dir, 'tokens.jsonl'),
    )) {
      entries.push(e);
    }
    expect(entries.slice(1).map((e) => e.kind)).toEqual([
      'malformed',
      'malformed',
      'malformed',
      'malformed',
    ]);
  });

  it('omits outputTokens when the field is absent or non-numeric (never zero-filled)', async () => {
    writeFile(
      'tokens.jsonl',
      `${turnLine({ output_tokens: undefined })}\n` + // omitted
        `${turnLine({ prompt_id: 'p2', output_tokens: 'NaN-string' })}\n` + // invalid type
        `${turnLine({ prompt_id: 'p3', output_tokens: 0 })}\n`, // legitimate zero
    );
    const entries: TokenUsageStreamEntry[] = [];
    for await (const e of streamTokenUsageRecords(
      path.join(dir, 'tokens.jsonl'),
    )) {
      entries.push(e);
    }
    const rows = entries
      .filter(
        (e): e is Extract<TokenUsageStreamEntry, { kind: 'turn' }> =>
          e.kind === 'turn',
      )
      .map((e) => e.row);
    expect(rows[0]?.outputTokens).toBeUndefined();
    expect(rows[1]?.outputTokens).toBeUndefined();
    expect(rows[2]?.outputTokens).toBe(0);
  });

  it('rejects negative or non-numeric actual_prompt_tokens as lifecycle', async () => {
    writeFile(
      'tokens.jsonl',
      `${turnLine({ prompt_id: 'good' })}\n` +
        `${JSON.stringify({ prompt_id: 'neg', actual_prompt_tokens: -5 })}\n` +
        `${JSON.stringify({ prompt_id: 'str', actual_prompt_tokens: 'lots' })}\n` +
        `${JSON.stringify({ prompt_id: '', actual_prompt_tokens: 10 })}\n`, // empty id
    );
    const entries = [];
    for await (const e of streamTokenUsageRecords(
      path.join(dir, 'tokens.jsonl'),
    )) {
      entries.push(e);
    }
    expect(entries.map((e) => e.kind)).toEqual([
      'turn',
      'lifecycle',
      'lifecycle',
      'lifecycle',
    ]);
  });

  it('handles an empty file', async () => {
    writeFile('empty.jsonl', '');
    const entries = [];
    for await (const e of streamTokenUsageRecords(
      path.join(dir, 'empty.jsonl'),
    )) {
      entries.push(e);
    }
    expect(entries).toEqual([]);
  });

  it('structurally accepts a future-version turn row with the right fields', async () => {
    // The reader's acceptance is structural, not version-gated: a future
    // schema version carrying the turn fields is accepted.
    const future = JSON.stringify({
      schema_version: 99,
      prompt_id: 'future-prompt',
      actual_prompt_tokens: 777,
      output_tokens: 88,
    });
    writeFile('future.jsonl', future);
    const entries: TokenUsageStreamEntry[] = [];
    for await (const e of streamTokenUsageRecords(
      path.join(dir, 'future.jsonl'),
    )) {
      entries.push(e);
    }
    expect(entries.map((e) => e.kind)).toEqual(['turn']);
    const first = entries[0];
    if (first.kind !== 'turn') throw new Error('unreachable');
    expect(first.row.actualPromptTokens).toBe(777);
  });
});

describe('consumeTokenUsageDirectory — multi-file sorted reading + self-health', () => {
  it('reads multiple sorted files and accumulates rows + counts', async () => {
    writeFile(
      'a.jsonl',
      `${turnLine({ prompt_id: 'aaa' })}\n` +
        `${JSON.stringify({ record_type: 'compression' })}\n`,
    );
    writeFile('b.jsonl', `${turnLine({ prompt_id: 'bbb' })}\n` + `not json\n`);
    // A non-jsonl file must be ignored entirely.
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignore me\n');

    const { rows, counts } = await consumeTokenUsageDirectory(dir);
    expect(counts.files).toBe(2);
    expect(counts.turns).toBe(2);
    expect(counts.lifecycle).toBe(1);
    expect(counts.malformed).toBe(1);
    expect(rows.map((r) => r.promptId)).toEqual(['aaa', 'bbb']);
  });

  it('visits files in sorted name order for deterministic reading', async () => {
    writeFile('z.jsonl', `${turnLine({ prompt_id: 'z' })}\n`);
    writeFile('a.jsonl', `${turnLine({ prompt_id: 'a' })}\n`);
    writeFile('m.jsonl', `${turnLine({ prompt_id: 'm' })}\n`);

    const { rows } = await consumeTokenUsageDirectory(dir);
    expect(rows.map((r) => r.promptId)).toEqual(['a', 'm', 'z']);
  });

  it('a missing directory is an empty dataset (fail open)', async () => {
    const { rows, counts } = await consumeTokenUsageDirectory(
      path.join(dir, 'does-not-exist'),
    );
    expect(rows).toEqual([]);
    expect(counts.files).toBe(0);
    expect(counts.turns).toBe(0);
  });

  it('distinguishes absent lifecycle (zero) from present-but-ignored', async () => {
    // Pure turn file: lifecycle count is a KNOWN zero, distinguishable from
    // an absent directory (which yields all-zero counts but empty rows). The
    // counts object always carries explicit numeric fields.
    writeFile('pure.jsonl', `${turnLine({ prompt_id: 'p1' })}\n`);
    const { counts } = await consumeTokenUsageDirectory(dir);
    expect(counts.lifecycle).toBe(0);
    expect(counts.malformed).toBe(0);
    expect(counts.truncated).toBe(0);
    expect(counts.turns).toBe(1);
  });
});

describe('streamTokenUsageFromReadable — incremental yield proof', () => {
  it('yields the first turn before the second chunk is pushed', async () => {
    const line1 = `${turnLine({ prompt_id: 'first' })}\n`;
    const line2 = `${turnLine({ prompt_id: 'second' })}\n`;

    const readable = new Readable({ read() {} });
    const iter = streamTokenUsageFromReadable(readable);

    readable.push(Buffer.from(line1));

    const first = await iter.next();
    expect(first.done).toBe(false);
    expect(first.value?.kind).toBe('turn');

    readable.push(Buffer.from(line2));
    readable.push(null);

    const second = await iter.next();
    expect(second.done).toBe(false);
    expect(second.value?.kind).toBe('turn');

    const third = await iter.next();
    expect(third.done).toBe(true);
  });

  it('processes a large file incrementally without accumulating it all first', async () => {
    const N = 5000;
    const lines: string[] = [];
    for (let i = 0; i < N; i++) {
      lines.push(turnLine({ prompt_id: `p-${i}`, actual_prompt_tokens: i }));
    }
    writeFile('big.jsonl', lines.join('\n') + '\n');
    let count = 0;
    let firstId = '';
    for await (const entry of streamTokenUsageRecords(
      path.join(dir, 'big.jsonl'),
    )) {
      if (entry.kind !== 'turn') continue;
      count++;
      if (count === 1) firstId = entry.row.promptId;
    }
    expect(count).toBe(N);
    expect(firstId).toBe('p-0');
  });

  it('proves streaming by interleaving pushes and pulls', async () => {
    const readable = new Readable({ read() {} });
    const iter = streamTokenUsageFromReadable(readable);
    for (let i = 0; i < 3; i++) {
      readable.push(
        Buffer.from(
          `${turnLine({ prompt_id: `p-${i}`, actual_prompt_tokens: i })}\n`,
        ),
      );
      const result = await iter.next();
      expect(result.done).toBe(false);
      expect(result.value?.kind).toBe('turn');
    }
    readable.push(null);
    const done = await iter.next();
    expect(done.done).toBe(true);
  });
});

describe('streamTokenUsageDirectory — per-file source attribution', () => {
  it('annotates each entry with its source file name', async () => {
    writeFile('a.jsonl', `${turnLine({ prompt_id: 'a' })}\n`);
    writeFile('b.jsonl', `${turnLine({ prompt_id: 'b' })}\n`);
    const sources: string[] = [];
    for await (const ce of streamTokenUsageDirectory(dir)) {
      if (ce.entry.kind === 'turn') sources.push(ce.sourceFile);
    }
    expect(sources).toEqual(['a.jsonl', 'b.jsonl']);
  });
});
