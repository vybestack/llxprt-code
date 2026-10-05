/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  SessionRecordingService,
  resumeSession,
  type IContent,
  type ResumeResult,
} from '@vybestack/llxprt-code-core';
import {
  buildAgent,
  internalConfig,
} from '../../../agents/src/api/__tests__/helpers/agentHarness.js';
import {
  restoreResumeBoot,
  admitResumeHistorySource,
} from './restoreResumeBoot.js';
import { AgentClient } from '../../../agents/src/core/client.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { accountingFactory } from '@vybestack/llxprt-code-core/services/history/token-accounting-stream-test-helpers.js';
import { suffixRow } from '@vybestack/llxprt-code-core/services/history/history-suffix-test-helpers.js';
import { createRowCounters } from '@vybestack/llxprt-code-core/recording/journalCounters.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';

function phase(
  size: number,
  name: string,
  owners?: RowOwnership,
  details?: object,
): void {
  const output = process.env.DEFERRED_CALLER_OUTPUT;
  if (output !== undefined)
    appendFileSync(
      output,
      `${JSON.stringify({ size, name, owners: owners?.snapshot(), ...details })}\n`,
    );
}

async function bodyDigest(rows: AsyncIterable<IContent>): Promise<{
  hash: string;
  bytes: number;
  tokens: number;
}> {
  const hash = createHash('sha256');
  let bytes = 0;
  let tokens = 0;
  for await (const row of rows) {
    const wire = JSON.stringify({ speaker: row.speaker, blocks: row.blocks });
    hash.update(wire);
    bytes += Buffer.byteLength(wire);
    for (const block of row.blocks) {
      if (block.type !== 'text') throw new Error('Expected text fixture');
      tokens += block.text.length;
    }
  }
  return { hash: hash.digest('hex'), bytes, tokens };
}

async function withDiskResume(
  size: number,
  run: (
    client: AgentClient,
    result: ResumeResult,
    owners: RowOwnership,
  ) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'deferred-restore-'));
  const recording = new SessionRecordingService({
    chatsDir: root,
    sessionId: 'source',
    projectHash: 'project',
    provider: 'fake',
    model: 'fake-model',
    workspaceDirs: [],
  });
  for (let index = 0; index < size; index++)
    await recording.commit('content', { content: suffixRow(index, 2048) });
  await recording.dispose();
  phase(size, 'recorded');
  const owners = new RowOwnership();
  const counters = createRowCounters();
  const result = await resumeSession({
    continueRef: 'source',
    chatsDir: root,
    projectHash: 'project',
    currentProvider: 'fake',
    currentModel: 'fake-model',
    workspaceDirs: [],
    counters: { ...counters.counters, ownership: owners },
  });
  if (!result.ok) throw new Error(result.error);
  phase(size, 'opened');
  const { agent, cleanup } = await buildAgent('plain-text.jsonl');
  const config = internalConfig(agent);
  config.setTokenizerFactory(accountingFactory((text) => text.length));
  const client = new AgentClient(
    config,
    createAgentRuntimeState({
      runtimeId: randomUUID(),
      provider: 'fake',
      model: 'fake-model',
    }),
  );
  try {
    await run(client, result, owners);
  } finally {
    await client.dispose();
    await cleanup();
    await result.boot.close();
    await result.recording.dispose();
    await result.lockHandle.release();
    await rm(root, { recursive: true, force: true });
  }
}

describe('real disk resume deferred caller', () => {
  for (const size of [512, 8192]) {
    it(`restores ${size} disk rows through deferred admission before authentication`, async () => {
      await withDiskResume(size, async (client, result, owners) => {
        const before = await bodyDigest(result.boot.streamRows());
        let published = false;
        await restoreResumeBoot(client, result.recording, result.boot, () => {
          published = true;
        });
        phase(size, 'admitted');
        expect(published).toBe(true);
        expect(client.hasChatInitialized()).toBe(false);
        const history = client.getHistoryService();
        if (history === null) throw new Error('Missing adopted history');
        expect(history.getTotalTokens()).toBe(before.tokens);
        let tokenDelta = 0;
        history.on('tokensUpdated', (event: { addedTokens: number }) => {
          tokenDelta += event.addedTokens;
        });
        const startup = performance.now();
        const chat = await client.startChat([]);
        const startupMs = performance.now() - startup;
        expect(startupMs).toBeLessThan(120_000);
        phase(size, 'started', owners, { startupMs });
        expect(client.hasChatInitialized()).toBe(true);
        expect(chat.getHistoryService()).toBe(history);
        expect(history.journalPath()).toBe(result.boot.filePath);
        expect(history.getTotalTokens() - history.getBaseTokenOffset()).toBe(
          before.tokens,
        );
        expect(tokenDelta).toBe(history.getBaseTokenOffset());
        const after = await bodyDigest(client.streamHistory());
        expect(after).toStrictEqual(before);
        phase(size, 'equivalent', owners, {
          before,
          after,
          tokenDelta,
          baseOffset: history.getBaseTokenOffset(),
        });
        expect(owners.snapshot().liveRows).toBe(0);
        expect(
          owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
        ).toBe(true);
        let index = 0;
        for await (const row of client.streamHistory())
          expect(row.blocks).toStrictEqual(suffixRow(index++, 2048).blocks);
        expect(index).toBe(size);
      });
    }, 120_000);
  }
});

describe('production resume source admission before journal attachment', () => {
  for (const size of [512, 8192]) {
    it(`admits ${size} real resume cursor rows and keeps the paused returned row charged`, async () => {
      await withDiskResume(size, async (client, result, owners) => {
        const history = await admitResumeHistorySource(client, result.boot);
        expect(client.hasChatInitialized()).toBe(false);
        expect(owners.snapshot().liveRows).toBe(0);
        expect(history.getContextRange().totalEntries).toBe(size);
        const cursor = client.streamHistory();
        const first = await cursor.next();
        if (first.done === true) throw new Error('Missing first admitted row');
        owners.retain(first.value);
        try {
          expect(first.value.blocks).toStrictEqual(suffixRow(0, 2048).blocks);
          expect(owners.snapshot().liveRows).toBe(1);
          expect(
            owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
          ).toBe(true);
          phase(size, 'paused-first-caller', owners);
        } finally {
          await cursor.return();
          owners.release(first.value);
        }
        expect(owners.snapshot().liveRows).toBe(0);
      });
    }, 120_000);
  }
});
