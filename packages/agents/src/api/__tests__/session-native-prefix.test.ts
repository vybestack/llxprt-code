/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { describe, expect, it } from 'bun:test';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';
import { exactTokenizer } from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import { operationFileCreates } from '../../compression/__tests__/support/operation-file-creates.js';
import {
  buildAgent,
  drain,
  internalAgentClient,
} from './helpers/agentHarness.js';
import { collectAgentHistory } from './helpers/collect-agent-history.js';

function fixtureRow(index: number): IContent {
  return {
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [{ type: 'text', text: `prefix value ${index}` }],
  };
}

describe('native public session prefix mutations', () => {
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

interface PrefixState {
  readonly bytes: string;
  readonly tokens: number;
}

async function prefixStates(
  root: string,
  size: number,
  backend: 'old' | 'journal',
): Promise<PrefixState[]> {
  {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      workingDir: root,
    });
    try {
      await drain(agent.stream('initialize session'));
      const history = internalAgentClient(agent).getHistoryService();
      if (history === null) throw new Error('Missing prefix history');
      history.setTokenizerFactory(exactTokenizer());
      await agent.setHistory(
        Array.from({ length: size }, (_, index) => fixtureRow(index)),
      );
      await agent.session.setRecording({ enabled: true });
      const states: PrefixState[] = [];
      const capture = async (): Promise<void> => {
        const contents = await collectAgentHistory(agent);
        states.push({
          bytes: JSON.stringify(
            contents.map(({ speaker, blocks }) => ({ speaker, blocks })),
          ),
          tokens: history.getTotalTokens(),
        });
      };
      const run = async (): Promise<void> => {
        expect((await agent.session.restoreTurns(1)).itemsRemoved).toBe(2);
        await capture();
        await agent.resetChat();
        await capture();
      };
      if (backend === 'journal') {
        const receipt = await operationFileCreates(run, true);
        expect(receipt).toStrictEqual({ directories: [], files: [] });
      } else await run();
      return states;
    } finally {
      await cleanup();
    }
  }
}

describe('native public prefix old-array parity', () => {
  const directory = useTempDir('native-prefix-array-parity-');
  for (const size of [512, 8192]) {
    it(`matches independent old-backend prefix bytes and successful tokens over ${size} rows`, async () => {
      const expected = await prefixStates(directory(), size, 'old');
      expect(expected.map(({ bytes }) => bytes)).toStrictEqual([
        JSON.stringify(
          Array.from({ length: size - 2 }, (_, index) => fixtureRow(index)),
        ),
        JSON.stringify([fixtureRow(0), fixtureRow(1)]),
      ]);
      expect(await prefixStates(directory(), size, 'journal')).toStrictEqual(
        expected,
      );
    });
  }
});
