/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as acp from '@agentclientprotocol/sdk';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { Config } from '@vybestack/llxprt-code-core';
import { createHash } from 'node:crypto';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { accountingRow } from '@vybestack/llxprt-code-core/services/history/token-accounting-stream-test-helpers.js';
import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
import { mapHistoryToSessionUpdates } from './zed-session-replay.js';
import { toAcpReadableStream } from './acp-readable-stream.js';
import { readAgentHistoryForReplay } from './zed-session-loader.js';
import { deliverHistoryUpdates } from './zed-session-replay.js';
import { SessionTitleTracker } from './zed-session-info.js';
import { ZedAgent } from './zedIntegration.js';

export function serializeUpdate(update: acp.SessionUpdate): string {
  return JSON.stringify(update, (_key, value: unknown): unknown => {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(
        Object.entries(value).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      );
    }
    return value;
  });
}

export class NoArrayHistory extends HistoryService {
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(this, 'raw arrays forbidden');
  }
}

export function replayOracle(size: number): string {
  const updates = mapHistoryToSessionUpdates(
    Array.from({ length: size }, (_, index) => accountingRow(index)),
  );
  return createHash('sha256')
    .update('[' + updates.map(serializeUpdate).join(',') + ']')
    .digest('hex');
}

export type InputKind = 'node' | 'web';
export function createInput(kind: InputKind): {
  input: NodeReadableStream<Uint8Array> | ReadableStream<Uint8Array>;
  send: (bytes: Uint8Array) => void;
  end: () => void;
  terminate: () => void;
  cancelled: Promise<unknown>;
} {
  const cancelled = Promise.withResolvers<unknown>();
  if (kind === 'node') {
    const source = new Readable({
      read() {},
      destroy(error, callback) {
        cancelled.resolve(error);
        callback(error);
      },
    });
    const input: NodeReadableStream<Uint8Array> = Readable.toWeb(source);
    return {
      input,
      send: (bytes) => {
        source.push(bytes);
      },
      end: () => {
        source.push(null);
      },
      terminate: () => {
        source.destroy();
      },
      cancelled: cancelled.promise,
    };
  }
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const input = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
    cancel(reason) {
      cancelled.resolve(reason);
    },
  });
  return {
    input,
    send: (bytes) => {
      controller.enqueue(bytes);
    },
    end: () => {
      controller.close();
    },
    terminate: () => {
      controller.error(new Error('transport terminated'));
    },
    cancelled: cancelled.promise,
  };
}

export function connectPeer(
  kind: InputKind,
  makeAgent: (connection: acp.AgentSideConnection) => acp.Agent,
  onUpdate: (update: acp.SessionUpdate) => void = () => {},
): {
  input: ReturnType<typeof createInput>;
  connection: acp.AgentSideConnection;
  client: acp.ClientSideConnection;
  finish: () => Promise<void>;
} {
  const input = createInput(kind);
  const responses = new TransformStream<Uint8Array, Uint8Array>();
  const connection = new acp.AgentSideConnection(
    makeAgent,
    acp.ndJsonStream(responses.writable, toAcpReadableStream(input.input)),
  );
  const requests = new WritableStream<Uint8Array>({
    write(bytes) {
      const middle = Math.floor(bytes.byteLength / 2);
      input.send(bytes.subarray(0, middle));
      input.send(bytes.subarray(middle));
    },
  });
  const client = new acp.ClientSideConnection(
    () => ({
      async requestPermission() {
        return { outcome: { outcome: 'cancelled' } };
      },
      async sessionUpdate(params) {
        onUpdate(params.update);
      },
    }),
    acp.ndJsonStream(requests, responses.readable),
  );
  return {
    input,
    connection,
    client,
    finish: async () => {
      input.terminate();
      await connection.closed;
      const writer = responses.writable.getWriter();
      try {
        await writer.close();
      } finally {
        writer.releaseLock();
      }
      await client.closed;
    },
  };
}

export function connectZed(
  config: Config,
  kind: InputKind,
): ReturnType<typeof connectPeer> & { dispose: () => Promise<void> } {
  const agents: ZedAgent[] = [];
  const peer = connectPeer(kind, (connection) => {
    const agent = new ZedAgent(config, connection, async () => []);
    agents.push(agent);
    return agent;
  });
  return {
    ...peer,
    dispose: async () => {
      await Promise.all(agents.map((agent) => agent.disposeAll()));
    },
  };
}

export class ReplayPeer implements acp.Agent {
  private readonly abort = new AbortController();
  private readonly release = Promise.withResolvers<void>();
  readonly firstUpdate = Promise.withResolvers<void>();
  constructor(
    private readonly connection: acp.AgentSideConnection,
    private readonly history: HistoryService,
    private readonly pause: boolean,
  ) {}
  async initialize(): Promise<acp.InitializeResponse> {
    return {
      protocolVersion: 1,
      agentCapabilities: { loadSession: true },
      authMethods: [],
    };
  }
  async newSession(): Promise<acp.NewSessionResponse> {
    return { sessionId: 'replay-cursor' };
  }
  async authenticate(): Promise<void> {}
  async prompt(): Promise<acp.PromptResponse> {
    return { stopReason: 'end_turn' };
  }
  async cancel(): Promise<void> {
    this.abort.abort(new Error('ACP replay cancelled'));
    this.release.resolve();
  }
  async loadSession(
    params: acp.LoadSessionRequest,
  ): Promise<acp.LoadSessionResponse> {
    await deliverHistoryUpdates(
      readAgentHistoryForReplay(
        { streamHistory: (signal) => this.history.streamRawHistory(signal) },
        params.sessionId,
        this.abort.signal,
      ),
      new SessionTitleTracker(),
      params.sessionId,
      async (update) => {
        await this.connection.sessionUpdate({
          sessionId: params.sessionId,
          update,
        });
        this.firstUpdate.resolve();
        if (this.pause) await this.release.promise;
        this.abort.signal.throwIfAborted();
      },
    );
    return {};
  }
}
