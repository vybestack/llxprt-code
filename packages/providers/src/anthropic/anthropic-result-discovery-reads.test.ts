/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { anthropicRepairFactIndex } from './anthropic-repair-fact-writer.js';
import { AnthropicStreamRepair } from './anthropic-stream-repair.js';
import { repairSettings } from './anthropic-stream-repair.test.js';

async function readResults(engine: AnthropicStreamRepair): Promise<number> {
  let results = 0;
  for await (const atom of engine.atoms()) {
    if (atom.results !== true) continue;
    for await (const piece of atom.openPieces()) {
      expect(JSON.stringify(piece)).toContain(
        `result ${Math.floor(atom.key / 4)}`,
      );
      results++;
    }
  }
  return results;
}

describe('native Anthropic tool-result discovery', () => {
  const directory = useTempDir('anthropic-result-discovery-');
  it.each([40, 4000])(
    'discovers %s alternating tool-heavy atoms without decoding result payloads',
    async (count) => {
      const session = await JournalSession.create(
        `${directory()}/${count}.llxj`,
        { journal: testJournalSeams().dependencies },
      );
      try {
        await session.append(
          Array.from({ length: count }, (_, at): IContent => {
            const id = `call_${Math.floor(at / 4)}`;
            if (at % 4 === 1)
              return {
                speaker: 'ai',
                blocks: [
                  { type: 'tool_call', id, name: 'read', parameters: {} },
                ],
              };
            if (at % 4 === 2)
              return {
                speaker: 'tool',
                blocks: [
                  {
                    type: 'tool_response',
                    callId: id,
                    toolName: 'read',
                    result: `result ${at}`,
                  },
                ],
              };
            return {
              speaker: at % 4 === 0 ? 'human' : 'ai',
              blocks: [{ type: 'text', text: `text ${at}` }],
            };
          }),
        );
        await session.store.commit([
          {
            kind: 'factIndex',
            registration: anthropicRepairFactIndex(repairSettings),
          },
        ]);
        const pin = await session.store.snapshot();
        const query = await IndexedJournalRequestSnapshot.create(pin);
        try {
          const engine = await AnthropicStreamRepair.create(
            query,
            repairSettings,
          );
          const atoms: Array<{ key: number; role: string }> = [];
          for await (const atom of engine.atoms())
            atoms.push({ key: atom.key, role: atom.role });
          expect(atoms).toStrictEqual(
            Array.from({ length: count }, (_, at) => ({
              key: at * 4 + Number(at % 4 !== 2),
              role: at % 2 === 0 ? 'user' : 'assistant',
            })),
          );
          expect(engine.source.work.unitReads).toBe(0);
          expect(engine.tools.work.takenQueries).toBe(0);
          expect(engine.tools.work.decisions).toBe(0);
          expect(await readResults(engine)).toBe(count / 4);
          expect(engine.tools.work.takenQueries).toBe(0);
        } finally {
          await query.close();
          await pin.close();
        }
      } finally {
        await session.close();
      }
    },
  );
});
