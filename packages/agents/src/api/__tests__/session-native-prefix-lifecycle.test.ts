import { capturedAgentClient } from './helpers/agent-client-observation.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { JournalHistoryStore } from '@vybestack/llxprt-code-core/services/history/journalHistoryStore.js';
import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { useTempDir } from './helpers/journal-fixture-support.js';
import { operationFileCreates } from '../../compression/__tests__/support/operation-file-creates.js';
import { AgentClient } from '../../core/client.js';
import type { Agent } from '../agent.js';
import { buildAgent, drain } from './helpers/agentHarness.js';
import { collectAgentHistory } from './helpers/collect-agent-history.js';

async function collectGarbage(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  Bun.gc(true);
}
function live(rows: ReadonlyArray<WeakRef<IContent>>): number {
  return rows.filter((value) => value.deref() !== undefined).length;
}
function bounded(rows: ReadonlyArray<WeakRef<IContent>>): void {
  expect(live(rows)).toBeLessThanOrEqual(2);
}

function row(index: number): IContent {
  return {
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [{ type: 'text', text: `prefix ${index}` }],
  };
}
const sessions = new Set<Promise<void>>();
function withSession(
  root: string,
  size: number,
  action: (agent: Agent) => Promise<void>,
): Promise<void> {
  const session = runSession(root, size, action);
  sessions.add(session);
  void session.then(
    () => sessions.delete(session),
    () => sessions.delete(session),
  );
  return session;
}
async function runSession(
  root: string,
  size: number,
  action: (agent: Agent) => Promise<void>,
): Promise<void> {
  const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
    workingDir: root,
  });
  try {
    await drain(agent.stream('initialize session'));
    await agent.setHistory(
      Array.from({ length: size }, (_, index) => row(index)),
    );
    await agent.session.setRecording({ enabled: true });
    await action(agent);
  } finally {
    await cleanup();
  }
}
async function blocks(agent: Agent): Promise<Array<IContent['blocks']>> {
  return (await collectAgentHistory(agent)).map((content) => content.blocks);
}

