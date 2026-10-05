/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RecordingFailureStore } from './recording-failure-report.js';

describe('failure diagnostic projections', () => {
  it('describes aggregate causes, Map entries and Set values instead of replacing them with empty objects', async () => {
    const store = new RecordingFailureStore();
    const payload = { detail: 'unique-map-payload' };
    const cause = new AggregateError(
      [new Map([['row', payload]]), new Set([42n, undefined])],
      'nested errors',
    );
    store.record(1, cause);
    const report = store.takeThrough(1, 'flush');
    if (report === undefined) throw new Error('Missing report');
    const primitives: string[] = [];
    let mapEntries = 0;
    let setEntries = 0;
    for await (const detail of report.details()) {
      if (detail.kind === 'map-entry') mapEntries += 1;
      if (detail.kind === 'set-entry') setEntries += 1;
      if (
        detail.kind === 'string' ||
        detail.kind === 'bigint' ||
        detail.kind === 'undefined'
      )
        primitives.push(detail.value ?? '');
    }
    expect({ mapEntries, setEntries }).toStrictEqual({
      mapEntries: 1,
      setEntries: 2,
    });
    expect(primitives).toContain(payload.detail);
    expect(primitives).toContain('42');
    expect(primitives).toContain('undefined');
  });
});
describe('failure diagnostic record bounds', () => {
  it('streams deeply nested control-character property names within the reader record limit', async () => {
    const store = new RecordingFailureStore();
    const key = String.fromCharCode(0).repeat(128);
    let cause: object = { final: 'diagnostic leaf' };
    for (let index = 0; index < 30; index += 1) cause = { [key]: cause };
    store.record(1, cause);
    const report = store.takeThrough(1, 'flush');
    if (report === undefined) throw new Error('Missing report');
    let largestRecord = 0;
    let sawLeaf = false;
    for await (const detail of report.details()) {
      largestRecord = Math.max(
        largestRecord,
        Buffer.byteLength(JSON.stringify(detail)),
      );
      if (detail.value === 'diagnostic leaf') sawLeaf = true;
    }
    expect(sawLeaf).toBe(true);
    expect(largestRecord).toBeLessThan(32768);
  });
  it('marks inaccessible getters and cycles while retaining a live original cause', async () => {
    const store = new RecordingFailureStore();
    const cause: { self?: object; secret?: string } = {};
    cause.self = cause;
    Object.defineProperty(cause, 'secret', {
      enumerable: true,
      get: () => {
        throw new Error('getter must not run');
      },
    });
    store.record(1, cause);
    const report = store.takeThrough(1, 'flush');
    if (report === undefined) throw new Error('Missing report');
    expect(report.cause).toBe(cause);
    const kinds = new Set<string>();
    for await (const detail of report.details()) kinds.add(detail.kind);
    expect(kinds.has('accessor-not-evaluated')).toBe(true);
    expect(kinds.has('ancestor-reference')).toBe(true);
    expect(kinds.has('diagnostic-inspection-failed')).toBe(false);
  });
});
