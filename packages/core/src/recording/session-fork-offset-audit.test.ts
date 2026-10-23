/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { mapContents } from '../journal/__tests__/support/copyFixtures.js';
import {
  MISTRAL_SLOT,
  writeMistralSource,
} from '../journal/__tests__/support/handBuiltSource.js';
import {
  pair,
  realMapping,
  type MistralRow,
} from '../journal/__tests__/support/mistralFixtures.js';
import { OffsetAudit } from '../journal/__tests__/support/offsetAudit.js';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { OwnerDictionary } from '../journal/ownerDictionary.js';
import { readVersionAt } from '../journal/trailerAccess.js';
import type { IContent } from '../services/history/IContent.js';
import { encodeContentRow } from '../services/history/journalRowCodec.js';
import { JournalSession } from '../services/history/journalSession.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { sessionFactEdit } from './sessionEdits.js';
import { journalSessionFileName } from './sessionFileName.js';
import { SESSION_KEYS } from './sessionMetaKeys.js';

import {
  forkCheckpoint,
  ownedRows,
  useForkProof,
} from './__tests__/support/forkProof.js';
import {
  PROJECT,
  chatsDirIn,
  journalSeams,
  userRow,
} from './__tests__/support/recordedJournals.js';

function contentOf(row: MistralRow): IContent {
  return row.speaker === 'ai'
    ? {
        speaker: 'ai',
        blocks: [{ type: 'tool_call', id: row.id, name: 'n', parameters: {} }],
      }
    : {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: row.id,
            toolName: 'n',
            result: 'result',
          },
        ],
      };
}

async function mappedId(session: JournalSession, id: string): Promise<string> {
  const snapshot = await session.store.snapshot();
  try {
    const mapped = await snapshot.mistralMapping(id, MISTRAL_SLOT);
    if (mapped === undefined) throw new Error(`Missing mapped fact ${id}`);
    return mapped.id;
  } finally {
    await snapshot.close();
  }
}

async function portableState(
  session: JournalSession,
): Promise<Map<string, string>> {
  return new Map(
    [...(await mapContents(session.store, 'state'))].filter(
      ([key]) => !key.startsWith('session:') && !key.startsWith('ckpt:'),
    ),
  );
}

async function auditForkOffsets(child: JournalSession): Promise<void> {
  const read = await child.store.openRead();
  try {
    if (read.version === undefined) throw new Error('No child version');
    const audit = new OffsetAudit(read.access);
    await audit.walkVersion(read.version, false);
    const met = [...audit.checked.keys()].map(
      (field) => `${field.record}.${field.field}`,
    );
    for (const field of [
      'ChildSlot.childOffset',
      'IdFact.mappedRef',
      'RowEntry.lensRef',
      'RowEntry.recordOffset',
      'MetaMapEntry.valueRef',
      'StateMapEntry.valueRef',
      'TrailerHeader.parent',
    ])
      expect(met).toContain(field);
  } finally {
    await read.close();
  }
}

