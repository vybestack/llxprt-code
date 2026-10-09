/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { createTelemetryAdapterFromConfig } from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import {
  initializeTelemetry,
  shutdownTelemetry,
} from '@vybestack/llxprt-code-telemetry/telemetry/sdk.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { prepareProviderContentSnapshot } from '@vybestack/llxprt-code-core/services/history/provider-curated-stream.js';
import type { ProviderRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { SemanticMediaPurgeBoundaryIdentity } from '@vybestack/llxprt-code-core/services/history/semantic-media-purge.js';
import { sourceRootSetup } from './prompt-envelope-source-test-helpers.js';
import { createSafeJsonReplacer, safeJsonStringify } from './turnJsonUtils.js';
import { stageTurnRequestArtifact } from './turn-request-artifact.js';
import { sourceHeap } from './streamprocessor-source-measurements.js';

const root = sourceRootSetup();
describe('boundary token retention eligibility', () => {
  it('rejects a mutable empty token instead of retaining its future graph', async () => {
    await expect(
      stageTurnRequestArtifact(
        root(),
        (async function* () {
          yield content(0, {}, 'all', false);
        })(),
      ),
    ).rejects.toThrow('Unsupported semantic purge boundary identity graph');
    expect(await readdir(root())).toHaveLength(0);
  });
});
describe('bounded JSON string slice parity', () => {
  it('preserves pairs across writer slices, lone surrogates and escaped text', async () => {
    const boundaryId = new SemanticMediaPurgeBoundaryIdentity({
      contentIndex: 0,
      blockIndex: 0,
    });
    const text =
      'x'.repeat(4095) +
      '😀' +
      '\ud800' +
      '\u0000'.repeat(8192) +
      '\udfff"\\\n';
    const owner = await prepareProviderContentSnapshot(
      {
        async *[Symbol.asyncIterator]() {
          for (let index = 0; index < 64; index++)
            yield {
              speaker: 'human',
              blocks: [{ type: 'text', text }],
              metadata: {
                semanticMediaPurgeBoundary: { blockIndex: 0, boundaryId },
              },
            } satisfies IContent;
        },
      },
      [],
      new DebugLogger('slice-boundary'),
      { root: root() },
    );
    try {
      const source = await stageTurnRequestArtifact(root(), rows(owner, true));
      const eager: IContent[] = [];
      for await (const row of rows(owner, true)) eager.push(row);
      expect(
        (await readFile(source.artifact_path)).equals(
          Buffer.from(safeJsonStringify(eager)),
        ),
      ).toBe(true);
      expect(source.row_count).toBe(64);
    } finally {
      owner.close();
    }
  }, 60000);
});

const positions = {
  independent: () => false,
  first: (index: number) => index === 0,
  middle: (index: number) => index === 32,
  last: (index: number) => index === 63,
  repeated: (index: number) => index % 3 === 0 || index === 63,
  all: () => true,
};
type Position = keyof typeof positions;
function content(
  index: number,
  boundaryId: object,
  position: Position,
  large: boolean,
): IContent {
  return {
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [
      {
        type: 'text',
        text:
          `${index}:雪"\\\n` +
          'x'.repeat(4095) +
          '😀\ud800!\udfff' +
          (large && index === 63 ? 'z'.repeat(10 * 1024 * 1024 + 1) : ''),
      },
    ],
    metadata: {
      turnId: 'last',
      ...(positions[position](index)
        ? { semanticMediaPurgeBoundary: { blockIndex: 0, boundaryId } }
        : {}),
      id: 'first',
      providerMetadata: {
        z: 'last',
        a: 'first',
        '12': 'integer',
        '2': 'integer first',
      },
    },
  };
}
async function snapshot(
  position: Position,
  large: boolean,
): Promise<ProviderRequestSnapshot> {
  const boundaryId = new SemanticMediaPurgeBoundaryIdentity({
    contentIndex: 0,
    blockIndex: 0,
  });
  return prepareProviderContentSnapshot(
    {
      async *[Symbol.asyncIterator]() {
        for (let index = 0; index < 64; index++)
          yield content(index, boundaryId, position, large);
      },
    },
    [],
    new DebugLogger('boundary-parity'),
    { root: root() },
  );
}
async function* rows(
  owner: ProviderRequestSnapshot,
  sameRow: boolean,
): AsyncGenerator<IContent> {
  for await (const row of owner.openReader()) {
    const id = row.metadata?.semanticMediaPurgeBoundary?.boundaryId;
    if (!sameRow || id === undefined) {
      yield row;
      continue;
    }
    const aliased: IContent = {
      ...row,
      metadata: {
        ...row.metadata,
        providerMetadata: { ...row.metadata?.providerMetadata, before: id },
        semanticMediaPurgeCacheWriteEvidence: {
          boundaryId: id,
          preparation: 'added',
        },
      },
    };
    yield aliased;
  }
}
async function oracle(
  owner: ProviderRequestSnapshot,
  sameRow: boolean,
): Promise<{ sha256: string; bytes: number; chars: number }> {
  const hash = createHash('sha256');
  const replacer = createSafeJsonReplacer();
  let bytes = 0;
  let chars = 0;
  const append = (text: string): void => {
    hash.update(text);
    bytes += Buffer.byteLength(text);
    chars += text.length;
  };
  append('[');
  let index = 0;
  for await (const row of rows(owner, sameRow)) {
    if (index++ > 0) append(',');
    append(JSON.stringify(row, replacer));
  }
  append(']');
  return { sha256: hash.digest('hex'), bytes, chars };
}
async function receipt(name: string, facts: unknown): Promise<void> {
  const evidence = process.env.ISSUE854_LOGGING_EVIDENCE;
  if (evidence === undefined) throw new Error('Missing disposable evidence');
  await writeFile(
    join(evidence, `${name}-${process.pid}.json`),
    JSON.stringify(facts, null, 2),
  );
}
async function parity(
  position: Position,
  large: boolean,
  sameRow: boolean,
): Promise<Awaited<ReturnType<typeof stageTurnRequestArtifact>>> {
  const owner = await snapshot(position, large);
  try {
    const expected = await oracle(owner, sameRow);
    const artifact = await stageTurnRequestArtifact(
      root(),
      rows(owner, sameRow),
    );
    const bytes = await readFile(artifact.artifact_path);
    await receipt(`boundary-${position}-${large}-${sameRow}`, {
      expected,
      artifact,
    });
    expect(artifact.row_count).toBe(64);
    expect(artifact.content_sha256).toBe(expected.sha256);
    expect(artifact.content_bytes).toBe(expected.bytes);
    expect(artifact.content_chars).toBe(expected.chars);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      expected.sha256,
    );
    if (large) expect(artifact.content_bytes).toBeGreaterThan(10 * 1024 * 1024);
    const eager: IContent[] = [];
    for await (const row of rows(owner, sameRow)) eager.push(row);
    expect(bytes.equals(Buffer.from(safeJsonStringify(eager)))).toBe(true);
    return artifact;
  } finally {
    owner.close();
  }
}
describe('normalized TEXT boundary request-wide byte parity', () => {
  it.each<Position>([
    'independent',
    'first',
    'middle',
    'last',
    'repeated',
    'all',
  ])(
    'matches 64 real normalized rows at %s',
    async (position) => {
      expect((await parity(position, false, false)).row_count).toBe(64);
    },
    60000,
  );
  it.each([false, true])(
    'matches boundary encountered earlier and later in each row, large=%s',
    async (large) => {
      expect((await parity('all', large, true)).row_count).toBe(64);
    },
    60000,
  );
  it('matches a valid oversized normalized text row with shared boundary', async () => {
    expect((await parity('all', true, false)).row_count).toBe(64);
  }, 60000);
});

