/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdtemp, open, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { JournalProviderRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/journal-provider-request.js';
import { encodedRows } from '@vybestack/llxprt-code-core/services/history/journalPublication.js';
import type {
  RowFormatRegistration,
  RowFormatFill,
} from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import type { JournalOpenDependencies } from '@vybestack/llxprt-code-core/journal/journalWriterOpen.js';
import type { SessionProbe } from '../../../../test-utils/src/core/session-memory-protocol.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  realisticSessionRows,
  realisticSessionRowAt,
  type RealisticSessionRow,
  type RealisticSessionOptions,
} from '../../../../test-utils/src/core/realistic-session.js';

export function* nativeSessionRows(
  options: RealisticSessionOptions = {},
  stateful = false,
): Generator<IContent> {
  if (stateful) {
    yield {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'before parent' }],
    };
    yield {
      speaker: 'ai',
      metadata: { id: 'resp_parent', responsesStored: true },
      blocks: [{ type: 'text', text: 'stored answer' }],
    };
  }
  for (const row of realisticSessionRows(options)) yield nativeContent(row);
}

export function nativeReferenceRowAt(
  index: number,
  stateful: boolean,
): IContent {
  if (stateful && index < 2) {
    const row = nativeSessionRows({}, true).next().value;
    if (index === 0 && row !== undefined) return row;
    return {
      speaker: 'ai',
      metadata: { id: 'resp_parent', responsesStored: true },
      blocks: [{ type: 'text', text: 'stored answer' }],
    };
  }
  return nativeContent(realisticSessionRowAt(index - (stateful ? 2 : 0)));
}

function nativeContent(row: RealisticSessionRow): IContent {
  if (row.kind === 'text')
    return {
      speaker: row.role,
      metadata: { id: row.id },
      blocks: [{ type: 'text', text: row.text }],
    };
  if (row.kind === 'tool-call')
    return {
      speaker: 'ai',
      metadata: { id: row.id },
      blocks: [
        {
          type: 'tool_call',
          id: row.callId ?? '',
          name: 'read_file',
          parameters: { text: row.text },
        },
      ],
    };
  return {
    speaker: 'tool',
    metadata: { id: row.id },
    blocks: [
      {
        type: 'tool_response',
        callId: row.callId ?? '',
        toolName: 'read_file',
        result: row.text,
      },
    ],
  };
}

function observedJournalOpen(
  observe: (bytes: number) => Promise<void>,
): JournalOpenDependencies['open'] {
  return async (path, flags) => {
    const handle = await open(path, flags);
    return {
      fd: handle.fd,
      async read(buffer, offset, length, position) {
        const result = await handle.read(buffer, offset, length, position);
        await observe(result.bytesRead);
        return result;
      },
      write: (buffer, offset, length, position) =>
        handle.write(buffer, offset, length, position),
      writev: (buffers, position) => handle.writev(buffers, position),
      stat: () => handle.stat(),
      truncate: (length) => handle.truncate(length),
      close: () => handle.close(),
    };
  };
}

function observedMeasure(
  measure: RowFormatRegistration['measure'],
  probe: () => SessionProbe | undefined,
): RowFormatRegistration['measure'] {
  let rows = 0;
  return async (pin, entry, settings) => {
    const facts = await measure(pin, entry, settings);
    rows++;
    if (rows % 6250 === 0) await probe()?.checkpoint('conversion');
    return facts;
  };
}
function observedFill(
  fill: RowFormatFill,
  probe: () => SessionProbe | undefined,
): RowFormatFill {
  return {
    ...fill,
    measure: observedMeasure(fill.measure, probe),
    finish: () => fill.finish(),
    close: () => fill.close(),
  };
}
async function seedNativeSession(
  session: JournalSession,
  options: RealisticSessionOptions,
  stateful: boolean,
): Promise<void> {
  await session.store.commit([
    {
      kind: 'replace',
      rows: encodedRows(nativeSessionRows(options, stateful), 0),
    },
  ]);
}

export async function realisticNativeFixture(
  root: string,
  options: RealisticSessionOptions = {},
  stateful = false,
): Promise<{
  readonly selection: JournalProviderRequestSnapshot;
  readonly journalBytes: number;
  observe(probe: SessionProbe): void;
  close(): Promise<void>;
}> {
  const directory = await mkdtemp(join(root, 'journal-'));
  const file = join(directory, 'session.llxj');
  let activeProbe: SessionProbe | undefined;
  let kimiFilling = false;
  let kimiReadBytes = 0;
  let nextKimiCheckpoint = 16 * 1024 * 1024;
  const session = await JournalSession.create(file, {
    journal: {
      open: observedJournalOpen(async (bytes): Promise<void> => {
        if (!kimiFilling) return;
        kimiReadBytes += bytes;
        if (
          kimiReadBytes >= nextKimiCheckpoint &&
          nextKimiCheckpoint <= 48 * 1024 * 1024
        ) {
          nextKimiCheckpoint += 16 * 1024 * 1024;
          await activeProbe?.checkpoint('conversion');
        }
      }),
    },
  });
  await seedNativeSession(session, options, stateful);
  const snapshot = await session.store.snapshot();
  const selection = await JournalProviderRequestSnapshot.create(
    snapshot,
    [],
    {},
    undefined,
    () => snapshot.close(),
    (pin, registration) =>
      session.store.prepareSnapshotFormat(pin, {
        ...registration,
        measure: observedMeasure(registration.measure, () => activeProbe),
        ...(registration.prepare === undefined
          ? {}
          : {
              prepare: async (snapshot, settings) => {
                if (registration.prepare === undefined)
                  throw new Error('Missing fill');
                return observedFill(
                  await registration.prepare(snapshot, settings),
                  () => activeProbe,
                );
              },
            }),
      }),
    undefined,
    async (pin) => {
      kimiFilling = true;
      try {
        return await session.store.prepareSnapshotKimi(pin);
      } finally {
        kimiFilling = false;
      }
    },
  );
  return {
    selection,
    journalBytes: (await stat(file)).size,
    observe(probe): void {
      activeProbe = probe;
    },
    async close(): Promise<void> {
      await selection.close();
      await session.store.close();
      await rm(directory, { recursive: true });
    },
  };
}
