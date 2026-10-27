/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withJournalStreamHook } from './agentStream/__tests__/journal-stream-hook-fixture.js';

describe('journal-backed file inclusion', () => {
  it('displays the raw query while the model receives resolved file content after processing', async () => {
    const directory = await mkdtemp(join(process.cwd(), 'journal-include-'));
    const file = join(directory, 'notes.txt');
    await writeFile(file, 'Included notes: the deployment uses port 8123.');
    try {
      await withJournalStreamHook(
        [
          [
            {
              speaker: 'ai',
              blocks: [{ type: 'text', text: 'The deployment port is 8123.' }],
            },
          ],
        ],
        async ({ submit, items, agent }) => {
          const query = `@${file} Summarize this.`;
          await submit(query);
          const display = await items();
          expect(
            display
              .filter((item) => item.type === 'user')
              .map((item) => item.text),
          ).toStrictEqual([query]);
          const model = (await agent.session.getHistory()).filter(
            (item) => item.speaker === 'human',
          );
          const text = model
            .flatMap((item) => item.blocks)
            .flatMap((block) => (block.type === 'text' ? [block.text] : []))
            .join('');
          expect(text).toContain(
            'Included notes: the deployment uses port 8123.',
          );
          expect(text).toContain('Summarize this.');
          expect(display.find((item) => item.type === 'gemini')?.text).toBe(
            'The deployment port is 8123.',
          );
        },
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