describe('unsupported normalization identity inputs', () => {
  it.each(['nonempty', 'conflicting'])(
    'rejects %s boundary rather than retaining an arbitrary graph',
    async (mode) => {
      const first =
        mode === 'nonempty'
          ? { context: 'not a normalization token' }
          : Object.freeze({});
      let closed = false;
      await expect(
        stageTurnRequestArtifact(
          root(),
          (async function* () {
            try {
              yield content(0, first, 'all', false);
              yield content(1, Object.freeze({}), 'all', false);
            } finally {
              closed = true;
            }
          })(),
        ),
      ).rejects.toThrow(
        mode === 'nonempty'
          ? 'Unsupported semantic purge boundary identity graph'
          : 'Unsupported conflicting semantic purge boundary identities',
      );
      expect(closed).toBe(true);
      expect(await readdir(root())).toHaveLength(0);
    },
  );
});

describe('boundary writer release and retaining adverse controls', () => {
  it('releases all normalized rows with no alias shadow growth below strict 1 MiB', async () => {
    const warm = await snapshot('all', false);
    await stageTurnRequestArtifact(root(), rows(warm, true));
    warm.close();
    const owner = await snapshot('all', true);
    const baseline = await sourceHeap();
    const references: Array<WeakRef<IContent>> = [];
    const retained: IContent[] = [];
    const chunks: string[] = [];
    try {
      const artifact = await stageTurnRequestArtifact(
        root(),
        (async function* () {
          for await (const row of rows(owner, true)) {
            references.push(new WeakRef(row));
            if (process.env.ISSUE854_RETAIN_BOUNDARY === 'rows')
              retained.push(row);
            if (process.env.ISSUE854_RETAIN_BOUNDARY === 'chunks')
              chunks.push(safeJsonStringify(row));
            yield row;
          }
        })(),
      );
      owner.close();
      const settled = await sourceHeap();
      const facts = {
        baseline,
        settled,
        delta: settled - baseline,
        liveRows: references.filter((ref) => ref.deref() !== undefined).length,
        retainedRows: retained.length,
        retainedChunks: chunks.length,
        retainedChars: chunks.reduce((sum, text) => sum + text.length, 0),
        artifact,
      };
      await receipt(
        `boundary-release-${process.env.ISSUE854_RETAIN_BOUNDARY ?? 'normal'}`,
        facts,
      );
      expect(facts.liveRows).toBe(0);
      expect(facts.delta).toBeLessThan(1_048_576);
      expect(artifact.row_count).toBe(64);
    } finally {
      owner.close();
    }
  }, 60000);
});

