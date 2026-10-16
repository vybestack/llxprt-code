/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile, truncate } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import {
  openDiskCheckpoint,
  type DiskCheckpoint,
} from './checkpoint-restore-source.js';
import { checkpointUiHistory } from '../hooks/agentStream/checkpoint-disk-test-helpers.js';

async function withFile<T>(
  bytes: string,
  action: (path: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'checkpoint-parser-'));
  const path = join(root, 'checkpoint.json');
  try {
    await writeFile(path, bytes);
    return await action(path);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function collect(checkpoint: DiskCheckpoint): Promise<unknown[]> {
  const rows: unknown[] = [];
  if (checkpoint.rows !== undefined)
    for await (const row of checkpoint.rows) rows.push(row);
  return rows;
}

const tool = {
  name: 'write_file',
  args: { file_path: '/project/🐈.ts', text: '"\\\u0000' },
};
const unicodeRow = {
  speaker: 'human',
  blocks: [{ type: 'text', text: 'é雪🐈\n\\"\t\u0000\ud800\udfff' }],
  metadata: {
    unknown: [null, -0.5, 1e22, false, true],
    chronology: { seq: 99, userTurn: 3, step: 2, recordedAt: 101 },
  },
};

describe('checkpoint disk JSON framing and cold row ownership', () => {
  for (const chunkBytes of [1, 2, 3, 7, 64, 16384]) {
    it(`preserves exact JSON values across ${chunkBytes}-byte UTF-8 and escape boundaries`, async () => {
      const object = {
        history: checkpointUiHistory,
        clientHistory: [unicodeRow],
        toolCall: tool,
        commitHash: 'old-snapshot',
        filePath: '/project/old.ts',
        messageId: 'legacy-message',
        version: 1,
      };
      await withFile(JSON.stringify(object, null, 2), async (path) => {
        const checkpoint = await openDiskCheckpoint(path, undefined, {
          chunkBytes,
        });
        try {
          expect(await collect(checkpoint)).toStrictEqual(object.clientHistory);
          const { clientHistory: _rows, ...metadata } = object;
          expect(checkpoint.data).toStrictEqual(metadata);
        } finally {
          await checkpoint.close();
        }
      });
    });
  }
});

describe('checkpoint single row owner boundaries', () => {
  it('does not read ahead while a row is paused and releases it on return', async () => {
    const ownership = new RowOwnership();
    await withFile(
      JSON.stringify({
        clientHistory: [unicodeRow, unicodeRow],
        toolCall: tool,
      }),
      async (path) => {
        const checkpoint = await openDiskCheckpoint(path, undefined, {
          ownership,
        });
        try {
          expect(ownership.snapshot()).toMatchObject({
            liveRows: 0,
            acquisitions: 2,
          });
          const rows = checkpoint.rows?.[Symbol.asyncIterator]();
          if (!rows) throw new Error('Missing history source');
          await rows.next();
          expect(ownership.snapshot()).toMatchObject({
            liveRows: 1,
            acquisitions: 3,
          });
          await rows.return?.();
          expect(ownership.snapshot().liveRows).toBe(0);
        } finally {
          await checkpoint.close();
        }
      },
    );
  });
  it('charges but accepts a nine-MiB row exempt from the aggregate gate', async () => {
    const row = {
      speaker: 'human',
      blocks: [{ type: 'text', text: '🐈'.repeat((9 * 1024 * 1024) / 4) }],
    };
    const ownership = new RowOwnership();
    await withFile(
      JSON.stringify({ clientHistory: [row], toolCall: tool }),
      async (path) => {
        const checkpoint = await openDiskCheckpoint(path, undefined, {
          ownership,
          chunkBytes: 4095,
        });
        try {
          expect(await collect(checkpoint)).toStrictEqual([row]);
          expect(ownership.snapshot().peakRows).toBe(1);
          expect(ownership.snapshot().peakSerializedBytes).toBeGreaterThan(
            9 * 1024 * 1024,
          );
          expect(ownership.snapshot().liveRows).toBe(0);
        } finally {
          await checkpoint.close();
        }
      },
    );
  }, 180000);
});

describe('checkpoint syntax and recovery', () => {
  for (const bytes of [
    '{"clientHistory":[',
    '{"toolCall":{},}',
    '{"toolCall":{"name":"x"},"clientHistory":[null]}',
    '{"toolCall":{"name":"x"},"x":"\\u12"}',
    '{"toolCall":{"name":"x"},"x":[1,]}',
    '{"toolCall":{"name":"x"}}false',
    '{"history":[]}',
  ]) {
    it(`rejects corrupt or truncated checkpoint ${bytes}`, async () => {
      await withFile(bytes, async (path) => {
        await expect(openDiskCheckpoint(path)).rejects.toThrow(
          /Checkpoint|checkpoint|JSON|Expected/u,
        );
      });
    });
  }
  it('rejects an in-place truncated file during cold consumption', async () => {
    await withFile(
      JSON.stringify({
        clientHistory: [unicodeRow, unicodeRow],
        toolCall: tool,
      }),
      async (path) => {
        const checkpoint = await openDiskCheckpoint(path);
        try {
          await truncate(path, 10);
          await expect(collect(checkpoint)).rejects.toThrow(/checkpoint|JSON/u);
        } finally {
          await checkpoint.close();
        }
      },
    );
  });
  it('preserves last duplicate field wins and an own __proto__ property', async () => {
    const bytes = `{"clientHistory":[${JSON.stringify(unicodeRow)}],"clientHistory":[],"__proto__":{"safe":true},"toolCall":${JSON.stringify(tool)}}`;
    await withFile(bytes, async (path) => {
      const checkpoint = await openDiskCheckpoint(path);
      try {
        expect(await collect(checkpoint)).toStrictEqual([]);
        expect(Object.hasOwn(checkpoint.data, '__proto__')).toBe(true);
        expect(Object.getPrototypeOf(checkpoint.data)).toBe(Object.prototype);
      } finally {
        await checkpoint.close();
      }
    });
  });
  it('rejects pre-abort and abort at a paused row without an owner leak', async () => {
    const abort = new AbortController();
    const ownership = new RowOwnership();
    await withFile(
      JSON.stringify({
        clientHistory: [unicodeRow, unicodeRow],
        toolCall: tool,
      }),
      async (path) => {
        const checkpoint = await openDiskCheckpoint(path, abort.signal, {
          ownership,
          chunkBytes: 7,
        });
        try {
          const rows = checkpoint.rows?.[Symbol.asyncIterator]();
          if (!rows) throw new Error('Missing rows');
          await rows.next();
          abort.abort(new Error('restore cancelled'));
          await expect(rows.next()).rejects.toThrow('restore cancelled');
          expect(ownership.snapshot().liveRows).toBe(0);
        } finally {
          await checkpoint.close();
        }
        await expect(openDiskCheckpoint(path, abort.signal)).rejects.toThrow(
          'restore cancelled',
        );
      },
    );
  });
});
