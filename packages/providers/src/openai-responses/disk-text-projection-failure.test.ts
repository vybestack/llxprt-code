/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
/**
 * A Responses disk-text projection that fails while its prepared context is
 * installed must give back everything it prepared: the transport token, the
 * scratch directories and the media reservation. The original error is the one
 * the caller sees.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalMediaStore } from '@vybestack/llxprt-code-core';
import { bindProviderMedia } from '@vybestack/llxprt-code-core/runtime/bindProviderMedia.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import {
  promptDirs,
  startSourceRouteHarness,
  type SourceRouteHarness,
} from './__tests__/support/source-route-harness.js';

/** Remembers every key the provider installs so the test can ask about it afterwards. */
class RecordingWeakMap<K extends object, V> extends WeakMap<K, V> {
  readonly installed: K[] = [];

  override set(key: K, value: V): this {
    this.installed.push(key);
    return super.set(key, value);
  }
}

async function* corruptAfter(
  rows: AsyncGenerator<IContent, void>,
  after: () => void,
): AsyncGenerator<IContent, void> {
  try {
    yield* rows;
  } finally {
    after();
  }
}

describe('Responses disk-text projection adaptation failure', () => {
  let harness: SourceRouteHarness;
  let directory: string;
  let store: LocalMediaStore;
  let resolver: RequestMediaResolver;

  beforeEach(async () => {
    harness = await startSourceRouteHarness();
    directory = await mkdtemp(join(tmpdir(), 'llxprt-responses-adapt-fail-'));
    store = new LocalMediaStore({ rootDirectory: directory, quotaBytes: 4096 });
    resolver = new RequestMediaResolver(store);
  });
  afterEach(async () => {
    await harness.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('propagates the adaptation error and releases the token, scratch and media reservation', async () => {
    const image = await store.admit({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      semanticMetadata: { variantPolicy: 'admitted-v1' },
    });
    const installed = new RecordingWeakMap<object, unknown>();
    Object.defineProperty(harness.setup.provider, 'preparedPromptEnvelopes', {
      value: installed,
    });
    const rows: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'see' }, image] },
    ];
    const options = harness.options(rows, {});
    const provider = bindProviderMedia(
      harness.setup.provider,
      resolver,
      image.normalizedBase64Length,
    );
    const selection = options.requestRows;
    if (selection === undefined) throw new Error('Missing request selection');
    const before = promptDirs();
    // The projection adapter reads the unsupported-media ledger back once the
    // serializer has consumed the rows. A ledger the serializer did not write
    // makes that real adapter throw after the prepared context exists.
    const corruptLedgers = (): void => {
      for (const entry of promptDirs()) {
        if (before.has(entry)) continue;
        const ledger = join(getScratchRoot(), entry, 'unsupported-media.jsonl');
        if (existsSync(ledger)) writeFileSync(ledger, 'not json\n');
      }
    };
    const corrupting: ProviderRequestSelection = {
      count: selection.count,
      close: () => selection.close(),
      openReader: (signal) =>
        corruptAfter(selection.openReader(signal), corruptLedgers),
    };
    const failure = await provider
      .projectPromptEnvelope({ ...options, requestRows: corrupting })
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(failure).toBeInstanceOf(SyntaxError);
    expect(installed.installed).toHaveLength(1);
    expect(installed.has(installed.installed[0])).toBe(false);
    expect(
      [...promptDirs()].filter((entry) => !before.has(entry)),
    ).toHaveLength(0);
    expect(resolver.accounting()).toMatchObject({
      activeRequestCount: 0,
      reservedContentCount: 0,
      materializedNormalizedBytes: 0,
    });
  }, 60000);
});
