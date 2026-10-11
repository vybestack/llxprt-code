/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

const root = resolve(import.meta.dir, '../../../../..');
const fixture: IContent = {
  speaker: 'human',
  blocks: [{ type: 'text', text: 'density row: 雪' }],
  metadata: {
    chronology: { seq: 3, userTurn: 2, step: 1, recordedAt: 0 },
  },
};

function nodeProbe(program: string): ReturnType<typeof spawnSync> {
  return spawnSync('node', ['--input-type=module', '-e', program], {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    timeout: 30_000,
  });
}

const imports = `
import assert from 'node:assert/strict';
import { HistoryDensityRows } from '@vybestack/llxprt-code-core/services/history/historyDensityRows.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
`;

describe('public density rows under default Node exports', () => {
  it('round-trips disk rows and detached sanitized rows without retaining owners', () => {
    const result = nodeProbe(`${imports}
const ownership = new RowOwnership();
const rows = new HistoryDensityRows(ownership);
const input = ${JSON.stringify(fixture)};
try {
  rows.append(input);
  rows.appendSanitized(input);
  assert.equal(rows.length, 2);
  assert.notEqual(rows.readRow(0), input);
  assert.notEqual(rows.readRow(1), input);
  assert.deepEqual([...rows], [input, input]);
  assert.equal(ownership.snapshot().liveRows, 0);
  console.log(JSON.stringify(rows.readRow(0)));
} finally {
  rows.close();
}
assert.equal(ownership.snapshot().liveRows, 0);
assert.equal(ownership.snapshot().liveSerializedBytes, 0);
assert.throws(() => rows.readRow(0), /closed/);
`);
    expect(result.status).toBe(0);
    expect(JSON.parse(String(result.stdout))).toStrictEqual(fixture);
  });

  it('releases iterator ownership when a consumer stops early', () => {
    const result = nodeProbe(`${imports}
const ownership = new RowOwnership();
const rows = new HistoryDensityRows(ownership);
try {
  rows.append(${JSON.stringify(fixture)});
  const iterator = rows[Symbol.iterator]();
  assert.equal(iterator.next().done, false);
  assert.equal(ownership.snapshot().liveRows, 1);
  iterator.return();
  assert.equal(ownership.snapshot().liveRows, 0);
  assert.equal(ownership.snapshot().liveSerializedBytes, 0);
} finally {
  rows.close();
}
`);
    expect(result.status).toBe(0);
  });
});
