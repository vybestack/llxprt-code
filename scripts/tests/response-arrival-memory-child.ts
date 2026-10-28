/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { gcAndSweep, heapSize } from 'bun:jsc';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { createHash, type Hash } from 'node:crypto';
import type { DirectoryBlock } from '../../packages/core/src/journal/row-directory.js';
import { createSessionRecorder } from '../../packages/core/src/recording/sessionRecorderFactory.js';
import { openJournalReadOnly } from '../../packages/core/src/journal/journalReader.js';
import { TranscriptReader } from '../../packages/core/src/journal/transcript-reader.js';
import { sha256KeyHash } from '../../packages/core/src/journal/idKeys.js';
import { estimateTokens } from '../../packages/core/src/utils/toolOutputLimiter.js';
import { NeutralTextStream } from '../../packages/core/src/utils/neutral-text-stream.js';
import type {
  IContent,
  MediaReferenceBlock,
} from '../../packages/core/src/services/history/IContent.js';
import type { PreparedHistoryBatchEffect } from '../../packages/core/src/services/history/historyBatchContracts.js';
import type { RowOwnership } from '../../packages/core/src/recording/rowOwnership.js';
import { HistoryMediaOwnership } from '../../packages/core/src/storage/history-media-ownership.js';
import { LocalMediaStore } from '../../packages/core/src/storage/local-media-store.js';
import { TurnProcessor } from '../../packages/agents/src/core/TurnProcessor.js';
import {
  processorFixture,
  sourcePending,
} from '../../packages/agents/src/core/__tests__/support/streamprocessor-source-fixture.js';

type Mode = 'direct' | 'streaming';
interface Measurement {
  heap: number;
  external: number;
}

async function settled(): Promise<Measurement> {
  await setImmediate();
  gcAndSweep();
  await setImmediate();
  gcAndSweep();
  return { heap: heapSize(), external: process.memoryUsage().external };
}

function directProcessor(
  setup: Awaited<ReturnType<typeof processorFixture>>,
): TurnProcessor {
  return new TurnProcessor(
    setup.runtime,
    setup.compression,
    () => setup.provider,
    (_source, metadata) => ({ ...setup.runtime.providerRuntime, metadata }),
    setup.generation,
    setup.history,
    setup.processor,
    () => setup.runtime.state.baseUrl,
  );
}

async function addBlock(hash: Hash, block: DirectoryBlock): Promise<number> {
  let bytes = 0;
  for await (const part of block.parts()) {
    if (part.byteLength > 65536) throw new Error('Unbounded journal part');
    bytes += part.byteLength;
    hash.update(part);
  }
  return bytes;
}

async function journalDigest(
  path: string,
): Promise<{ bytes: number; hash: string }> {
  const file = await openJournalReadOnly(path);
  try {
    const reader = new TranscriptReader(file, sha256KeyHash);
    const entries = await reader.page({ direction: 'forward', limit: 16 });
    const response = entries.find(
      (entry) => entry.attemptRef !== 0 && entry.status === 1,
    );
    if (response === undefined) throw new Error('Missing completed response');
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const block of reader.blocks(response))
      bytes += await addBlock(hash, block);
    return { bytes, hash: hash.digest('hex') };
  } finally {
    await file.close();
  }
}

async function send(
  setup: Awaited<ReturnType<typeof processorFixture>>,
  mode: Mode,
): Promise<void> {
  if (mode === 'direct') {
    const receipt = await directProcessor(setup).sendMessage(
      { message: 'probe' },
      'probe',
    );
    if (receipt.status !== 'published' || 'content' in receipt)
      throw new Error('Direct send retained its response payload');
    return;
  }
  const stream = await setup.processor.makeApiCallAndProcessStream(
    { message: 'probe', config: {} },
    'probe',
    sourcePending,
  );
  for await (const event of stream) void event;
}

