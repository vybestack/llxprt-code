/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryDensityRows } from '@vybestack/llxprt-code-core/services/history/historyDensityRows.js';
import { HighDensityStrategy } from '../HighDensityStrategy.js';
import { optimizeDiskDensity } from '../diskDensityOptimization.js';
import { densityConfig, densityRow } from './density-disk-helpers.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

const inclusion = '\n--- shared.ts ---\nbody\n--- End of content ---\n';
const EDGE_ROWS: IContent[] = [
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'tool_call',
        id: 'many',
        name: 'read_many_files',
        parameters: { paths: ['shared.ts', 'second.ts', 10] },
      },
      {
        type: 'tool_call',
        id: 'glob',
        name: 'read_many_files',
        parameters: { paths: ['*.ts'] },
      },
      {
        type: 'tool_call',
        id: 'empty',
        name: 'read_many_files',
        parameters: { paths: [] },
      },
    ],
  },
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'many',
        toolName: 'read_many_files',
        result: { text: 'old', nested: ['media'] },
      },
      {
        type: 'tool_response',
        callId: 'glob',
        toolName: 'read_many_files',
        result: 'retain',
      },
    ],
  },
  {
    speaker: 'human',
    blocks: [
      { type: 'text', text: inclusion },
      { type: 'text', text: inclusion },
    ],
  },
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'tool_call',
        id: 'write',
        name: 'ast_edit',
        parameters: { absolute_path: process.cwd() + '/shared.ts' },
      },
      {
        type: 'tool_call',
        id: 'write2',
        name: 'replace',
        parameters: { path: 'second.ts' },
      },
    ],
  },
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'many',
        toolName: 'read_many_files',
        result: 'later duplicate response',
      },
      {
        type: 'tool_response',
        callId: 'write',
        toolName: 'ast_edit',
        result: 'done',
      },
      { type: 'text', text: 'side' },
    ],
  },
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'tool_call',
        id: 'dup',
        name: 'read_file',
        parameters: { file_path: 'shared.ts' },
      },
      { type: 'tool_call', id: 'dup', name: 'unrelated', parameters: {} },
    ],
  },
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'tool_call',
        id: 'lastwrite',
        name: 'write_file',
        parameters: { file_path: 'shared.ts' },
      },
    ],
  },
];

function compare(rows: readonly IContent[], mask: number): number {
  const source = new HistoryDensityRows();
  for (const row of rows) source.append(row);
  const expected = new HighDensityStrategy().optimize(
    rows,
    densityConfig(mask),
  );
  const actual = optimizeDiskDensity(source, densityConfig(mask));
  try {
    expect(actual.rowOwnership().peakRows).toBeLessThanOrEqual(440);
    expect(actual.rowOwnership().peakSerializedBytes).toBeLessThanOrEqual(
      8 * 1024 * 1024,
    );
    expect(actual.rowOwnership().liveRows).toBe(0);
    expect(actual.metadata).toStrictEqual(expected.metadata);
    expect(actual.removalCount).toBe(expected.removals.length);
    expect(actual.replacementCount).toBe(expected.replacements.size);
    for (let index = 0; index < rows.length; index++) {
      const decision = actual.decision(index);
      const replacement = expected.replacements.get(index);
      let oracle: ReturnType<typeof actual.decision>;
      if (expected.removals.includes(index)) oracle = { kind: 'removed' };
      else if (replacement !== undefined)
        oracle = { kind: 'replaced', row: replacement };
      expect(decision).toStrictEqual(oracle);
    }
    const metrics = actual.metrics();
    expect(metrics.reads).toBeGreaterThanOrEqual(rows.length);
    if (mask !== 0) expect(metrics.writes).toBeGreaterThan(0);
    expect(metrics.residentIndexBytes).toBeLessThanOrEqual(32);
    return metrics.diskBytes;
  } finally {
    actual.close();
    source.close();
  }
}

describe('disk density row/path/call/inclusion decisions', () => {
  for (let mask = 0; mask < 8; mask++)
    it(`matches legacy duplicate IDs, inclusion ties, many-file and phase decisions for mask ${mask}`, () => {
      expect(compare(EDGE_ROWS, mask)).toBeGreaterThanOrEqual(4096 * 8);
    });
  for (const size of [512, 8192])
    it(`uses an actual disk index for all ${size} mixed-row decisions`, () => {
      expect(
        compare(
          Array.from({ length: size }, (_, index) => densityRow(index)),
          7,
        ),
      ).toBeGreaterThan(4096 * 8);
    }, 180_000);
});
