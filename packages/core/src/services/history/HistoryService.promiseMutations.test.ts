/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import { mediaParticipant } from './chronology-rollback-test-helpers.js';

function textRow(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

describe('HistoryService mutations that return promises', () => {
  it('clear() returns a promise and has already applied when it returns outside compression', async () => {
    const history = new HistoryService({ backend: 'old' });
    history.add(textRow('one'));
    history.add(textRow('two'));

    const cleared = history.clear();

    expect(cleared).toBeInstanceOf(Promise);
    expect(history.length()).toBe(0);
    await cleared;
  });

  it('a clear queued during compression settles only when the queue flushes', async () => {
    const history = new HistoryService();
    history.add(textRow('one'));
    history.startCompression();

    let settled = false;
    const cleared = history.clear().then(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(history.length()).toBe(1);

    history.endCompression();
    await cleared;

    expect(settled).toBe(true);
    expect(history.length()).toBe(0);
  });

  it('a queued clear rejects with the failure the flush reports', async () => {
    const history = new HistoryService({ backend: 'old' });
    history.add(textRow('one'));
    const failure = new Error('clear observer failed');
    history.once('tokensUpdated', () => {
      throw failure;
    });
    history.startCompression();
    const cleared = history.clear();

    expect(() => history.endCompression()).toThrow(failure);
    await expect(cleared).rejects.toBe(failure);
  });

  it('validateAndFix() and registerMediaOwner() return promises', async () => {
    const history = new HistoryService();
    history.add(textRow('one'));

    const fixed = history.validateAndFix();
    const registered = history.registerMediaOwner(
      mediaParticipant(() => ({ publish: () => {}, rollback: () => {} })),
    );

    expect(fixed).toBeInstanceOf(Promise);
    expect(registered).toBeInstanceOf(Promise);
    await fixed;
    await registered;
  });
});
