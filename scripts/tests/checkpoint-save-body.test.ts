/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { withBatchFixture } from '../../packages/core/src/services/history/addbatch-stream-test-helpers.js';
import {
  exportSummaryRow,
  seedRows,
} from '../../packages/core/src/services/history/export-summary-test-helpers.js';
import type { IContent } from '../../packages/core/src/services/history/IContent.js';
import { RequestMediaResolver } from '../../packages/core/src/storage/request-media-resolver.js';
import {
  buildAgent,
  internalConfig,
} from '../../packages/agents/src/api/__tests__/helpers/agentHarness.js';
import { createToolCheckpoint } from '../../packages/cli/src/ui/hooks/agentStream/checkpointPersistence.js';
import {
  checkpointGit,
  checkpointTool,
  checkpointUiHistory,
  savedCheckpoint,
} from '../../packages/cli/src/ui/hooks/agentStream/checkpoint-disk-test-helpers.js';
import { restoreCommand } from '../../packages/cli/src/ui/commands/restoreCommand.js';
import { createMockCommandContext } from '../../packages/cli/src/test-utils/mockCommandContext.js';
import { captureCuratedBody } from './provider-curated-body-helpers.js';

async function bodyPairs(
  size: number,
  source: () => AsyncIterable<IContent>,
  resolver: RequestMediaResolver,
  checkpoint: string,
): Promise<void> {
  const expectedRows = Array.from({ length: size }, (_, index) =>
    exportSummaryRow(index),
  );
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
  await writeFile(join(output, `${name}-expected.json`), expected);
  await writeFile(join(output, `${name}-actual.json`), actual);
  await writeFile(join(output, `${size}-checkpoint.json`), checkpoint);
}

async function roundTrip(size: number): Promise<void> {
  await withBatchFixture(async ({ history, recorder }) => {
    await seedRows(recorder, size);
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    const config = internalConfig(agent);
    const root = await mkdtemp(join(process.cwd(), 'tmp/checkpoint-body-'));
    try {
      const client = config.getAgentClient();
      client.storeHistoryServiceForReuse(history);
      await history.recalculateTokens();
      const expectedTokens = size * (6 + 1000);
      const tokenCountBeforeSave = history.getTotalTokens();
      vi.spyOn(config.storage, 'getProjectTempCheckpointsDir').mockReturnValue(
        root,
      );
      vi.spyOn(config, 'getCheckpointingEnabled').mockReturnValue(true);
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
      context.services.config = config;
      context.ui.loadHistory = (rows) => {
        loadedUi = JSON.stringify(rows);
      };
      const outcome = await restoreCommand(config)?.action?.(
        context,
        basename(saved.path),
      );
      expect(outcome).toStrictEqual({
        type: 'tool',
        toolName: checkpointTool.request.name,
        toolArgs: checkpointTool.request.args,
      });
      expect(loadedUi).toBe(JSON.stringify(checkpointUiHistory));
      expect([tokenCountBeforeSave, history.getTotalTokens()]).toStrictEqual([
        expectedTokens,
        expectedTokens,
      ]);
      await bodyPairs(
        size,
        () => client.streamHistory(),
        new RequestMediaResolver(config.getLocalMediaStore()),
        saved.bytes,
      );
    } finally {
      vi.restoreAllMocks();
      await cleanup();
      await rm(root, { recursive: true, force: true });
    }
  });
}

describe('invoked CLI checkpoint save and compatible restore BODY bytes', () => {
  it.each([512, 8192])(
    'preserves %i-row provider bodies, media, cache anchors and UI history through saved bytes',
    roundTrip,
    180000,
  );
});
