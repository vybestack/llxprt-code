/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { buildAgent, drain } from './helpers/agentHarness.js';
import { collectAgentHistory } from './helpers/collect-agent-history.js';
import { operationFileCreates } from '../../compression/__tests__/support/operation-file-creates.js';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';
import { useNativePrefixBackend } from './helpers/native-prefix-backend.js';

function fixtureRow(index: number): IContent {
  return {
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [{ type: 'text', text: `prefix value ${index}` }],
  };
}

describe('native public session prefix mutations', () => {
  useNativePrefixBackend();
  const directory = useTempDir('native-session-prefix-');
  for (const size of [3, 64, 65, 5000]) {
    it(`clears ${size} rows without operation files and preserves the initial turn`, async () => {
      const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
        workingDir: directory(),
      });
      try {
        await drain(agent.stream('initialize session'));
        await agent.setHistory(
          Array.from({ length: size }, (_, i) => fixtureRow(i)),
        );
        await agent.session.setRecording({ enabled: true });
        const receipt = await operationFileCreates(() => agent.resetChat());
        expect(receipt).toStrictEqual({ directories: [], files: [] });
        expect(
          (await collectAgentHistory(agent)).map((row) => row.blocks),
        ).toStrictEqual([fixtureRow(0).blocks, fixtureRow(1).blocks]);
      } finally {
        await cleanup();
      }
    });
  }

  it('restores human-led turns without operation files', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      workingDir: directory(),
    });
    try {
      await drain(agent.stream('initialize session'));
      await agent.setHistory(
        Array.from({ length: 65 }, (_, i) => fixtureRow(i)),
      );
      await agent.session.setRecording({ enabled: true });
      let removed = 0;
      const receipt = await operationFileCreates(async () => {
        removed = (await agent.session.restoreTurns(2)).itemsRemoved;
      });
      expect(receipt).toStrictEqual({ directories: [], files: [] });
      expect(removed).toBe(3);
      expect(
        (await collectAgentHistory(agent)).map((row) => row.blocks),
      ).toStrictEqual(
        Array.from({ length: 62 }, (_, i) => fixtureRow(i).blocks),
      );
    } finally {
      await cleanup();
    }
  });
});
