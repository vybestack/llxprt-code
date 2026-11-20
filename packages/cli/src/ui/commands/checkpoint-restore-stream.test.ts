/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { appendFileSync } from 'node:fs';
import {
  withCheckpoint,
  saveCheckpoint,
  savedCheckpoint,
} from '../hooks/agentStream/checkpoint-disk-test-helpers.js';
import { checkpointCommand } from '../../__tests__/checkpoint-command-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { cleanupBounds } from '../../utils/__tests__/support/cleanup-history-test-helpers.js';

function observeAdmission(
  client: Parameters<Parameters<typeof withCheckpoint>[2]>[0]['client'],
  retain: boolean,
): {
  owners: RowOwnership;
  external: RowOwnership;
  release: () => void;
} {
  const owners = new RowOwnership();
  const retained: IContent[] = [];
  const external = new RowOwnership();
  const admit = client.setHistoryFromSource.bind(client);
  vi.spyOn(client, 'setHistoryFromSource').mockImplementation(
    async (source, options) => {
      await admit(
        (async function* () {
          for await (const row of source) {
            owners.retain(row);
            if (retain) {
              retained.push(row);
              external.retain(row);
            }
            try {
              yield row;
            } finally {
              owners.release(row);
            }
          }
        })(),
        { ...options, ownership: owners },
      );
    },
  );
  return {
    owners,
    external,
    release: () => {
      for (const row of retained) external.release(row);
    },
  };
}

async function boundedRestore(
  size: number,
  active: boolean,
  retain = false,
): Promise<number> {
  return withCheckpoint(
    size,
    active,
    async (fixture, dir) => {
      await saveCheckpoint(fixture, dir);
      const saved = await savedCheckpoint(dir);
      const expected = createHash('sha256');
      for (const row of JSON.parse(saved.bytes).clientHistory)
        expected.update(JSON.stringify(row));
      const client = fixture.client;
      vi.spyOn(client, 'setHistory').mockImplementation(async () => {
        throw new Error('eager checkpoint restore is forbidden');
      });
      const { owners, external, release } = observeAdmission(client, retain);
      let invalidated = false;
      const context = createMockCommandContext({
        services: {},
      });
      if (context.services.config === null)
        throw new Error('Missing fixture runtime');
      const runtime = {
        ...context.services.config,
        projectCheckpointsDir: dir,
        getCheckpointingEnabled: () => true,
      };
      context.services.config = runtime;
      context.ui.clear = () => {
        invalidated = true;
      };
      try {
        const outcome = await checkpointCommand(client, runtime)?.action?.(
          context,
          basename(saved.path),
        );
        expect(outcome?.type).toBe('tool');
        expect(invalidated).toBe(true);
        const actual = createHash('sha256');
        let count = 0;
        for await (const row of client.streamHistory()) {
          actual.update(JSON.stringify(row));
          count++;
        }
        expect(actual.digest('hex')).toBe(expected.digest('hex'));
        expect(fixture.reader.within(cleanupBounds)).toBe(true);
        expect(fixture.reader.snapshot().liveRows).toBe(0);
        const output = process.env.CHECKPOINT_RESTORE_OUTPUT;
        if (output)
          appendFileSync(
            output,
            JSON.stringify({
              size,
              active,
              reader: fixture.reader.snapshot(),
              admission: owners.snapshot(),
              external: external.snapshot(),
            }) + '\n',
          );
        expect(owners.within(cleanupBounds)).toBe(true);
        expect(owners.snapshot().liveRows).toBe(0);
        expect(
          external.snapshot().peakRows <= cleanupBounds.rows &&
            external.snapshot().peakSerializedBytes <=
              cleanupBounds.serializedBytes,
        ).toBe(
          !retain || process.env.CHECKPOINT_RESTORE_RETAINING_TRAP === '1',
        );
        if (retain) {
          expect(external.snapshot().liveRows).toBe(size);
          expect(external.snapshot().liveRows).toBeGreaterThan(
            cleanupBounds.rows,
          );
          expect(external.snapshot().liveSerializedBytes).toBeGreaterThan(
            cleanupBounds.serializedBytes,
          );
        }
        return count;
      } finally {
        release();
        vi.restoreAllMocks();
      }
    },
    retain ? 32 * 1024 : 2048,
  );
}

describe('invoked CLI bounded checkpoint restoration', () => {
  for (const size of [65]) {
    for (const active of [false, true]) {
      it(`restores ${size} rows with ${active ? 'active' : 'inactive'} chat without array admission`, async () => {
        expect(await boundedRestore(size, active)).toBe(size);
      }, 180000);
    }
  }
  it('rejects a retained 512-row admission under the same reader bounds', async () => {
    expect(await boundedRestore(512, true, true)).toBe(512);
  }, 180000);
});
