/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core';
import { RowOwnership } from '../../../../core/src/recording/rowOwnership.js';
import { streamHistoryItems } from './streamHistoryItems.js';

describe('controlled streaming cancellation', () => {
  it('aborts an explicitly cancellable pending source, awaits its closure and publishes no late item', async () => {
    const directory = await mkdtemp(
      join(process.cwd(), 'tmp/verify854/p05d/toolpaging-abort-'),
    );
    const controller = new AbortController();
    const ownership = new RowOwnership();
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    let released = false;
    let observedAbort = false;
    const source = async function* (
      signal: AbortSignal | undefined,
    ): AsyncIterable<IContent> {
      try {
        yield {
          speaker: 'ai',
          blocks: [
            { type: 'tool_call', id: 'a', name: 'read_file', parameters: {} },
          ],
        };
        yield {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'a',
              toolName: 'read_file',
              result: 'large'.repeat(10000),
            },
          ],
        };
        await new Promise<void>((resolve, reject) => {
          if (!signal) {
            enter();
            resolve();
            return;
          }
          signal.addEventListener(
            'abort',
            () => {
              observedAbort = true;
              reject(signal.reason);
            },
            { once: true },
          );
          enter();
        });
        yield { speaker: 'human', blocks: [{ type: 'text', text: 'late' }] };
      } finally {
        released = true;
      }
    };
    try {
      const iterator = streamHistoryItems(source, undefined, ownership, {
        temporaryRoot: directory,
        signal: controller.signal,
      })[Symbol.asyncIterator]();
      const pending = iterator.next();
      await entered;
      expect((await readdir(directory)).length).toBe(1);
      controller.abort(new Error('stop read'));
      await expect(pending).rejects.toThrow('stop read');
      expect(observedAbort).toBe(true);
      expect(released).toBe(true);
      expect(await iterator.next()).toStrictEqual({
        done: true,
        value: undefined,
      });
      expect(ownership.snapshot().liveRows).toBe(0);
      expect(await readdir(directory)).toStrictEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
