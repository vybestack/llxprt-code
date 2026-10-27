/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { realisticNativeFixture } from './realistic-native-fixture.js';
import type { ProviderRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  realisticSessionRows,
  realisticSessionSummary,
  type RealisticSessionRow,
} from '../../../../test-utils/src/core/realistic-session.js';
import {
  assertSessionMemory,
  assertWholeHistoryControl,
  createWholeHistoryBufferingControl,
  measureRealisticSession,
  type PreparedSessionRoute,
  type SessionCheckpoint,
  type SessionProbe,
  type SessionPayloadOwner,
  type SessionWireDigest,
} from '../../../../test-utils/src/core/session-memory-protocol.js';
import WebSocket from 'ws';
import { WsTransportSocket } from '../../openai-responses/responses-websocket-socket.js';
import {
  createCodexResponsesWebSocketTransport,
  type WebSocketTransport,
} from '../../openai-responses/openAIResponsesWebSocketTransport.js';
import { OpenAIResponsesProvider } from '../../openai-responses/OpenAIResponsesProvider.js';
import { buildOpenAIResponsesUnit } from '../../openai-responses/OpenAIResponsesInputBuilder.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-test-utils/core/providerCallOptions.js';

function content(row: RealisticSessionRow): IContent {
  if (row.kind === 'tool-call')
    return {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: row.callId ?? '',
          name: row.toolName ?? '',
          parameters: { text: row.text },
        },
      ],
    };
  if (row.kind === 'tool-result')
    return {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: row.callId ?? '',
          toolName: row.toolName ?? '',
          result: row.text,
        },
      ],
    };
  return {
    speaker: row.role === 'human' ? 'human' : 'ai',
    blocks: [{ type: 'text', text: row.text }],
  };
}

const model = 'gpt-5.6-sol';
const field = 'input';
function wire(row: IContent): unknown[] {
  return buildOpenAIResponsesUnit(
    row,
    {
      includeReasoningInContext: false,
      outputLimits: { tokenLimit: { kind: 'disabled' } },
      mediaPdfEnabled: false,
      debug(): void {},
    },
    { hasCall: () => true, hasResponse: () => true },
    () => {
      throw new Error('Unexpected reasoning');
    },
  );
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Expected envelope');
  return value;
}

