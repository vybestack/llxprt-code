/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';

export function assertJournalBorders(text: string): void {
  const lines = text.split('\n');
  for (const line of lines) {
    // Nested tool headers intentionally contain two left edges, but every
    // horizontal border must finish on the same physical terminal line.
    if (line.includes('╭')) expect(line, 'wrapped top border').toContain('╮');
    if (line.includes('╰'))
      expect(line, 'wrapped bottom border').toContain('╯');
    expect(line, 'orphaned border continuation').not.toMatch(/^─+[╮╯]?\s*$/);
    if (line.includes('RENDER_FINAL:')) {
      expect(line.trim(), 'answer overwritten by stale content').toBe(
        'RENDER_FINAL: the journal transcript is complete.',
      );
    }
    if (/RENDER-LINE-[0-9]/.test(line)) {
      expect(line, 'tool output overwritten by another region').toMatch(
        /^[ │]*RENDER-LINE-[0-9]{1,2}[ │]*$/,
      );
    }
    if (line.includes('Checking available reviewers')) {
      expect(line, 'thinking overwrote a box').not.toMatch(/[│╭╮╰╯]/);
    }
  }
  expect(text).not.toContain('history above was cleared');
}
