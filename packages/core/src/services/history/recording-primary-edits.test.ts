/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { VersionEdit } from '../../journal/groupEdits.js';
import { encodeContentRow } from './journalRowCodec.js';
import { recordingAcceptsEdits } from './recording-primary-edits.js';

const facts: VersionEdit = {
  kind: 'factIndex',
  registration: {
    scope: 'recording-owner-test',
    async write(_snapshot, writer, generation): Promise<void> {
      await writer.set(['version'], generation);
    },
  },
};

describe('native fact fill recording ownership', () => {
  it('admits metadata-only registration on a selected recording primary', () => {
    expect(recordingAcceptsEdits([facts], 7, 'selected', false)).toBe(true);
  });

  it('does not let metadata registration authorize foreign grouped rows', () => {
    const row = encodeContentRow(
      { speaker: 'human', blocks: [{ type: 'text', text: 'foreign' }] },
      { owner: 8 },
    );
    expect(
      recordingAcceptsEdits(
        [facts, { kind: 'append', rows: [row] }],
        7,
        'selected',
        false,
      ),
    ).toBe(false);
    expect(
      recordingAcceptsEdits(
        [facts, { kind: 'replace', rows: [row] }],
        7,
        'selected',
        false,
      ),
    ).toBe(false);
  });

  it('still admits shared and selected-owner rows alongside metadata', () => {
    const rows = [0, 7].map((owner) =>
      encodeContentRow(
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: `owner ${owner}` }],
        },
        { owner },
      ),
    );
    expect(
      recordingAcceptsEdits(
        [facts, { kind: 'append', rows }],
        7,
        'selected',
        false,
      ),
    ).toBe(true);
  });
});