const receiver = Bun.spawn(
  [process.execPath, `${import.meta.dir}/realistic-websocket-receiver.ts`],
  { stdout: 'pipe', stderr: 'inherit' },
);
try {
  async function* receiverLines(): AsyncGenerator<string> {
    const decoder = new TextDecoder();
    let pending = '';
    const reader = receiver.stdout.getReader();
    for (;;) {
      const next = await reader.read();
      if (next.done) return;
      const chunk = next.value;
      pending += decoder.decode(chunk, { stream: true });
      let newline = pending.indexOf('\n');
      while (newline >= 0) {
        yield pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        newline = pending.indexOf('\n');
      }
    }
  }
  const lines = receiverLines();
  async function nextMessage(): Promise<Record<string, unknown>> {
    const next = await lines.next();
    if (next.done === true) throw new Error('Receiver closed');
    return record(JSON.parse(next.value));
  }
  const endpointValue = (await nextMessage())['url'];
  if (typeof endpointValue !== 'string')
    throw new Error('Missing WebSocket endpoint');
  const endpoint = endpointValue;
  let activeProbe: SessionProbe | undefined;
  class MeasuredSocket extends WsTransportSocket {
    private entered = false;
    override async sendFragment(data: Uint8Array, fin: boolean): Promise<void> {
      if (!this.entered) {
        this.entered = true;
        await activeProbe?.checkpoint('transport-entry');
        await activeProbe?.checkpoint('paused-upload');
      }
      if (data.byteLength > 1024 * 1024) activeProbe?.sample('conversion');
      await super.sendFragment(data, fin);
      if (fin) await activeProbe?.checkpoint('body-admission');
    }
  }
  class CodexProvider extends OpenAIResponsesProvider {
    constructor() {
      super('test', endpoint, undefined, undefined, [], 'codex');
    }
    protected override async getCodexAccountId(): Promise<string> {
      return 'test-account';
    }
    protected override createWebSocketTransport(): WebSocketTransport {
      return createCodexResponsesWebSocketTransport({
        openSocket: (url, headers) =>
          new MeasuredSocket(new WebSocket(url, { headers })),
      });
    }
  }
  const provider = new CodexProvider();
  const base = createProviderCallOptions({
    providerName: 'codex',
    contents: { async *[Symbol.asyncIterator](): AsyncGenerator<IContent> {} },
    ephemerals: {
      'responses-stateful': false,
      'tool-output-max-tokens': false,
    },
    resolved: { model, baseURL: endpoint, authToken: 'test' },
  });
  let envelope: Record<string, unknown> = {};
  const originalFetch = globalThis.fetch;
  const control = process.argv.includes('--control')
    ? createWholeHistoryBufferingControl()
    : undefined;
  interface JournalFixture {
    readonly selection: ProviderRequestSnapshot;
    readonly journalBytes: number;
    observe(probe: SessionProbe): void;
    close(): Promise<void>;
  }
  async function seedJournal(): Promise<JournalFixture> {
    const directory = join(import.meta.dir, '../../../../../tmp/r10-retained');
    await mkdir(directory, { recursive: true });
    const fixture = await realisticNativeFixture(directory);
    if (fixture.selection.count !== 25_000)
      throw new Error(`Selection lost rows: ${fixture.selection.count}`);
    return fixture;
  }
  function quarterPhase(rows: number): SessionCheckpoint {
    if (rows === 6250) return 'quarter';
    if (rows === 12500) return 'half';
    return 'three-quarter';
  }
  function* serializedRows(): Generator<string> {
    for (const row of realisticSessionRows())
      for (const entry of wire(content(row))) yield JSON.stringify(entry);
  }
  function referenceDigest(): {
    readonly reference: SessionWireDigest;
    readonly selectedPayloadBytes: number;
  } {
    const expected = createHash('sha256');
    let bytes = 0;
    let selectedPayloadBytes = 0;
    const update = (text: string): void => {
      expected.update(text);
      bytes += Buffer.byteLength(text);
    };
    update('{');
    let comma = false;
    for (const [key, value] of Object.entries(envelope)) {
      if (comma) update(',');
      comma = true;
      update(`${JSON.stringify(key)}:`);
      if (key !== field) {
        update(JSON.stringify(value));
        continue;
      }
      update('[');
      let rowComma = false;
      for (const encoded of serializedRows()) {
        update(rowComma ? ',' : '');
        rowComma = true;
        selectedPayloadBytes += Buffer.byteLength(encoded);
        update(encoded);
      }
      update(']');
    }
    update('}');
    const reference = { bytes, sha256: expected.digest('hex') };
    return { reference, selectedPayloadBytes };
  }
  async function runSend(
    selection: Awaited<ReturnType<typeof seedJournal>>['selection'],
    probe: SessionProbe,
    owner: SessionPayloadOwner,
  ): Promise<SessionWireDigest> {
    activeProbe = probe;
    let rows = 0;
    let nextQuarter = 6250;
    await probe.checkpoint('conversion');
    const observed = {
      count: selection.count,
      native: selection.native,
      index: selection.index,
      readAt: selection.readAt.bind(selection),
      close: async (): Promise<void> => {
        await selection.close();
      },
      async *openReader(signal?: AbortSignal): AsyncGenerator<IContent> {
        for await (const row of selection.openReader(signal)) {
          const payload = wire(row)
            .map((entry) => JSON.stringify(entry))
            .join(',');
          owner.retain(payload);
          rows++;
          if (rows % 3125 === 0) await probe.checkpoint('conversion');
          else if (rows % 256 === 0) probe.sample('conversion');
          if (rows === nextQuarter && nextQuarter <= 18750) {
            await probe.checkpoint(quarterPhase(nextQuarter));
            nextQuarter += 6250;
          }
          yield row;
        }
      },
    };
    for await (const chunk of provider.generateChatCompletion({
      ...base,
      requestRows: observed,
      contentCount: selection.count,
    }))
      void chunk;
    activeProbe = undefined;
    if (rows !== selection.count) throw new Error(`Converted ${rows} rows`);
    const received = await nextMessage();
    if (
      received['binary'] !== true ||
      typeof received['bytes'] !== 'number' ||
      typeof received['sha256'] !== 'string'
    )
      throw new Error('WebSocket receiver did not confirm a binary frame');
    return { bytes: received['bytes'], sha256: received['sha256'] };
  }
  const measurement = await measureRealisticSession(
    {
      routeId: 'codex-websocket',
      operation: 'send',
      async warmup(): Promise<void> {
        globalThis.fetch = Object.assign(
          async (): Promise<Response> => {
            throw new Error('HTTP fallback forbidden');
          },
          { preconnect() {} },
        );
        for await (const chunk of provider.generateChatCompletion({
          ...base,
          contentCount: 4,
          requestRows: {
            callerOwned: true,
            close(): void {},
            count: 4,
            readAt: (index: number) => {
              const row = Array.from(
                realisticSessionRows({ rowCount: 4, payloadBytes: 1024 }),
              )[index];
              if (!Number.isInteger(index) || index < 0 || index >= 4)
                throw new RangeError('Warmup row');
              return content(row);
            },
            async *openReader(): AsyncGenerator<IContent> {
              for (const row of realisticSessionRows({
                rowCount: 4,
                payloadBytes: 1024,
              }))
                yield content(row);
            },
          },
        }))
          void chunk;
        envelope = record((await nextMessage())['envelope']);
        provider.clearState();
      },
      async prepare(): Promise<PreparedSessionRoute> {
        const fixture = await seedJournal();
        const { selection, journalBytes } = fixture;
        const { reference, selectedPayloadBytes } = referenceDigest();
        return {
          corpus: {
            ...realisticSessionSummary(),
            selectedRowCount: selection.count,
            journalBytes,
            selectedPayloadBytes,
          },
          reference,
          run: (probe, owner) => {
            fixture.observe(probe);
            return runSend(selection, probe, owner);
          },
          async close(): Promise<void> {
            globalThis.fetch = originalFetch;
            provider.dispose();
            receiver.kill();
            await receiver.exited;
            await fixture.close();
          },
        };
      },
    },
    control,
  );
  process.stdout.write(
    `${JSON.stringify({ ...measurement, samples: measurement.samples.filter((sample) => sample.checkpoint !== 'interval' && sample.checkpoint !== 'conversion'), heapPeak: measurement.samples.reduce((peak, sample) => (sample.heapBytes > peak.heapBytes ? sample : peak)), bufferPeak: measurement.samples.reduce((peak, sample) => (sample.bufferBytes > peak.bufferBytes ? sample : peak)) })}\n`,
  );
  if (control === undefined) assertSessionMemory(measurement);
  else {
    assertWholeHistoryControl(measurement, control);
    control.release();
  }
} finally {
  receiver.kill();
  await receiver.exited;
}
