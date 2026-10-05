/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import * as checkpointUtils from '@vybestack/llxprt-code-core/utils/checkpointUtils.js';
import * as core from '@vybestack/llxprt-code-core';
import { createToolCheckpoint } from './checkpointPersistence.js';
import {
  checkpointGit,
  checkpointTool,
  checkpointUiHistory,
  savedCheckpoint,
  trackingFs,
  withCheckpoint,
} from './checkpoint-disk-test-helpers.js';
import {
  cleanupBounds,
  cleanupRow,
  recordCleanupOwners,
} from '../../../utils/cleanup-history-test-helpers.js';

describe('checkpoint public disk route after eager preparation removal', () => {
  it('does not expose the unused whole-checkpoint string-map preparation API', () => {
    expect([
      Object.hasOwn(checkpointUtils, 'processRestorableToolCalls'),
      Object.hasOwn(core, 'processRestorableToolCalls'),
    ]).toStrictEqual([false, false]);
  });

  for (const size of [512, 8192]) {
    for (const active of [false, true]) {
      it(`invokes the exported durable writer for ${size} rows, active=${active}`, async () => {
        await withCheckpoint(size, active, async (fixture, dir) => {
          const agent = fixture.config.getAgentClient();
          const cold = agent.streamHistory();
          expect(fixture.decoded()).toBe(0);
          await cold.return();
          const fs = trackingFs();
          await createToolCheckpoint(
            checkpointTool,
            dir,
            checkpointGit,
            agent,
            checkpointUiHistory,
            () => {},
            fs.ops,
          );
          const saved = await savedCheckpoint(dir);
          const expected = JSON.stringify(
            {
              history: checkpointUiHistory,
              clientHistory: Array.from({ length: size }, (_, index) =>
                cleanupRow(index, 2048, size, fixture.reference),
              ),
              toolCall: {
                name: checkpointTool.request.name,
                args: checkpointTool.request.args,
              },
              commitHash: 'checkpoint-snapshot',
              filePath: checkpointTool.request.args.file_path,
            },
            null,
            2,
          );
          expect(saved.bytes).toBe(expected);
          expect(fixture.history.delivered).toBe(size);
          expect(fixture.history.closed).toBe(1);
          expect(fixture.reader.within(cleanupBounds)).toBe(true);
          expect(fixture.reader.snapshot().liveRows).toBe(0);
          expect(fs.chunks().peakBytes).toBeLessThanOrEqual(64 * 1024);
          recordCleanupOwners(
            size,
            active,
            'core-api-removal-disk-route',
            fixture,
          );
        });
      }, 180000);
    }
  }
});
