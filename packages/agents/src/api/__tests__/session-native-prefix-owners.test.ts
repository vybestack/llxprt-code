/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { useNativePrefixBackend } from './helpers/native-prefix-backend.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { historyOriginId } from '@vybestack/llxprt-code-core/services/history/historyOriginId.js';
import {
  buildAgent,
  drain,
  internalAgentClient,
} from './helpers/agentHarness.js';
import { operationFileCreates } from '../../compression/__tests__/support/operation-file-creates.js';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';

function row(index: number): IContent {
  return {
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [{ type: 'text', text: `owned ${index}` }],
  };
}

describe('native public prefix current source owners', () => {
  useNativePrefixBackend();
  const directory = useTempDir('native-prefix-owners-');
  for (const size of [3, 64, 65, 5000]) {
    it(`preserves alternating current owners through restore and clear at ${size} rows`, async () => {
      const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
        workingDir: directory(),
      });
      const a = {};
      const b = {};
      try {
        await drain(agent.stream('initialize session'));
        const history = internalAgentClient(agent).getHistoryService();
        if (history === null) throw new Error('Missing native history');
        await history.clear();
        for (let index = 0; index < size; index++)
          history.add(row(index), undefined, index % 2 === 0 ? a : b);
        await history.waitForCommit();
        await agent.session.setRecording({ enabled: true });
        const receipt = await operationFileCreates(async () => {
          const cut = size % 2 === 0 ? size - 2 : size - 1;
          expect((await agent.session.restoreTurns(1)).itemsRemoved).toBe(
            size - cut,
          );
          await history.detachedValues.host().journal.readRows(async (view) => {
            const owners: Array<string | undefined> = [];
            for (let index = 0; index < view.length; index++)
              owners.push(await view.originAt(index));
            expect(owners).toStrictEqual(
              Array.from({ length: cut }, (_, index) =>
                historyOriginId(index % 2 === 0 ? a : b),
              ),
            );
          });
          await agent.resetChat();
          await history.detachedValues.host().journal.readRows(async (view) => {
            expect(view.length).toBe(2);
            expect(await view.originAt(0)).toBe(historyOriginId(a));
            expect(await view.originAt(1)).toBe(historyOriginId(b));
          });
        }, true);
        expect(receipt).toStrictEqual({ directories: [], files: [] });
      } finally {
        await cleanup();
      }
    });
  }
});
