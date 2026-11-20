/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type {
  IContent,
  SemanticMediaPurgeCacheWriteEvidence,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { WireSettings, CacheSettings } from './wireBuilderHarness.js';

const parsedWire: unknown = JSON.parse(
  gunzipSync(
    readFileSync(
      new URL(
        '../../../__tests__/fixtures/retired-table-wire.json.gz',
        import.meta.url,
      ),
    ),
  ).toString('utf8'),
);
const parsedEvidence: unknown = JSON.parse(
  readFileSync(
    new URL(
      '../../../__tests__/fixtures/retired-table-evidence.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
if (
  typeof parsedWire !== 'object' ||
  parsedWire === null ||
  typeof parsedEvidence !== 'object' ||
  parsedEvidence === null
)
  throw new Error('Invalid retired table fixtures');
const recordedWire = parsedWire;
const recordedEvidence = parsedEvidence;

export async function recordedMessages(
  rows: readonly IContent[],
  settings: WireSettings,
  cache: CacheSettings = {},
): Promise<string> {
  const key = createHash('sha256')
    .update(JSON.stringify([rows, settings, cache]))
    .digest('hex');
  const value: unknown = Reflect.get(recordedWire, key);
  if (typeof value !== 'string')
    throw new Error(`Missing retired table wire bytes: ${key}`);
  return value;
}

export async function recordedCachedMessages(
  rows: readonly IContent[],
  settings: WireSettings,
  cache: CacheSettings,
): Promise<{
  readonly json: string;
  readonly evidence:
    | Pick<SemanticMediaPurgeCacheWriteEvidence, 'preparation'>
    | undefined;
}> {
  const key = createHash('sha256')
    .update(JSON.stringify([rows, settings, cache]))
    .digest('hex');
  const value: unknown = Reflect.get(recordedEvidence, key);
  if (value === undefined)
    return {
      json: await recordedMessages(rows, settings, cache),
      evidence: undefined,
    };
  if (typeof value !== 'object' || value === null)
    throw new Error('Invalid recorded evidence');
  const preparation: unknown = Reflect.get(value, 'preparation');
  if (preparation !== 'added' && preparation !== 'reused')
    throw new Error('Invalid preparation evidence');
  return {
    json: await recordedMessages(rows, settings, cache),
    evidence: { preparation },
  };
}
