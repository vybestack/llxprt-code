/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { ProviderRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createSessionRecorder } from '@vybestack/llxprt-code-core/recording/sessionRecorderFactory.js';
import {
  realisticSessionRows,
  realisticSessionSummary,
  type RealisticSessionRow,
} from '../../../test-utils/src/core/realistic-session.js';
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
} from '../../../test-utils/src/core/session-memory-protocol.js';
import { withRequestRepresentationObserver } from '@vybestack/llxprt-code-providers/utils/requestScopedBody.js';
import { OpenAIVercelProvider } from './OpenAIVercelProvider.js';
import { convertToVercelMessages } from './messageConversion.js';
import { vercelWireMessages } from './streamed-request.js';
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

const model = 'gpt-4o';
const field = 'messages';
function wire(row: IContent): unknown[] {
  return convertToVercelMessages([row]).flatMap((entry) =>
    vercelWireMessages(entry, 'system'),
  );
}
function reply(): Response {
  return Response.json({
    id: 'test',
    object: 'chat.completion',
    created: 1,
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'ok' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Expected envelope');
  return value;
}

const provider = new OpenAIVercelProvider('test');
const base = createProviderCallOptions({
  providerName: 'openaivercel',
  contents: { async *[Symbol.asyncIterator](): AsyncGenerator<IContent> {} },
  ephemerals: { streaming: 'disabled', 'tool-output-max-tokens': false },
  resolved: { model, streaming: false },
});
let envelope: Record<string, unknown> = {};
const originalFetch = globalThis.fetch;
const control = process.argv.includes('--control')
  ? createWholeHistoryBufferingControl()
  : undefined;
interface JournalFixture {
  readonly selection: ProviderRequestSnapshot;
  readonly history: HistoryService;
  readonly recording: ReturnType<typeof createSessionRecorder>;
  readonly directory: string;
  readonly journalBytes: number;
}
async function seedJournal(): Promise<JournalFixture> {
  const directory = await mkdtemp(join(tmpdir(), 'llxprt-vercel-realistic-'));
  const recording = createSessionRecorder({
    sessionId: 'realistic',
    projectHash: 'realistic',
    workspaceDirs: [directory],
    chatsDir: directory,
    provider: 'openaivercel',
    model,
  });
  const history = new HistoryService({ recording });
  let batch: IContent[] = [];
  for (const row of realisticSessionRows()) {
    batch.push(content(row));
    if (batch.length === 64) {
      await history.addBatch(batch);
      batch = [];
    }
  }
  if (batch.length > 0) await history.addBatch(batch);
  batch = [];
  await history.waitForCommit();
  const selection = await history.prepareCuratedForProviderSnapshot([]);
  if (selection.count !== 25_000)
    throw new Error(`Selection lost rows: ${selection.count}`);
  const path = recording.getFilePath();
  if (path === null) throw new Error('Missing journal');
  return {
    selection,
    history,
    recording,
    directory,
    journalBytes: (await stat(path)).size,
  };
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
    if (!Array.isArray(value)) throw new Error('Expected messages');
    for (const initial of value.filter(
      (entry: unknown) =>
        isRecord(entry) &&
        (entry['role'] === 'system' || entry['role'] === 'developer'),
    )) {
      update(rowComma ? ',' : '');
      rowComma = true;
      update(JSON.stringify(initial));
    }
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
async function consumeUpload(
  init: RequestInit | undefined,
  probe: SessionProbe,
  progress: { readonly rows: number },
): Promise<SessionWireDigest> {
  if (!(init?.body instanceof ReadableStream))
    throw new Error('Expected streamed body');
  const actual = createHash('sha256');
  let received = 0;
  let nextQuarter = 6250;
  let lastCollection = 0;
  await probe.checkpoint('transport-entry');
  await probe.checkpoint('paused-upload');
  const reader = init.body.getReader();
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      actual.update(next.value);
      received += next.value.byteLength;
      if (progress.rows >= lastCollection + 256) {
        await probe.checkpoint('conversion');
        lastCollection = progress.rows;
      }
      if (progress.rows >= nextQuarter && nextQuarter <= 18750) {
        await probe.checkpoint(quarterPhase(nextQuarter));
        nextQuarter += 6250;
      }
    }
  } finally {
    reader.releaseLock();
  }
  await probe.checkpoint('body-admission');
  return { bytes: received, sha256: actual.digest('hex') };
}
async function runSend(
  selection: Awaited<ReturnType<typeof seedJournal>>['selection'],
  probe: SessionProbe,
  owner: SessionPayloadOwner,
): Promise<SessionWireDigest> {
  const progress = { rows: 0 };
  let uploaded: SessionWireDigest | undefined;
  globalThis.fetch = Object.assign(
    async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      uploaded = await consumeUpload(init, probe, progress);
      return reply();
    },
    { preconnect() {} },
  );
  await probe.checkpoint('conversion');
  await withRequestRepresentationObserver(
    (kind, value) => {
      if (
        kind === 'wire' &&
        !(
          isRecord(value) &&
          (value['role'] === 'system' || value['role'] === 'developer')
        )
      ) {
        owner.retain(JSON.stringify(value));
        progress.rows++;
      }
      if (
        kind === 'buffer' &&
        (progress.rows % 512 === 0 ||
          (value instanceof Uint8Array && value.byteLength > 1024 * 1024))
      )
        probe.sample('conversion');
    },
    async () => {
      for await (const chunk of provider.generateChatCompletion({
        ...base,
        requestRows: selection,
        contentCount: selection.count,
      }))
        void chunk;
    },
  );
  if (progress.rows !== selection.count)
    throw new Error(`Converted ${progress.rows} rows`);
  if (uploaded === undefined) throw new Error('Missing upload');
  return uploaded;
}
const measurement = await measureRealisticSession(
  {
    routeId: 'openaivercel',
    operation: 'send',
    async warmup(): Promise<void> {
      globalThis.fetch = Object.assign(
        async (
          _input: RequestInfo | URL,
          init?: RequestInit,
        ): Promise<Response> => {
          envelope = record(JSON.parse(await new Response(init?.body).text()));
          return reply();
        },
        { preconnect() {} },
      );
      for await (const chunk of provider.generateChatCompletion({
        ...base,
        requestRows: {
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
    },
    async prepare(): Promise<PreparedSessionRoute> {
      const { selection, history, recording, directory, journalBytes } =
        await seedJournal();
      const { reference, selectedPayloadBytes } = referenceDigest();
      return {
        corpus: {
          ...realisticSessionSummary(),
          selectedRowCount: selection.count,
          journalBytes,
          selectedPayloadBytes,
        },
        reference,
        run: (probe, owner) => runSend(selection, probe, owner),
        async close(): Promise<void> {
          globalThis.fetch = originalFetch;
          await selection.close();
          await history.dispose();
          await recording.dispose();
          await rm(directory, { recursive: true, force: true });
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
