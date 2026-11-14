/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { realisticSessionSummary } from '../../../../test-utils/src/core/realistic-session.js';
import type {
  SessionPayloadOwner,
  SessionProbe,
  SessionRouteAdapter,
  SessionWireDigest,
} from '../../../../test-utils/src/core/session-memory-protocol.js';
import {
  buildHistoryCallOptions,
  WIRE_ROUTES,
  type WireRoute,
} from './wireBodyCapture.js';
import {
  realisticNativeFixture,
  nativeReferenceRowAt,
} from './realistic-native-fixture.js';

interface NativeWireDigest extends SessionWireDigest {
  readonly selectedPayloadBytes: number;
  readonly port: number;
}

export const NATIVE_SESSION_ROUTES = [
  'openai-chat-plain',
  'openai-chat-mistral',
  'openai-chat-kimi',
  'openai-responses',
  'openai-responses-stateful',
  'anthropic-cache-off',
];
const ROOT = join(import.meta.dir, '../../../../../tmp/accept-speed');

function routeOf(id: string): WireRoute {
  const route = WIRE_ROUTES.find(
    (entry) =>
      entry.id ===
      (id === 'openai-responses-stateful' ? 'openai-responses' : id),
  );
  if (route === undefined)
    throw new Error(`Unknown native session route: ${id}`);
  return route;
}

function observeTransportEntry(probe: SessionProbe | undefined): () => void {
  const originalFetch = globalThis.fetch;
  if (probe !== undefined)
    globalThis.fetch = Object.assign(
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ): Promise<Response> => {
        await probe.checkpoint('transport-entry');
        return originalFetch(input, init);
      },
      { preconnect: originalFetch.preconnect },
    );
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function* receiverMessages(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<Record<string, unknown>> {
  let pending = '';
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const next = await reader.read();
    if (next.done) return;
    pending += decoder.decode(next.value, { stream: true });
    let newline = pending.indexOf('\n');
    while (newline >= 0) {
      const value: unknown = JSON.parse(pending.slice(0, newline));
      if (!isRecord(value)) throw new Error('Invalid receiver message');
      yield value;
      pending = pending.slice(newline + 1);
      newline = pending.indexOf('\n');
    }
  }
}

async function nextReceiverMessage(
  messages: AsyncGenerator<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const next = await messages.next();
  if (next.done === true) throw new Error('HTTP receiver exited');
  return next.value;
}

function uploadPhase(
  value: unknown,
): value is
  | 'quarter'
  | 'half'
  | 'three-quarter'
  | 'paused-upload'
  | 'body-admission' {
  return [
    'quarter',
    'half',
    'three-quarter',
    'paused-upload',
    'body-admission',
  ].includes(String(value));
}

async function receiveDigest(
  messages: AsyncGenerator<Record<string, unknown>>,
  sink: Bun.FileSink,
  port: number,
  probe: SessionProbe | undefined,
): Promise<NativeWireDigest> {
  for (;;) {
    const message = await nextReceiverMessage(messages);
    const phase = message['checkpoint'];
    if (uploadPhase(phase)) {
      await probe?.checkpoint(phase);
      await sink.write('continue\n');
      await sink.flush();
      continue;
    }
    if (
      typeof message['bytes'] !== 'number' ||
      typeof message['sha256'] !== 'string' ||
      typeof message['selectedPayloadBytes'] !== 'number'
    )
      throw new Error('Invalid wire digest');
    return {
      bytes: message['bytes'],
      sha256: message['sha256'],
      selectedPayloadBytes: message['selectedPayloadBytes'],
      port,
    };
  }
}

