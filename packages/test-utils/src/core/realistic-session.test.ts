/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { retainedAfterSettling } from './settled-heap.js';
import {
  realisticSessionRows,
  realisticSessionRowAt,
  realisticSessionSummary,
  sessionRowPayload,
  REALISTIC_SESSION_ROWS,
  REALISTIC_SESSION_PAYLOAD_BYTES,
} from './realistic-session.js';

describe('realistic session fixture', () => {
  it('creates rows only when advanced and releases consumed rows', async () => {
    let created = 0;
    const rows = realisticSessionRows({
      onRow: () => {
        created++;
      },
    });
    expect(created).toBe(0);
    const references: Array<WeakRef<object>> = [];
    for (let index = 0; index < 256; index++) {
      const next = rows.next();
      if (next.done === true)
        throw new Error('Fixture ended before the first checkpoint');
      references.push(new WeakRef(next.value));
    }
    expect(created).toBe(256);
    expect(await retainedAfterSettling(references)).toBeLessThanOrEqual(2);
    const beforeReturn = created;
    rows.return();
    expect(created - beforeReturn).toBe(0);
  });

  it('has deterministic complete mixed units, distinct payloads and realistic byte totals', () => {
    const first = realisticSessionSummary();
    const second = realisticSessionSummary();
    expect(first).toStrictEqual(second);
    expect(first.rowCount).toBe(REALISTIC_SESSION_ROWS);
    expect(first.neutralPayloadBytes).toBe(REALISTIC_SESSION_PAYLOAD_BYTES);
    expect(first.largestUnitBytes).toBe(2 * 1024 * 1024 + 2433);
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.kinds).toStrictEqual({
      text: 12_500,
      'tool-call': 6250,
      'tool-result': 6250,
    });
  });

  it('reconstructs arbitrary reference rows without reading or retaining the journal', () => {
    const streamed = createHash('sha256');
    const indexed = createHash('sha256');
    let at = 0;
    for (const row of realisticSessionRows()) {
      streamed.update(JSON.stringify(row));
      indexed.update(JSON.stringify(realisticSessionRowAt(at++)));
    }
    expect(indexed.digest('hex')).toBe(streamed.digest('hex'));
    expect(() => realisticSessionRowAt(-1)).toThrow(
      'outside the realistic session',
    );
    expect(() => realisticSessionRowAt(25_000)).toThrow(
      'outside the realistic session',
    );
  });

  it('pairs call ids and includes escaped UTF-8 content without shared identical rows', () => {
    const rows = realisticSessionRows();
    const payloads = new Set<string>();
    const calls: Array<string | undefined> = [];
    const results: Array<string | undefined> = [];
    const digest = createHash('sha256');
    for (let index = 0; index < 64; index++) {
      const next = rows.next();
      if (next.done === true) throw new Error('Fixture ended early');
      const row = next.value;
      expect(row.id).toMatch(
        /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/,
      );
      const text = sessionRowPayload(row);
      payloads.add(text);
      digest.update(text);
      expect(text).toContain('café 雪');
      expect(text).toContain('"\\\n');
      if (row.kind === 'tool-call') calls.push(row.callId);
      if (row.kind === 'tool-result') results.push(row.callId);
    }
    expect(results).toStrictEqual(calls);
    expect(new Set(calls).size).toBe(16);
    expect(payloads.size).toBe(64);
    expect(digest.digest('hex')).not.toBe(realisticSessionSummary().sha256);
    rows.return();
  });
});
