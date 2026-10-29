/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import { mediaParticipant } from './chronology-rollback-test-helpers.js';

function textRow(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

describe('HistoryService mutations that return promises', () => {
  let history: HistoryService;
  beforeEach(() => {
    history = new HistoryService();
  });
  afterEach(async () => {
    await history.dispose();
  });

  it('clear() returns a promise that settles after clearing the committed history', async () => {
    history.add(textRow('one'));
    history.add(textRow('two'));

    const cleared = history.clear();

    expect(cleared).toBeInstanceOf(Promise);
    await cleared;
    expect(history.length()).toBe(0);
  });

  it('a clear queued during compression settles only when the queue flushes', async () => {
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
    history.add(textRow('one'));
    await history.waitForCommit();
    const failure = new Error('clear observer failed');
    history.once('tokensUpdated', () => {
      throw failure;
    });
    history.startCompression();
    const cleared = history.clear();

    history.endCompression();
    await expect(cleared).rejects.toBe(failure);
    await expect(history.waitForPendingOperations()).rejects.toBe(failure);
    expect(history.length()).toBe(1);
  });

  it('validateAndFix() and registerMediaOwner() return promises', async () => {
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
