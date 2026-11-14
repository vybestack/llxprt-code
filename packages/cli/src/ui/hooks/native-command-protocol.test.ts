import { captureSessionOwner } from '../../../../agents/src/api/__tests__/helpers/capture-session-owner.js';
import { commandDeps } from '../../__tests__/native-command-fixture.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { readJournalItems } from '../stores/turn/journal-turn-test-helpers.js';

import { createAgent, type Agent } from '@vybestack/llxprt-code-agents';
import {
  getProjectHash,
  LocalMediaStore,
  type MediaReferenceBlock,
} from '@vybestack/llxprt-code-core';
import {
  decodeSessionFact,
  SESSION_KEYS,
} from '@vybestack/llxprt-code-core/recording/sessionMetaKeys.js';
import { openJournalReadOnly } from '@vybestack/llxprt-code-core/journal/journalReader.js';
import { stateReaderOf } from '@vybestack/llxprt-code-core/journal/journalReaderState.js';
import { sha256KeyHash } from '@vybestack/llxprt-code-core/journal/idKeys.js';
import { streamRecordedRows } from '../../__tests__/journal-recording.js';
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import type { HistoryItemWithoutId, Message } from '../types.js';
import { processSlashCommand } from './slashCommandHandlers.js';

async function durable(path: string): Promise<{
  count: number;
  digest: string;
  media: MediaReferenceBlock | undefined;
}> {
  const hash = createHash('sha256');
  let count = 0;
  let media: MediaReferenceBlock | undefined;
  for await (const row of streamRecordedRows(path)) {
    count++;
    hash.update(JSON.stringify(row));
    const reference = row.blocks.find(
      (block) => block.type === 'media' && block.encoding === 'reference',
    );
    if (reference !== undefined) media = reference;
  }
  return { count, digest: hash.digest('hex'), media };
}

async function recording(agent: Agent): Promise<string> {
  await agent.session.flushRecording();
  const path = agent.session.getRecording().path;
  if (path === undefined) throw new Error('Missing native CLI recording');
  return path;
}

async function turn(agent: Agent, text: string): Promise<void> {
  let done = false;
  for await (const event of agent.stream(text)) {
    if (event.type === 'error') throw new Error(event.error.message);
    if (event.type === 'done') done = event.reason === 'stop';
  }
  expect(done).toBe(true);
}