class ArrivalMemoryCensus {
  private readonly held: string[] = [];
  private readonly oracle = createHash('sha256');
  private peak: Measurement;
  private countedBytes = 0;
  private delivered = 0;
  private readonly checkpoints: Record<string, Measurement> = {};
  constructor(
    private readonly chunks: number,
    private readonly trap: boolean,
    private readonly before: Measurement,
  ) {
    this.peak = before;
    this.oracle.update('{"type":"text","text":"');
  }
  async sample(phase: string): Promise<void> {
    const measurement = await settled();
    this.checkpoints[phase] = {
      heap: measurement.heap - this.before.heap,
      external: measurement.external - this.before.external,
    };
    this.peak = {
      heap: Math.max(this.peak.heap, measurement.heap),
      external: Math.max(this.peak.external, measurement.external),
    };
  }
  async countTokens(content: unknown): Promise<number> {
    if (typeof content !== 'string') throw new Error('Expected token text');
    this.countedBytes = Math.max(this.countedBytes, Buffer.byteLength(content));
    if (content.length > 65536) await this.sample('tokens');
    return estimateTokens(content);
  }
  async countTokenStream(parts: AsyncIterable<Uint8Array>): Promise<number> {
    const counter = new NeutralTextStream();
    let bytes = 0;
    for await (const part of parts) {
      if (part.byteLength > 65536) throw new Error('Unbounded token input');
      counter.append(part);
      bytes += part.byteLength;
    }
    this.countedBytes = Math.max(this.countedBytes, bytes);
    await this.sample('tokens');
    return counter.finish();
  }
  async *responses(): AsyncGenerator<IContent> {
    for (let index = 0; index < this.chunks; index++) {
      const text =
        `${index.toString().padStart(8, '0')}:` +
        'arrival_word '.repeat(5040) +
        'end';
      if (this.trap) this.held.push(text);
      this.oracle.update(text);
      this.delivered++;
      yield { speaker: 'ai', blocks: [{ type: 'text', text }] };
    }
    await this.sample('arrival');
    yield { speaker: 'ai', blocks: [], metadata: { finishReason: 'stop' } };
  }
  result(stored: { hash: string; bytes: number }, mode: Mode): object {
    this.oracle.update('"}');
    if (stored.hash !== this.oracle.digest('hex'))
      throw new Error('Response journal differs from streamed bytes');
    if (
      this.delivered !== this.chunks ||
      (this.trap && this.held.length !== this.chunks)
    )
      throw new Error('Incomplete workload');
    return {
      chunks: this.chunks,
      trap: this.trap,
      mode,
      retainedBytes: this.peak.heap - this.before.heap,
      retainedExtraBytes: this.peak.external - this.before.external,
      countedBytes: this.countedBytes,
      outputBytes: stored.bytes,
      delivered: this.delivered,
      heldChunks: this.held.length,
      checkpoints: this.checkpoints,
    };
  }
}

class ObservedMediaOwner extends HistoryMediaOwnership {
  constructor(
    store: LocalMediaStore,
    private readonly observe: () => Promise<void>,
  ) {
    super(store);
  }
  override prepareReferenceAddition(
    references:
      | AsyncIterable<MediaReferenceBlock>
      | Iterable<MediaReferenceBlock>,
    ownership?: RowOwnership,
  ): PreparedHistoryBatchEffect {
    const effect = super.prepareReferenceAddition(references, ownership);
    return {
      ...effect,
      publish: async () => {
        await this.observe();
        await effect.publish();
      },
    };
  }
}

async function probe(
  root: string,
  chunks: number,
  trap: boolean,
  mode: Mode,
): Promise<object> {
  const setup = await processorFixture(root, 'http://127.0.0.1:1/v1', false, 0);
  const recording = createSessionRecorder({
    sessionId: 'response-memory',
    projectHash: 'response-memory',
    chatsDir: root,
    workspaceDirs: [],
    provider: 'test',
    model: 'gpt-5.6',
  });
  await setup.history.attachJournal(recording);
  const census = new ArrivalMemoryCensus(chunks, trap, await settled());
  const media = new LocalMediaStore({
    rootDirectory: join(root, 'media'),
    quotaBytes: 4096,
  });
  await setup.history.registerMediaOwner(
    new ObservedMediaOwner(media, () => census.sample('publication')),
  );
  setup.history.setTokenizerFactory({
    getTokenizer: () => ({
      countTokens: (content) => census.countTokens(content),
      countTokenStream: (parts) => census.countTokenStream(parts),
    }),
  });
  setup.provider.generateChatCompletion = () => census.responses();
  try {
    await send(setup, mode);
    await setup.history.waitForTokenUpdates();
    await census.sample('completed');
    const path = recording.getFilePath();
    if (path === null) throw new Error('Missing recording path');
    return census.result(await journalDigest(path), mode);
  } finally {
    await setup.history.dispose();
    await media.close();
    await recording.dispose();
    await setup.config.dispose();
  }
}

const chunks = Number(process.argv[2]);
if (!Number.isSafeInteger(chunks) || chunks < 1)
  throw new Error('Expected positive chunk count');
const mode = process.argv[4];
if (mode !== 'direct' && mode !== 'streaming')
  throw new Error('Expected send mode');
const root = await mkdtemp(join(tmpdir(), 'response-arrival-memory-'));
const keepAlive = setInterval(() => undefined, 1000);
try {
  // Warm every production stage with the small workload; a large warm-up in
  // every child otherwise dominates the paired measurement's runtime.
  await probe(join(root, 'warm'), 32, false, mode);
  const result = await probe(
    join(root, 'measured'),
    chunks,
    process.argv[3] === 'trap',
    mode,
  );
  process.stdout.write(JSON.stringify(result) + '\n');
} finally {
  clearInterval(keepAlive);
  await rm(root, { recursive: true, force: true });
}
