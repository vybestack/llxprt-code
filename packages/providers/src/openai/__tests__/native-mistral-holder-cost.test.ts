/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { VersionSnapshot } from '../../../../core/src/journal/versionSnapshot.js';
import { appendFileSync } from 'node:fs';
import { JournalSession } from '../../../../core/src/services/history/journalSession.js';
import { IndexedJournalRequestSnapshot } from '../../../../core/src/services/history/indexed-journal-request-snapshot.js';
import { testJournalSeams } from '../../../../core/src/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';
import type { IContent } from '../../../../core/src/services/history/IContent.js';
import { operationFileCreates } from '../../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import {
  plainChatLengthRegistration,
  planRequestChatMessages,
} from '../journal-chat-length.js';
import {
  legacyUnitTokens,
  oldMistralUnitTokens,
} from './support/mistral-unit-token-oracle.js';
import { oldTailUnits } from '../../../../core/src/services/history/__tests__/support/tail-query-oracle.js';
import { buildMessagesWithReasoning } from '../OpenAIRequestBuilder.js';
import {
  RECORD_KIND,
  isRecordKind,
} from '../../../../core/src/journal/recordKinds.js';
import type { RowFormatSettings } from '../../../../core/src/journal/rowFormat.js';

const settings: RowFormatSettings = {
  formatId: 'openai-chat:mistral',
  formatRev: 2,
  model: 'mistral-large-latest',
  endpoint: 'https://example.test/v1',
  isOAuth: false,
  toolNameTransform: 'none',
  supportsUrlImages: true,
  reasoningEnabled: false,
  reasoningFieldName: 'reasoning_content',
  mediaPdfEnabled: false,
  unsupportedMedia: 'notice',
  outputLimits: null,
  chat: { includeInContext: true, toolFormat: 'mistral' },
};
interface PhysicalRead {
  readonly position: number;
  readonly length: number;
  readonly kind: string;
  readonly caller: string;
}
function physicalAudit(): {
  readonly dependencies: ReturnType<typeof testJournalSeams>['dependencies'];
  readonly reads: PhysicalRead[];
  start(): void;
  stop(): void;
} {
  const seams = testJournalSeams({}, 1, false);
  const frames = new Map<number, { end: number; kind: string }>();
  const reads: PhysicalRead[] = [];
  let enabled = false;
  return {
    reads,
    start(): void {
      reads.length = 0;
      enabled = true;
    },
    stop(): void {
      enabled = false;
    },
    dependencies: {
      ...seams.dependencies,
      open: async (path, flags) => {
        const file = await seams.dependencies.open(path, flags);
        return {
          ...file,
          read: async (buffer, offset, length, position) => {
            const result = await file.read(buffer, offset, length, position);
            const bytes = Buffer.from(
              buffer.buffer,
              buffer.byteOffset + offset,
              result.bytesRead,
            );
            if (
              bytes.length >= 20 &&
              isRecordKind(bytes[0]) &&
              bytes[2] === 0 &&
              bytes[3] === 0
            ) {
              const end =
                position +
                24 +
                bytes.readUInt32LE(4) +
                Number(bytes.readBigUInt64LE(8));
              const kind = Object.entries(RECORD_KIND).find(
                ([, code]) => code === bytes[0],
              )?.[0];
              if (kind !== undefined && Number.isSafeInteger(end))
                frames.set(position, { end, kind });
            }
            if (enabled) {
              const frame =
                frames.get(position) ??
                [...frames.entries()].find(
                  ([start, value]) => position > start && position < value.end,
                )?.[1];
              reads.push({
                position,
                length: result.bytesRead,
                kind: frame?.kind ?? 'other',
                caller: new Error().stack ?? '',
              });
            }
            return result;
          },
        };
      },
    },
  };
}

function pendingCollision(
  collision: boolean,
  historicalId: string,
): readonly IContent[] {
  const displacedId = historicalId === '' ? '4Q3rUlnAu' : '4SftZvDMX';
  return [
    {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: collision ? displacedId : 'neutral',
          toolName: 'pending',
          result: 'done',
        },
      ],
    },
  ];
}

