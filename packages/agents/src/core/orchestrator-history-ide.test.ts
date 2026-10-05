/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { ideContext } from '@vybestack/llxprt-code-ide-integration';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  sendHistoryTurn,
  withOrchestratorHistory,
} from './orchestrator-history-test-helpers.js';

async function observedIdeContext(
  size: number,
  pending: boolean,
): Promise<string[]> {
  const previous = ideContext.getIdeContext();
  ideContext.setIdeContext({
    workspaceState: {
      openFiles: [
        {
          path: '/workspace/a.ts',
          timestamp: 1,
          isActive: true,
          selectedText: 'selected\ntext',
          cursor: { line: 2, character: 3 },
        },
      ],
    },
  });
  try {
    return await withOrchestratorHistory(
      size,
      async (client, history, reader, config) => {
        config.setIdeMode(true);
        if (!pending) {
          history.add({
            speaker: 'human',
            blocks: [{ type: 'text', text: 'next human turn' }],
          });
          await history.waitForCommit();
        }
        const context: string[] = [];
        const observe = (row: IContent): void => {
          for (const block of row.blocks) {
            if (
              block.type === 'text' &&
              block.text.startsWith("Here is the user's editor context")
            )
              context.push(block.text);
          }
        };
        history.on('contentAdded', observe);
        try {
          expect(await sendHistoryTurn(client)).toContain('a plain text reply');
          expect(reader.snapshot().liveRows).toBe(0);
          return context;
        } finally {
          history.off('contentAdded', observe);
        }
      },
    );
  } finally {
    if (previous === undefined) ideContext.clearIdeContext();
    else ideContext.setIdeContext(previous);
  }
}

for (const size of [512, 8192]) {
  describe(`IDE publication after ${size} mixed history rows`, () => {
    it('suppresses IDE publication when the final AI row contains a tool call', async () => {
      expect(await observedIdeContext(size, true)).toStrictEqual([]);
    }, 120_000);

    it('publishes the unchanged full IDE bytes after a later human row', async () => {
      const expected = [
        "Here is the user's editor context as a JSON object. This is for your information only.",
        '```json',
        JSON.stringify(
          {
            activeFile: {
              path: '/workspace/a.ts',
              cursor: { line: 2, character: 3 },
              selectedText: 'selected\ntext',
            },
          },
          null,
          2,
        ),
        '```',
      ].join('\n');
      expect(await observedIdeContext(size, false)).toStrictEqual([expected]);
    }, 120_000);
  });
}

describe('empty orchestrator history IDE publication', () => {
  it('publishes a full IDE snapshot without an eager empty-array read', async () => {
    const context = await observedIdeContext(0, true);
    expect(context).toHaveLength(1);
    expect(context[0]).toContain('"selectedText": "selected\\ntext"');
  }, 120_000);
});