describe('native session prefix publication lifecycle', () => {
  afterEach(async () => {
    await Promise.allSettled(sessions);
  }, 60000);
  const directory = useTempDir('native-prefix-lifecycle-');
  it('denies creating APIs across roots for clear, restore and unchanged selections', async () => {
    await withSession(directory(), 65, async (agent) => {
      const receipt = await operationFileCreates(async () => {
        expect((await agent.session.restoreTurns(2)).itemsRemoved).toBe(3);
        expect((await agent.session.restoreTurns(0)).itemsRemoved).toBe(0);
        await agent.resetChat();
        await agent.resetChat();
      }, true);
      expect(receipt).toStrictEqual({ directories: [], files: [] });
      expect(await blocks(agent)).toStrictEqual([row(0).blocks, row(1).blocks]);
    });
  });

  for (const stage of ['producer', 'client-finalization']) {
    it(`restores the pinned version after ${stage} failure and continues on the same writer`, async () => {
      await withSession(directory(), 130, async (agent) => {
        const history = capturedAgentClient(agent).getHistoryService();
        if (history === null) throw new Error('Missing native history');
        const old = await history.openDumpSnapshot();
        const failure = new Error(`failed ${stage}`);
        const tokens = history.getTotalTokens();
        let converted = 0;
        const estimate = history.estimateTokensForContents.bind(history);
        const producer = spyOn(
          history,
          'estimateTokensForContents',
        ).mockImplementation(async (...args) => {
          if (stage === 'producer' && ++converted === 65) throw failure;
          return estimate(...args);
        });
        const finalize = spyOn(AgentClient.prototype, 'discardDeferredHistory');
        if (stage === 'client-finalization')
          finalize.mockRejectedValueOnce(failure);
        try {
          await expect(agent.session.restoreTurns(1)).rejects.toBe(failure);
          expect(history.getTotalTokens() - tokens).toBe(0);
          expect(await blocks(agent)).toStrictEqual(
            Array.from({ length: 130 }, (_, index) => row(index).blocks),
          );
        } finally {
          producer.mockRestore();
          finalize.mockRestore();
        }
        try {
          const receipt = await operationFileCreates(async () => {
            expect((await agent.session.restoreTurns(1)).itemsRemoved).toBe(2);
          }, true);
          expect(receipt).toStrictEqual({ directories: [], files: [] });
          expect(await blocks(agent)).toStrictEqual(
            Array.from({ length: 128 }, (_, index) => row(index).blocks),
          );
          const prior: Array<IContent['blocks']> = [];
          for await (const content of old.rows()) prior.push(content.blocks);
          expect(prior).toStrictEqual(
            Array.from({ length: 130 }, (_, index) => row(index).blocks),
          );
        } finally {
          await old.close();
        }
      });
    });
  }

  it('retains every byte of a greater-than-nine-MiB prefix value without snapshot files', async () => {
    await withSession(directory(), 3, async (agent) => {
      const text = 'x'.repeat(9 * 1024 * 1024 + 17);
      await agent.setHistory([
        { ...row(0), blocks: [{ type: 'text', text }] },
        row(1),
        row(2),
      ]);
      const receipt = await operationFileCreates(() => agent.resetChat(), true);
      expect(receipt).toStrictEqual({ directories: [], files: [] });
      expect(await blocks(agent)).toStrictEqual([
        [{ type: 'text', text }],
        row(1).blocks,
      ]);
    });
  });

  for (const size of [66]) {
    it(`releases actual prefix sink arguments at backpressure over ${size} rows`, async () => {
      await withSession(directory(), size, async (agent) => {
        const refs: Array<WeakRef<IContent>> = [];
        let samples = 0;
        let peak = 0;
        const publish = JournalHistoryStore.prototype.publishDetached;
        const observer = spyOn(
          JournalHistoryStore.prototype,
          'publishDetached',
        ).mockImplementation(function (
          this: JournalHistoryStore,
          task,
          host,
          model,
          options,
        ) {
          const transform = task.transform;
          if (transform === undefined)
            throw new Error('Missing native producer');
          return publish.call(
            this,
            {
              ...task,
              transform: async (source, sink) => {
                await transform(source, {
                  ...sink,
                  appendDerived: async (ordinal, content) => {
                    refs.push(new WeakRef(content));
                    await sink.appendDerived(ordinal, content);
                    if (refs.length % 8 === 0) {
                      await collectGarbage();
                      samples++;
                      peak = Math.max(peak, live(refs));
                      bounded(refs);
                    }
                  },
                });
              },
            },
            host,
            model,
            options,
          );
        });
        try {
          const receipt = await operationFileCreates(async () => {
            expect((await agent.session.restoreTurns(1)).itemsRemoved).toBe(2);
          }, true);
          expect(receipt).toStrictEqual({ directories: [], files: [] });
          await collectGarbage();
          expect(refs.length).toBe(size - 2);
          expect(samples).toBeGreaterThan(0);
          expect(live(refs)).toBe(0);
          expect(await blocks(agent)).toStrictEqual(
            Array.from({ length: size - 2 }, (_, index) => row(index).blocks),
          );
          process.stdout
            .write(`PREFIX_LIFETIME ${JSON.stringify({ size, outputs: refs.length, samples, peak, final: live(refs) })}
`);
        } finally {
          observer.mockRestore();
        }
      });
    });
  }

  it('removes all rows when more turns are requested than exist and accepts another turn', async () => {
    await withSession(directory(), 3, async (agent) => {
      const receipt = await operationFileCreates(async () => {
        expect((await agent.session.restoreTurns(10)).itemsRemoved).toBe(3);
      }, true);
      expect(receipt).toStrictEqual({ directories: [], files: [] });
      expect(await blocks(agent)).toStrictEqual([]);
      const history = capturedAgentClient(agent).getHistoryService();
      if (history === null) throw new Error('Missing native history');
      history.add(row(10));
      await history.waitForCommit();
      expect(await blocks(agent)).toStrictEqual([row(10).blocks]);
    });
  });
});
