/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import type { TextBlock } from './IContent.js';
import { VersionSnapshot } from '../../journal/versionSnapshot.js';
import {
  withAccountingFixture,
  accountingFactory,
  deferred,
} from './__tests__/support/token-accounting-stream-test-helpers.js';

describe('journal token tickets without scratch storage', () => {
  it('settles an active journal row read before disposal closes the journal', async () => {
    await withAccountingFixture(0, async (history) => {
      const entered = deferred();
      const release = deferred();
      const original = VersionSnapshot.prototype.readRow;
      let reading = true;
      const read = spyOn(
        VersionSnapshot.prototype,
        'readRow',
      ).mockImplementation(async function (this: VersionSnapshot, entry) {
        entered.resolve();
        await release.promise;
        try {
          return await original.call(this, entry);
        } finally {
          reading = false;
        }
      });
      try {
        history.add({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'pending read' }],
        });
        history.add({
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'evict the one-row handoff' }],
        });
        await entered.promise;
        const disposal = history.dispose();
        const closedWhileReading = disposal.then(() => reading);
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        release.resolve();
        expect(await closedWhileReading).toBe(false);
        await history.waitForTokenUpdates();
      } finally {
        release.resolve();
        read.mockRestore();
      }
    });
  });

  it('accounts added rows while filesystem creation is denied', async () => {
    await withAccountingFixture(0, async (history) => {
      history.setTokenizerFactory(accountingFactory((text) => text.length));
      const denied = (): never => {
        throw new Error('Token estimate attempted temporary file creation');
      };
      const nativeOpen = fs.promises.open;
      const guards = [
        spyOn(fs, 'mkdtempSync').mockImplementation(denied),
        spyOn(fs, 'openSync').mockImplementation(denied),
        spyOn(fs.promises, 'mkdtemp').mockImplementation(denied),
        spyOn(fs.promises, 'open').mockImplementation((path, flags, mode) => {
          if (typeof flags === 'string' && /[wax]/.test(flags)) denied();
          if (typeof flags === 'number' && (flags & fs.constants.O_CREAT) !== 0)
            denied();
          return nativeOpen(path, flags, mode);
        }),
      ];
      try {
        history.add({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'snow 雪' }],
        });
        history.add({
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'answer' }],
        });
        await history.waitForTokenUpdates();
        expect(history.getTotalTokens()).toBe(
          'snow 雪'.length + 'answer'.length,
        );
      } finally {
        for (const guard of guards) guard.mockRestore();
      }
    });
  });

  it('counts original journal values while later input changes behind a suspended tokenizer', async () => {
    await withAccountingFixture(0, async (history) => {
      const entered = deferred();
      const release = deferred();
      history.setTokenizerFactory(
        accountingFactory(async (text) => {
          entered.resolve();
          await release.promise;
          return text.length;
        }),
      );
      history.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'first' }],
      });
      await entered.promise;
      const block: TextBlock = { type: 'text', text: 'original' };
      history.add({ speaker: 'ai', blocks: [block] });
      block.text = 'mutated';
      release.resolve();
      await history.waitForTokenUpdates();
      expect(history.getTotalTokens()).toBe('first'.length + 'original'.length);
      await history.clear();
      expect(history.getTotalTokens()).toBe(0);
    });
  });
});