describe('service checkpoint forks have no source-file offsets', () => {
  const directory = useTempDir('service-fork-offsets-');

  const proof = useForkProof();

  it('reopens and audits forks before and after retained-checkpoint compaction with the source deleted', async () => {
    const chats = chatsDirIn(directory());
    await fs.mkdir(chats, { recursive: true });
    const sourcePath = path.join(chats, journalSessionFileName('mapped'));
    const rawId = 'toolu_alpha-1';
    const holder = realMapping(pair(rawId)).get(rawId);
    if (holder === undefined) throw new Error('No collision holder');
    const rows = [
      ...pair(holder),
      ...pair(rawId),
      ...pair('extra-1'),
      ...pair('extra-2'),
    ];
    const mapping = realMapping(rows);
    expect(mapping.get(rawId)).not.toBe(holder);
    await writeMistralSource(
      sourcePath,
      rows,
      mapping,
      rows.map((row, index) =>
        encodeContentRow(contentOf(row), { owner: 1 + (index % 2) }),
      ),
    );
    const seeded = await JournalSession.open(sourcePath, journalSeams());
    await seeded.store.commit([{ kind: 'mistral', slot: MISTRAL_SLOT }]);
    await seeded.store.commit([
      {
        kind: 'setState',
        key: 'owner:next',
        value: new TextEncoder().encode('4'),
      },
      sessionFactEdit(SESSION_KEYS.id, 'mapped'),
      sessionFactEdit(SESSION_KEYS.start, {
        startTime: new Date().toISOString(),
        projectHash: PROJECT,
        workspaceDirs: ['/work'],
        kind: 'main',
      }),
      sessionFactEdit(SESSION_KEYS.provider, {
        provider: 'mistral',
        model: 'model',
      }),
    ]);
    await seeded.close();
    const recording = proof.keep(
      await JournalRecordingService.open(
        {
          sessionId: 'mapped',
          projectHash: PROJECT,
          chatsDir: chats,
          workspaceDirs: ['/work'],
          provider: 'mistral',
          model: 'model',
          journal: journalSeams(),
        },
        sourcePath,
      ),
    );
    const session = await recording.session();
    const owners = await OwnerDictionary.load(session.store);
    for (const [position, origin] of [
      'agent:beta',
      'subagent:gamma/7',
    ].entries()) {
      const owner = owners.prepare(origin);
      const entries = await Array.fromAsync(session.store.rows());
      await session.store.commit([
        ...owner.edits,
        {
          kind: 'owner',
          changes: [{ label: entries[position].label, owner: owner.id }],
        },
      ]);
      owners.confirm(owner);
    }
    const checkpoint = await recording.createCheckpoint('retained');
    await session.append([userRow('saved shared row')]);
    const expected = await ownedRows(session);
    const expectedMeta = await mapContents(session.store, 'meta');
    const expectedState = await portableState(session);
    const expectedOwners = [
      ...(await OwnerDictionary.load(session.store)).entries(),
    ];
    await recording.createCheckpoint('fork-point');
    await session.append([userRow('not in fork')]);
    const first = await forkCheckpoint(chats, 'fork-point');
    proof.keep(first.recording);
    const retained = await session.store.checkpoint(checkpoint.checkpointId);
    if (retained === undefined) throw new Error('No retained checkpoint');
    const sourceRef = retained.trailerOffset;
    await session.store.compact();
    const read = await session.store.openRead();
    try {
      if (read.version === undefined) throw new Error('No compacted version');
      const audit = new OffsetAudit(read.access);
      await audit.walkVersion(read.version);
      expect([...audit.checked.keys()].map((field) => field.field)).toContain(
        'trailerOffset',
      );
      const copied = await session.store.checkpoint(checkpoint.checkpointId);
      if (copied === undefined) throw new Error('No copied checkpoint');
      expect(copied.trailerOffset).not.toBe(sourceRef);
      expect(
        (await readVersionAt(read.access, copied.trailerOffset)).rows,
      ).toBe(rows.length);
    } finally {
      await read.close();
    }
    const second = await forkCheckpoint(chats, 'fork-point');
    proof.keep(second.recording);
    const children = [
      first.recording.getFilePath(),
      second.recording.getFilePath(),
    ];
    await recording.dispose();
    await fs.unlink(sourcePath);
    for (const result of [first, second]) await result.recording.dispose();
    for (const childPath of children) {
      if (childPath === null) throw new Error('No child file');
      const child = await JournalSession.open(childPath, journalSeams());
      try {
        expect(await ownedRows(child)).toStrictEqual(expected);
        expect(await mapContents(child.store, 'meta')).toStrictEqual(
          expectedMeta,
        );
        expect(await portableState(child)).toStrictEqual(expectedState);
        expect([
          ...(await OwnerDictionary.load(child.store)).entries(),
        ]).toStrictEqual(expectedOwners);
        expect(
          [...(await mapContents(child.store, 'state')).keys()].filter((key) =>
            key.startsWith('ckpt:'),
          ),
        ).toStrictEqual([]);
        await auditForkOffsets(child);
        for (const [id, mapped] of mapping)
          expect(await mappedId(child, id)).toBe(mapped);
      } finally {
        await child.close();
      }
    }
  });
});
