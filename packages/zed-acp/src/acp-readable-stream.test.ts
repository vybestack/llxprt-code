/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { ReadableStream as NodeReadableStream } from 'node:stream/web';
import * as acp from '@agentclientprotocol/sdk';
import { Config } from '@vybestack/llxprt-code-core';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { accountingRow } from '@vybestack/llxprt-code-core/services/history/token-accounting-stream-test-helpers.js';
import {
  NoArrayHistory,
  replayOracle,
  serializeUpdate,
} from './acp-readable-stream-test-helpers.js';
import { toAcpReadableStream } from './acp-readable-stream.js';
import {
  createInput,
  connectZed,
  connectPeer,
  ReplayPeer,
  type InputKind,
} from './acp-readable-stream-test-helpers.js';

const inputKinds: InputKind[] = ['node', 'web'];
for (const kind of inputKinds) {
  describe(`${kind} ACP readable ownership`, () => {
    it('forwards cancellation through the locked SDK reader and unlocks the input', async () => {
      const source = createInput(kind);
      const stream = acp.ndJsonStream(
        new WritableStream<Uint8Array>(),
        toAcpReadableStream(source.input),
      );
      const reader = stream.readable.getReader();
      const pending = reader.read();
      const reason = new Error('cancel reader');
      await reader.cancel(reason);
      await pending;
      expect(await source.cancelled).toBe(reason);
      expect(source.input.locked).toBe(false);
      reader.releaseLock();
    });

    it('carries fragmented requests through real Zed resume and settles termination', async () => {
      const config = new Config({
        sessionId: 'stream-resume',
        targetDir: process.cwd(),
        cwd: process.cwd(),
        debugMode: false,
        model: 'test',
      });
      const peer = connectZed(config, kind);
      try {
        const initialized = await peer.client.initialize({
          protocolVersion: 1,
          clientCapabilities: {},
        });
        expect(
          initialized.agentCapabilities?.sessionCapabilities?.resume,
        ).toStrictEqual({});
        await expect(
          peer.client.resumeSession({
            sessionId: 'absent',
            cwd: process.cwd(),
            mcpServers: [],
          }),
        ).rejects.toMatchObject({ code: -32002 });
        peer.input.terminate();
        await peer.connection.closed;
        expect(peer.input.input.locked).toBe(false);
      } finally {
        await peer.finish();
        await peer.dispose();
      }
    });
  });

  describe(`${kind} ACP disk replay`, () => {
    it('preserves complete large-history wire bytes and bounded disk rows', async () => {
      const size = 8192;
      const expected = replayOracle(size);
      await withSuffixFixture(
        size,
        async (history, ownership, counters) => {
          const digest = createHash('sha256').update('[');
          let count = 0;
          const peer = connectPeer(
            kind,
            (connection) => new ReplayPeer(connection, history, false),
            (update) => {
              if (count++ > 0) digest.update(',');
              digest.update(serializeUpdate(update));
            },
          );
          try {
            await peer.client.loadSession({
              sessionId: 'replay-cursor',
              cwd: process.cwd(),
              mcpServers: [],
            });
            digest.update(']');
            expect(digest.digest('hex')).toBe(expected);
            expect(counters.snapshot().rowsDecoded).toBe(size);
            expect(
              ownership.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
            ).toBe(true);
            expect(ownership.snapshot().liveRows).toBe(0);
            peer.input.end();
            await peer.connection.closed;
            expect(peer.input.input.locked).toBe(false);
          } finally {
            await peer.finish();
          }
        },
        2048,
        accountingRow,
        undefined,
        (options) => new NoArrayHistory(options),
      );
    }, 120_000);
  });

  describe(`${kind} ACP disk replay cancellation`, () => {
    it('stops a paused disk replay on ACP cancel without decoding another row', async () => {
      await withSuffixFixture(
        8192,
        async (history, ownership, counters) => {
          const ready = Promise.withResolvers<ReplayPeer>();
          const peer = connectPeer(kind, (connection) => {
            const agent = new ReplayPeer(connection, history, true);
            ready.resolve(agent);
            return agent;
          });
          const load = peer.client.loadSession({
            sessionId: 'replay-cursor',
            cwd: process.cwd(),
            mcpServers: [],
          });
          const outcome = load.catch((error: unknown) => error);
          const agent = await ready.promise;
          try {
            await agent.firstUpdate.promise;
            expect(counters.snapshot().rowsDecoded).toBe(1);
            await peer.client.cancel({ sessionId: 'replay-cursor' });
            expect(await outcome).toMatchObject({
              code: -32603,
              data: { reason: 'ACP replay cancelled', phase: 'replay' },
            });
            expect({
              decoded: counters.snapshot().rowsDecoded,
              held: ownership.snapshot().liveRows,
            }).toStrictEqual({ decoded: 1, held: 0 });
          } finally {
            await peer.finish();
          }
        },
        2048,
        accountingRow,
        undefined,
        (options) => new NoArrayHistory(options),
      );
    }, 120_000);
  });
}

describe('native readable lifecycle', () => {
  it('propagates a native Node stream error and releases its reader lock', async () => {
    const failure = new Error('native input failed');
    const source = new NodeReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(failure);
      },
    });
    const reader = toAcpReadableStream(source).getReader();
    await expect(reader.read()).rejects.toBe(failure);
    expect(source.locked).toBe(false);
    reader.releaseLock();
  });

  it('does not read ahead while the ACP consumer holds a chunk', async () => {
    let pulled = 0;
    const source = new NodeReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.enqueue(new Uint8Array([pulled++]));
        },
      },
      { highWaterMark: 0 },
    );
    const reader = toAcpReadableStream(source).getReader();
    await reader.read();
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(pulled).toBe(1);
    await reader.cancel(new Error('finished'));
    expect(source.locked).toBe(false);
    reader.releaseLock();
  });
});
