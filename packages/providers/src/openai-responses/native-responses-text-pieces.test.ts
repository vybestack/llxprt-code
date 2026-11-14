/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { journalSendFixture } from '../__tests__/support/journal-send-fixture.js';
import {
  isTextResponsePlan,
  nativeTextResponsePieces,
} from './native-responses-text-pieces.js';

describe('native Responses block-stream text transport', () => {
  const speakers: ReadonlyArray<IContent['speaker']> = ['human', 'ai'];
  for (const speaker of speakers) {
    it(`preserves ${speaker} separators and surrogate pairs across blocks and slices`, async () => {
      const texts = [
        '',
        'x'.repeat(8191) + '\ud83d',
        '\ude00\n"\\\t',
        '',
        '\ud800',
      ];
      const row: IContent = {
        speaker,
        blocks: texts.map((text) => ({ type: 'text', text })),
      };
      const fixture = await journalSendFixture([row], [], {
        directory: 'tmp/r4i-agent-record/text-pieces',
      });
      try {
        const indexed = fixture.selection.native?.indexed;
        if (indexed === undefined) throw new Error('Missing native index');
        const plan = await indexed.planAt(0);
        expect(isTextResponsePlan(plan)).toBe(true);
        let output = '';
        for await (const piece of nativeTextResponsePieces(plan, ',')) {
          expect(piece.wire.byteLength).toBeLessThan(64 * 1024);
          output += Buffer.from(piece.wire).toString('utf8');
          expect(piece.diagnostic()).toStrictEqual(piece.wire);
        }
        expect(output).toBe(
          ',' +
            JSON.stringify({
              role: speaker === 'human' ? 'user' : 'assistant',
              content: texts.join(speaker === 'human' ? '\n' : ''),
            }),
        );
      } finally {
        await fixture.close();
      }
    });
  }
});