async function measuredCollision(
  pin: VersionSnapshot,
  collision: boolean,
  historicalId: string,
  measure: (messages: readonly unknown[]) => Promise<number>,
  expected: { readonly bytes: number; readonly tokens: number },
): Promise<void> {
  const receipt = await operationFileCreates(async () => {
    const request = await IndexedJournalRequestSnapshot.create(
      pin,
      pendingCollision(collision, historicalId),
    );
    try {
      const plan = await planRequestChatMessages(
        pin,
        request,
        settings,
        0,
        '',
        measure,
      );
      expect({ bytes: plan.bytes, tokens: plan.tokens }).toStrictEqual(
        expected,
      );
    } finally {
      await request.close();
    }
  }, true);
  expect(receipt).toStrictEqual({ files: [], directories: [] });
}
function recordCost(
  audit: ReturnType<typeof physicalAudit>,
  data: Record<string, number | boolean | string>,
): void {
  const kinds: Record<string, number> = {};
  for (const read of audit.reads)
    kinds[read.kind] = (kinds[read.kind] ?? 0) + 1;
  if (process.env.MISTRAL_HOLDER_COST_RECEIPT !== undefined)
    appendFileSync(
      process.env.MISTRAL_HOLDER_COST_RECEIPT,
      JSON.stringify({
        ...data,
        pid: process.pid,
        preads: audit.reads.length,
        bytes: audit.reads.reduce((sum, item) => sum + item.length, 0),
        kinds,
        reads: audit.reads,
      }) + '\n',
    );
}

describe('Mistral physical holder correction costs', () => {
  const directory = useTempDir('mistral-holder-cost-');
  it.each(
    [40, 400, 4000].flatMap((size) =>
      [false, true].flatMap((all) =>
        ['', 'toolu_alpha-1'].map((historicalId) => ({
          size,
          all,
          historicalId,
        })),
      ),
    ),
  )(
    'charges every positional read for $size rows all=$all id=$historicalId',
    async ({ size, all, historicalId }) => {
      const audit = physicalAudit();
      const session = await JournalSession.create(`${directory()}/cost.llxj`, {
        journal: audit.dependencies,
      });
      const rows: IContent[] = Array.from({ length: size }, (_, index) =>
        all || index < 3
          ? {
              speaker: 'ai',
              blocks: [
                {
                  type: 'tool_call',
                  id: historicalId,
                  name: `holder-${index}`,
                  parameters: {},
                },
              ],
            }
          : {
              speaker: 'human',
              blocks: [{ type: 'text', text: `unaffected-${index}` }],
            },
      );
      let holders = 0;
      let unrelated = 0;
      async function measure(messages: readonly unknown[]): Promise<number> {
        const text = JSON.stringify(messages);
        if (text.includes('holder-')) holders++;
        if (text.includes('unaffected-')) unrelated++;
        return legacyUnitTokens(messages);
      }
      try {
        await session.append(rows);
        await session.registerRowFormat(
          plainChatLengthRegistration(settings, measure),
        );
        const pin = await session.store.snapshot();
        try {
          for (const collision of [false, true]) {
            const units = await oldTailUnits(
              rows,
              pendingCollision(collision, historicalId),
            );
            const expected = {
              bytes: Buffer.byteLength(
                JSON.stringify([
                  { role: 'system', content: '' },
                  ...buildMessagesWithReasoning(
                    [...units],
                    {
                      invocation: {
                        ephemerals: { 'reasoning.includeInContext': true },
                      },
                    },
                    'mistral',
                    undefined,
                  ),
                ]),
              ),
              tokens: await oldMistralUnitTokens(units, 'none'),
            };
            holders = 0;
            unrelated = 0;
            const lookups = pin.facts.lookups;
            const started = performance.now();
            audit.start();
            await measuredCollision(
              pin,
              collision,
              historicalId,
              measure,
              expected,
            );
            audit.stop();
            const elapsedMs = performance.now() - started;
            const queries = pin.facts.lookups - lookups;
            expect(unrelated).toBe(0);
            const holderCount = all ? size : 3;
            const affected = historicalId === '' ? holderCount : 0;
            expect(holders).toBe(collision ? affected : 0);
            recordCost(audit, {
              size,
              all,
              historicalId,
              collision,
              holders,
              unrelated,
              queries,
              elapsedMs,
              rowWindowPeak: pin.rowWindowStats?.peakRetainedBytes ?? 0,
              rowWindowTransientPeak:
                pin.rowWindowStats?.peakTransientBytes ?? 0,
            });
            expect(pin.rowWindowStats?.peakRetainedBytes).toBeLessThanOrEqual(
              32768,
            );
            expect(pin.rowWindowStats?.peakTransientBytes).toBeLessThanOrEqual(
              49152,
            );
            expect(queries).toBeLessThanOrEqual(affected * 5 + 100);
            expect(audit.reads.length).toBeLessThanOrEqual(affected * 15 + 300);
            expect(
              audit.reads.reduce((sum, read) => sum + read.length, 0),
            ).toBeLessThanOrEqual(affected * 8192 + 2 * 1024 * 1024);
          }
        } finally {
          await pin.close();
        }
      } finally {
        await session.close();
      }
    },
  );
});