describe('native CLI command protocol', () => {
  it('dispatches save, restore, continue and checkpoint forks through real owners with UI replay and rollback', async () => {
    const saved = { ...process.env };
    const root = await mkdtemp(join(tmpdir(), 'w23-cli-native-protocol-'));
    const fixture = join(root, 'turns.jsonl');
    await writeFile(
      fixture,
      (
        JSON.stringify({
          chunks: [
            {
              speaker: 'ai',
              blocks: [{ type: 'text', text: 'A recorded reply.' }],
            },
          ],
        }) + '\n'
      ).repeat(3),
    );

    process.env.LLXPRT_FAKE_RESPONSES = fixture;
    process.env.LLXPRT_LOG_HOME = join(root, 'logs');
    const { value: agent, owner } = await captureSessionOwner(() =>
      createAgent({
        provider: 'fake',
        model: 'fake-model',
        sessionId: 'cli-native-source',
        workingDir: root,
        interactive: true,
        folderTrust: true,
        coreTools: [],
      }),
    );
    let displayed: readonly HistoryItemWithoutId[] = [];
    const errors: Message[] = [];
    const context = createMockCommandContext({
      recordingOwner: 'agent',
      services: { agent },
      ui: {
        clear: () => {
          displayed = [];
        },
      },
    });
    const deps = commandDeps(context, errors);
    async function command(text: string): Promise<void> {
      expect(
        await processSlashCommand(deps, text, undefined, undefined, false),
      ).toStrictEqual({ type: 'handled' });
      displayed = await readJournalItems(agent, 64, true);
    }
    try {
      await agent.session.setRecording({ enabled: true });
      const image =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
      for await (const event of agent.stream([
        { type: 'text', text: 'question one' },
        {
          type: 'media',
          encoding: 'base64',
          mimeType: 'image/png',
          data: image,
        },
      ]))
        if (event.type === 'error') throw new Error(event.error.message);
      const source = await recording(agent);
      const initial = await durable(source);
      expect(initial.count).toBe(2);
      if (initial.media === undefined)
        throw new Error('Missing admitted image');
      const media = initial.media;
      const store = owner.clients.getAgentClient().mediaStore;
      if (store === undefined) throw new Error('Missing CLI media store');
      expect(
        Buffer.from(await store.readVerified(media)).toString('base64'),
      ).toBe(image);
      await command('/chat save milestone');
      expect(
        (await agent.session.listCheckpoints()).map(
          (checkpoint) => checkpoint.name,
        ),
      ).toStrictEqual(['milestone']);
      await turn(agent, 'question two');
      expect((await durable(await recording(agent))).count).toBe(4);
      await command('/chat restore 1');
      expect(displayed).toHaveLength(2);
      expect(await durable(await recording(agent))).toStrictEqual({
        ...initial,
      });
      await command('/continue milestone');
      const childId = agent.session.getSessionId();
      expect(childId).not.toBe('cli-native-source');
      expect(displayed).toHaveLength(2);
      const child = await recording(agent);
      expect(child).not.toBe(source);
      expect(await durable(child)).toStrictEqual({ ...initial });
      const journal = await openJournalReadOnly(child);
      try {
        const readState = stateReaderOf(journal, sha256KeyHash);
        const id = await readState(SESSION_KEYS.id);
        const start = await readState(SESSION_KEYS.start);
        if (id === undefined || start === undefined)
          throw new Error('Missing native identity facts');
        expect({ sessionId: decodeSessionFact(id) }).toStrictEqual({
          sessionId: childId,
        });
        expect(decodeSessionFact(start)).toMatchObject({
          projectHash: getProjectHash(root),
        });
        const fork = await readState(SESSION_KEYS.fork);
        if (fork === undefined) throw new Error('Missing checkpoint ancestry');
        expect(decodeSessionFact(fork)).toMatchObject({
          parentSessionId: 'cli-native-source',
          checkpointName: 'milestone',
        });
      } finally {
        await journal.close();
      }
      await turn(agent, 'child question');
      expect((await durable(await recording(agent))).count).toBe(4);
      expect(await durable(source)).toStrictEqual({ ...initial });
      await command('/chat resume milestone');
      expect({ sessionId: agent.session.getSessionId() }).not.toStrictEqual({
        sessionId: childId,
      });
      expect(await durable(await recording(agent))).toStrictEqual({
        ...initial,
      });
      const stableId = agent.session.getSessionId();
      const stablePath = await recording(agent);
      await command('/continue nonexistent-native-session');
      expect(errors).toHaveLength(1);
      expect({ sessionId: agent.session.getSessionId() }).toStrictEqual({
        sessionId: stableId,
      });
      expect(await durable(stablePath)).toStrictEqual({ ...initial });
      expect(
        (await readdir(join(stablePath, '..'))).filter((file) =>
          file.endsWith('.lock'),
        ),
      ).toHaveLength(1);
      expect(await store.hasReservations(media.contentId)).toBe(true);
      await agent.dispose();
      expect(
        (await readdir(join(stablePath, '..'))).filter((file) =>
          file.endsWith('.lock'),
        ),
      ).toStrictEqual([]);
      const archiveRoot = store.recordingArchive?.rootDirectory;
      if (archiveRoot === undefined)
        throw new Error('Missing recording archive');
      const observer = new LocalMediaStore({
        rootDirectory: store.rootDirectory,
        quotaBytes: 1024 * 1024,
      });
      const archive = new LocalMediaStore({
        rootDirectory: archiveRoot,
        quotaBytes: 1024 * 1024,
      });
      try {
        expect(await observer.hasReservations(media.contentId)).toBe(false);
        expect(
          Buffer.from(await archive.readVerified(media)).toString('base64'),
        ).toBe(image);
      } finally {
        await observer.close();
        await archive.close();
      }
      const { value: reopened, owner: reopenedOwner } =
        await captureSessionOwner(() =>
          createAgent({
            provider: 'fake',
            model: 'fake-model',
            sessionId: 'reopening-cli',
            workingDir: root,
            interactive: true,
            folderTrust: true,
            coreTools: [],
          }),
        );
      try {
        await reopened.session.resume(stableId);
        expect(await durable(await recording(reopened))).toStrictEqual(initial);
        const freshStore = reopenedOwner.clients.getAgentClient().mediaStore;
        if (freshStore === undefined)
          throw new Error('Missing reopened media owner');
        const bytes = await freshStore.readVerified(media);
        expect(Buffer.from(bytes).toString('base64')).toBe(image);
        expect(bytes.byteLength).toBe(media.selectedObject.byteLength);
        expect(
          `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        ).toBe(media.contentId);
        expect(freshStore.rootDirectory).not.toBe(store.rootDirectory);
        await turn(reopened, 'reopened image question');
        expect((await durable(await recording(reopened))).count).toBe(4);
      } finally {
        await reopened.dispose();
      }
    } finally {
      await agent.dispose();
      for (const key of ['LLXPRT_FAKE_RESPONSES', 'LLXPRT_LOG_HOME']) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  }, 30000);
});
