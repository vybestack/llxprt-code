/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { formatHistoryMemoryBreakdown } from './perfMemoryBreakdown.js';
import type { IContent } from '@vybestack/llxprt-code-core';

function toolResponse(
  toolName: string,
  callId: string,
  body: string,
): IContent {
  return {
    speaker: 'tool',
    blocks: [{ type: 'tool_response', callId, toolName, result: { body } }],
  };
}

describe('formatHistoryMemoryBreakdown', () => {
  it('says so plainly when history is empty', () => {
    const output = formatHistoryMemoryBreakdown([]);
    expect(output).toContain('History is empty.');
    expect(output).not.toContain('By tool:');
  });

  it('reports the total and item count', () => {
    const output = formatHistoryMemoryBreakdown([
      toolResponse('read_file', 'c1', 'a'.repeat(2 * 1024 * 1024)),
    ]);
    expect(output).toContain('across 1 history items');
    expect(output).toMatch(/Total: \d+\.\d MiB/);
  });

  it('attributes bytes to the responsible tool', () => {
    const output = formatHistoryMemoryBreakdown([
      toolResponse('read_file', 'c1', 'a'.repeat(400_000)),
      toolResponse('shell', 'c2', 'b'.repeat(20_000)),
    ]);
    expect(output).toContain('By tool:');
    expect(output).toContain('read_file');
    expect(output).toContain('shell');
    // read_file dominates, so it must be listed first.
    expect(output.indexOf('read_file')).toBeLessThan(output.indexOf('shell'));
  });

  it('names the largest individual responses with a locatable index', () => {
    const output = formatHistoryMemoryBreakdown([
      toolResponse('shell', 'c1', 'a'.repeat(1_000)),
      toolResponse('read_many_files', 'c2', 'b'.repeat(500_000)),
    ]);
    expect(output).toContain('Largest individual tool responses:');
    expect(output).toContain('read_many_files (history #1, call c2)');
  });

  it('breaks down by block type with percentages', () => {
    const output = formatHistoryMemoryBreakdown([
      { speaker: 'human', blocks: [{ type: 'text', text: 'q'.repeat(1_000) }] },
      toolResponse('read_file', 'c1', 'a'.repeat(500_000)),
    ]);
    expect(output).toContain('By block type:');
    expect(output).toContain('tool_response');
    expect(output).toContain('text');
    expect(output).toMatch(/9\d\.\d%/);
  });

  it('scales units up to GiB rather than printing unreadable MiB', () => {
    // Two blocks whose logical size exceeds a gibibyte in total.
    const big = 'x'.repeat(600 * 1024 * 1024);
    const output = formatHistoryMemoryBreakdown([
      toolResponse('read_file', 'c1', big),
      toolResponse('read_file', 'c2', big),
    ]);
    expect(output).toMatch(/Total: \d+\.\d{2} GiB/);
  });

  it('documents the rope caveat so the number is not misread against the heap', () => {
    const output = formatHistoryMemoryBreakdown([
      toolResponse('read_file', 'c1', 'a'.repeat(1_000)),
    ]);
    expect(output).toContain('lazy rope');
  });
});
