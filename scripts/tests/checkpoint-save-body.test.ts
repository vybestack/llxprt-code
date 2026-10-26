/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { tmpdir } from 'node:os';
import { writeBodyFile } from '../../packages/test-utils/src/body-evidence-writer.js';
import { describe, expect, it } from 'bun:test';
import { seedRows } from './support/body-summary-seed.js';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { withBatchFixture } from '../../packages/core/src/services/history/__tests__/support/addbatch-stream-test-helpers.js';
import { exactTokenizer } from '../../packages/core/src/services/history/chronology-rollback-test-helpers.js';
import { exportSummaryRow } from '../../packages/core/src/services/history/export-summary-test-helpers.js';
import type { IContent } from '../../packages/core/src/services/history/IContent.js';
import type { HistoryService } from '../../packages/core/src/services/history/HistoryService.js';
import { RequestMediaResolver } from '../../packages/core/src/storage/request-media-resolver.js';
import {
  buildAgent,
  internalAgentClient,
} from '../../packages/agents/src/api/__tests__/helpers/agentHarness.js';
import { bindClientTokenization } from '../../packages/agents/src/session/session-client-binding.js';
import { createToolCheckpoint } from '../../packages/cli/src/ui/hooks/agentStream/checkpointPersistence.js';
import {
  checkpointGit,
  checkpointTool,
  checkpointUiHistory,
  savedCheckpoint,
} from '../../packages/cli/src/ui/hooks/agentStream/checkpoint-disk-test-helpers.js';
import { restoreCommand } from '../../packages/cli/src/ui/commands/restoreCommand.js';
import { createMockCommandContext } from '../../packages/cli/src/__tests__/mockCommandContext.js';
import { captureCuratedBody } from './provider-curated-body-gemini.js';

async function bodyPairs(
  size: number,
  source: () => AsyncIterable<IContent>,
  resolver: RequestMediaResolver,
  checkpoint: string,
): Promise<void> {
  const expectedRows = Array.from({ length: size }, (_, index) =>
    exportSummaryRow(index),
  );
  let index = 0;
  for await (const row of source()) {
    const expected = expectedRows[index++];
    expect(row.speaker).toBe(expected.speaker);
    expect(row.metadata).toStrictEqual(expected.metadata);
    expect(row.blocks.filter((block) => block.type !== 'media')).toStrictEqual(
      expected.blocks.filter((block) => block.type !== 'media'),
    );
  }
  expect(index).toBe(size);
  for (const provider of ['anthropic', 'openai-responses', 'gemini']) {
    for (const caching of [false, true]) {
      const expected = await captureCuratedBody(
        provider,
        expectedRows,
        caching,
        false,
        false,
        undefined,
        resolver,
      );
      const actual = await captureCuratedBody(
        provider,
        source(),
        caching,
        true,
        true,
        undefined,
        resolver,
      );
      expect(actual).toBe(expected);
      await savePair(size, provider, caching, expected, actual, checkpoint);
    }
  }
}

async function savePair(
  size: number,
  provider: string,
  caching: boolean,
  expected: string,
  actual: string,
  checkpoint: string,
): Promise<void> {
  const output = process.env.CHECKPOINT_BODY_OUTPUT;
  if (output === undefined) return;
  await mkdir(output, { recursive: true });
  const name = `${size}-${provider}-${caching}`;
  await writeBodyFile(join(output, `${name}-expected.json`), expected);
  await writeBodyFile(join(output, `${name}-actual.json`), actual);
  await writeBodyFile(join(output, `${size}-checkpoint.json`), checkpoint);
}

async function disposeAgentHistories(
  cleanup: () => Promise<void>,
  priorHistory: HistoryService | null,
  history: HistoryService,
): Promise<void> {
  try {
    await cleanup();
  } finally {
    if (priorHistory !== history) await priorHistory?.dispose();
  }
}

async function roundTrip(size: number): Promise<void> {
  await withBatchFixture(async ({ history }) => {
    await seedRows(history, size);
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    const client = internalAgentClient(agent);
    const priorHistory = client.getHistoryService();
    const root = await mkdtemp(join(tmpdir(), 'checkpoint-body-'));
    try {
      bindClientTokenization(client, exactTokenizer());
      client.storeHistoryServiceForReuse(history);
      await history.recalculateTokens();
      const expectedTokens = size * (6 + 1000);
      const tokenCountBeforeSave = history.getTotalTokens();
      await createToolCheckpoint(
        checkpointTool,
        root,
        checkpointGit,
        agent,
        checkpointUiHistory,
        () => {},
      );
      const saved = await savedCheckpoint(root);
      let loadedUi = '';
      const context = createMockCommandContext();
      context.services.agent = agent;
      if (context.services.config === null)
        throw new Error('Missing fixture runtime');
      const runtime = {
        ...context.services.config,
        projectCheckpointsDir: root,
        getCheckpointingEnabled: () => true,
      };
      context.services.config = runtime;
      context.ui.loadHistory = (rows) => {
        loadedUi = JSON.stringify(rows);
      };
      const outcome = await restoreCommand(runtime)?.action?.(
        context,
        basename(saved.path),
      );
      expect(outcome).toStrictEqual({
        type: 'tool',
        toolName: checkpointTool.request.name,
        toolArgs: checkpointTool.request.args,
      });
      expect(loadedUi).toBe(JSON.stringify(checkpointUiHistory));
      const restored = client.getHistoryService();
      if (restored === null) throw new Error('Missing restored history');
      expect([tokenCountBeforeSave, restored.getTotalTokens()]).toStrictEqual([
        expectedTokens,
        expectedTokens,
      ]);
      if (client.mediaStore === undefined)
        throw new Error('Missing session media store');
      await bodyPairs(
        size,
        () => client.streamHistory(),
        new RequestMediaResolver(client.mediaStore),
        saved.bytes,
      );
    } finally {
      try {
        await disposeAgentHistories(cleanup, priorHistory, history);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });
}

describe('invoked CLI checkpoint save and compatible restore BODY bytes', () => {
  it.each([65])(
    'preserves %i-row provider bodies, media, cache anchors and UI history through saved bytes',
    roundTrip,
    180000,
  );
});
