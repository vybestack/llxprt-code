/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { useCommandOwners } from '../__tests__/command-owner-fixture.js';
import { getInteractiveTranscriptPath } from './transcriptPath.js';

describe('transcript path owner reads', () => {
  const makeOwner = useCommandOwners();
  it('selects live owned or raw paths without consulting conflicting session collaborators', async () => {
    const owner = await makeOwner('transcript-path-owner');
    const sibling = await makeOwner('transcript-path-sibling');
    await owner.setHistory([
      { speaker: 'human', blocks: [{ type: 'text', text: 'owned recording' }] },
    ]);
    await owner.session.setRecording({ enabled: true });
    const readOwnedPath = Object.assign(
      () => owner.session.getRecording().path,
      { session: sibling.session },
    );
    const readRawPath = () => sibling.session.getRecording().path;
    const initial = owner.session.getRecording().path;
    if (!initial) throw new Error('Missing owned transcript');
    expect(
      getInteractiveTranscriptPath('agent', readOwnedPath, readRawPath),
    ).toBe(initial);
    await owner.session.setRecording({ enabled: false });
    expect(
      getInteractiveTranscriptPath('agent', readOwnedPath, readRawPath),
    ).toBeUndefined();
    await sibling.setHistory([
      { speaker: 'human', blocks: [{ type: 'text', text: 'raw recording' }] },
    ]);
    await sibling.session.setRecording({ enabled: true });
    expect(
      getInteractiveTranscriptPath('raw', readOwnedPath, readRawPath),
    ).toBe(sibling.session.getRecording().path);
    await owner.dispose();
    expect(
      getInteractiveTranscriptPath(
        undefined,
        () => {
          throw new Error('Retired session must not be read');
        },
        readRawPath,
      ),
    ).toBe(sibling.session.getRecording().path);
  });
});
