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
import { legacyUnitTokens } from './support/mistral-unit-token-oracle.js';
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
              reads.push({ position, length, kind: frame?.kind ?? 'other' });
            }
            return result;
          },
        };
      },
    },
  };
}

async function measuredCollision(
  pin: VersionSnapshot,
  collision: boolean,
  measure: (messages: readonly unknown[]) => Promise<number>,
): Promise<void> {
  const receipt = await operationFileCreates(async () => {
    const request = await IndexedJournalRequestSnapshot.create(pin, [
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: collision ? '4Q3rUlnAu' : 'neutral',
            toolName: 'pending',
            result: 'done',
          },
        ],
      },
    ]);
    try {
      expect(
        (await planRequestChatMessages(pin, request, settings, 0, '', measure))
          .tokens,
      ).toBeGreaterThan(0);
    } finally {
      await request.close();
    }
  }, true);
  expect(receipt).toStrictEqual({ files: [], directories: [] });
}
function recordCost(
  audit: ReturnType<typeof physicalAudit>,
  data: Record<string, number | boolean>,
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
    [40, 4000].flatMap((size) => [false, true].map((all) => ({ size, all }))),
  )(
    'charges every positional read for $size rows all=$all',
    async ({ size, all }) => {
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
                  id: '',
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
            holders = 0;
            unrelated = 0;
            audit.start();
            await measuredCollision(pin, collision, measure);
            audit.stop();
            expect(unrelated).toBe(0);
            const affected = all ? size : 3;
            expect(holders).toBe(collision ? affected * 2 : 0);
            recordCost(audit, { size, all, collision, holders, unrelated });
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