async function hashSend(
  route: WireRoute,
  selection: ProviderRequestSelection,
  stateful: boolean,
  provider: ReturnType<WireRoute['createProvider']>,
  probe?: SessionProbe,
  expectedBytes = 0,
  port = 0,
): Promise<NativeWireDigest> {
  const receiver = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, 'realistic-native-receiver.ts'),
      route.id,
      String(stateful),
      String(expectedBytes),
      String(port),
    ],
    { stdout: 'pipe', stdin: 'pipe', stderr: 'inherit' },
  );
  const messages = receiverMessages(receiver.stdout);
  const address = await nextReceiverMessage(messages);
  if (typeof address['port'] !== 'number')
    throw new Error('Missing receiver port');
  const listeningPort = address['port'];
  const restoreTransport = observeTransportEntry(probe);
  try {
    const options = buildHistoryCallOptions(
      {
        ...route,
        baseURL: `http://127.0.0.1:${listeningPort}${new URL(route.baseURL).pathname}`,
      },
      {
        id: 'realistic-native-session',
        description: '25K journal-backed session',
        rows: [],
        ephemerals: {
          retries: 0,
          'responses-stateful': stateful,
          'tool-output-max-tokens': false,
        },
      },
      'rows',
      new SettingsService(),
      selection,
    );
    const [, received] = await Promise.all([
      (async (): Promise<void> => {
        for await (const chunk of provider.generateChatCompletion(options))
          void chunk;
      })(),
      receiveDigest(messages, receiver.stdin, listeningPort, probe),
    ]);
    return received;
  } finally {
    restoreTransport();
    receiver.kill();
    await receiver.exited;
  }
}

async function retainSelectedRows(
  selection: ProviderRequestSelection,
  stateful: boolean,
  probe: SessionProbe,
  owner: SessionPayloadOwner,
): Promise<void> {
  let selectedRows = 0;
  let ordinal = 0;
  for await (const row of selection.openReader()) {
    if (ordinal++ < (stateful ? 2 : 0)) continue;
    owner.retain(JSON.stringify(row));
    selectedRows++;
    if (selectedRows % 6250 === 0) await probe.checkpoint('conversion');
  }
  if (selectedRows !== 25_000) throw new Error(`Selected ${selectedRows} rows`);
}

async function warmNativeSend(
  route: WireRoute,
  stateful: boolean,
  provider: ReturnType<WireRoute['createProvider']>,
): Promise<void> {
  await mkdir(ROOT, { recursive: true });
  const fixture = await realisticNativeFixture(
    ROOT,
    { rowCount: 8, payloadBytes: 8192 },
    stateful,
  );
  try {
    await hashSend(route, fixture.selection, stateful, provider);
  } finally {
    await fixture.close();
  }
}

export function nativeSessionAdapter(
  id: string,
  seed?: string,
): SessionRouteAdapter {
  const route = routeOf(id);
  const stateful = id === 'openai-responses-stateful';
  const provider = route.createProvider();
  return {
    routeId: id,
    operation: 'send',
    warmup: () => warmNativeSend(route, stateful, provider),
    async prepare() {
      const summary = realisticSessionSummary();
      const fixture = await realisticNativeFixture(ROOT, {}, stateful, seed);
      const started = performance.now();
      let reads = 0;
      process.stdout.write(
        `${JSON.stringify({ route: id, stage: 'reference-start' })}\n`,
      );
      const reference = await hashSend(
        route,
        {
          callerOwned: true,
          index: fixture.selection.index,
          count: fixture.selection.count,
          readAt: (index, signal) => {
            reads++;
            void signal;
            return nativeReferenceRowAt(index, stateful);
          },
          openReader: (signal) => fixture.selection.openReader(signal),
          close: () => undefined,
        },
        stateful,
        provider,
      );
      process.stdout.write(
        `${JSON.stringify({ route: id, referenceReads: reads, referenceMs: performance.now() - started })}\n`,
      );
      return {
        corpus: {
          rowCount: summary.rowCount + (stateful ? 2 : 0),
          selectedRowCount: summary.rowCount,
          neutralPayloadBytes: summary.neutralPayloadBytes,
          journalBytes: fixture.journalBytes,
          selectedPayloadBytes: reference.selectedPayloadBytes,
          largestUnitBytes: summary.largestUnitBytes,
        },
        reference,
        async run(
          probe: SessionProbe,
          owner: SessionPayloadOwner,
        ): Promise<SessionWireDigest> {
          fixture.observe(probe);
          await probe.checkpoint('conversion');
          await retainSelectedRows(fixture.selection, stateful, probe, owner);
          return hashSend(
            route,
            fixture.selection,
            stateful,
            provider,
            probe,
            reference.bytes,
            reference.port,
          );
        },
        close: () => fixture.close(),
      };
    },
  };
}
