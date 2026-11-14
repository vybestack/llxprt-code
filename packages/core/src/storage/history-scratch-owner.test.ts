/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import { ScratchRootOwner } from './scratch-root.js';
import { HistoryMediaIndex } from './history-media-index.js';
import { HistoryDensityRows } from '../services/history/historyDensityRows.js';
import { DetachedHistoryJournal } from '../services/history/detachedHistoryJournal.js';

describe('history scratch ownership', () => {
  it('allocates density and detached rows in the supplied startup domain', () => {
    const owner = new ScratchRootOwner();
    const other = new ScratchRootOwner();
    const density = new HistoryDensityRows(owner);
    const detached = new DetachedHistoryJournal(owner);
    try {
      density.append({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'density' }],
      });
      detached.append({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'detached' }],
      });
      expect(readdirSync(owner.getRoot()).sort()).toStrictEqual([
        expect.stringMatching(/^history-density-/),
        expect.stringMatching(/^history-detached-/),
      ]);
      expect(readdirSync(other.getRoot())).toStrictEqual([]);
      expect([...density][0].blocks).toStrictEqual([
        { type: 'text', text: 'density' },
      ]);
      expect([...detached][0].blocks).toStrictEqual([
        { type: 'text', text: 'detached' },
      ]);
    } finally {
      density.close();
      detached.close();
      owner.removeRoot();
      other.removeRoot();
    }
  });

  it('keeps media index allocation lazy within the supplied domain', () => {
    const owner = new ScratchRootOwner();
    const index = new HistoryMediaIndex(owner);
    try {
      expect(index.has('missing')).toBe(false);
      expect(readdirSync(owner.getRoot())).toStrictEqual([]);
      index.close();
      expect(index.has('missing')).toBe(false);
    } finally {
      index.close();
      owner.removeRoot();
    }
  });
});