function runtimeConfig(cap: number): Config {
  return new Config({
    cwd: root(),
    targetDir: root(),
    sessionId: 'boundary-runtime',
    model: 'gpt-5.6',
    debugMode: false,
    telemetry: {
      enabled: true,
      logPrompts: true,
      logApiBodies: true,
      logApiBodyMaxChars: cap,
      outfile: join(root(), 'boundary-runtime.jsonl'),
    },
  });
}
async function runtimeRecords(): Promise<Array<Record<string, unknown>>> {
  const schema = z.object({ attributes: z.record(z.unknown()).optional() });
  return (await readFile(join(root(), 'boundary-runtime.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .flatMap((line) => {
      const attributes = schema.parse(JSON.parse(line)).attributes;
      return attributes === undefined ? [] : [attributes];
    })
    .filter((attributes) =>
      String(attributes['event.name']).startsWith('llxprt_code.api_request'),
    );
}
function verifyRuntime(
  records: Array<Record<string, unknown>>,
  visible: string,
  source: Awaited<ReturnType<typeof stageTurnRequestArtifact>>,
): void {
  const digest = createHash('sha256')
    .update(JSON.stringify(visible))
    .digest('hex');
  expect(records[0]).toMatchObject({
    request_text_protocol: 'json-string-chunks-v1',
    request_chars: source.content_chars,
    content_bytes: source.content_bytes,
    content_sha256: source.content_sha256,
    visible_chars: visible.length,
    visible_bytes: Buffer.byteLength(JSON.stringify(visible)),
    visible_sha256: digest,
    schema_version: 4,
    truncated: visible.length < source.content_chars,
  });
  const chunks = records.filter(
    (event) => event['event.name'] === 'llxprt_code.api_request_chunk',
  );
  let offset = 0;
  const decoded: Buffer[] = [];
  for (const [index, chunk] of chunks.entries()) {
    const bytes = Buffer.from(z.string().parse(chunk.chunk_data), 'base64');
    expect(chunk).toMatchObject({
      chunk_index: index,
      chunk_byte_offset: offset,
      artifact_id: source.artifact_id,
    });
    expect(bytes.length).toBeLessThanOrEqual(16384);
    offset += bytes.length;
    decoded.push(bytes);
  }
  expect(
    Buffer.concat(decoded).equals(Buffer.from(JSON.stringify(visible))),
  ).toBe(true);
  expect(records[records.length - 1]).toMatchObject({
    'event.name': 'llxprt_code.api_request_complete',
    content_complete: true,
    chunk_count: chunks.length,
    visible_sha256: digest,
  });
}
async function capped(
  requested: number | 'split',
  large: boolean,
): Promise<Awaited<ReturnType<typeof stageTurnRequestArtifact>>> {
  const owner = await snapshot('all', large);
  const small = await snapshot('all', false);
  const eager: IContent[] = [];
  try {
    for await (const row of rows(small, true)) eager.push(row);
    const text = safeJsonStringify(eager);
    const cap = requested === 'split' ? text.indexOf('😀') + 1 : requested;
    const visible = text.slice(0, cap);
    if (requested === 'split')
      expect(visible.charCodeAt(visible.length - 1)).toBe(0xd83d);
    const expected = await oracle(owner, true);
    const source = await stageTurnRequestArtifact(root(), rows(owner, true));
    expect(source.content_sha256).toBe(expected.sha256);
    const active = runtimeConfig(cap);
    initializeTelemetry(active);
    try {
      const baseline = await sourceHeap();
      await createTelemetryAdapterFromConfig(active).logApiRequest({
        model: 'gpt-5.6',
        runtimeId: 'boundary-runtime',
        requestArtifact: {
          schema_version: 3,
          serialization: 'legacy-request-text-v1',
          source,
        },
      });
      const settled = await sourceHeap();
      const records = await runtimeRecords();
      verifyRuntime(records, visible, source);
      await receipt(`boundary-runtime-${requested}-${large}`, {
        cap,
        source,
        records,
        baseline,
        settled,
        delta: settled - baseline,
      });
      expect(settled - baseline).toBeLessThan(1_048_576);
      return source;
    } finally {
      await shutdownTelemetry(active);
    }
  } finally {
    owner.close();
    small.close();
  }
}
describe('actual boundary artifact runtime UTF-16 cap parity', () => {
  it.each<number | 'split'>([1, 2, 3, 4000, 50000, 'split'])(
    'exports identical capped legacy bytes at %s',
    async (cap) => {
      expect((await capped(cap, false)).row_count).toBe(64);
    },
    60000,
  );
  it('exports a valid >10MiB boundary artifact at a split surrogate cap', async () => {
    expect((await capped('split', true)).row_count).toBe(64);
  }, 60000);
});
