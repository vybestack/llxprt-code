/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
/**
 * A Responses disk-text projection that fails while its prepared context is
 * installed must give back everything it prepared: the transport token, the
 * scratch directories and the media reservation. The original error is the one
 * the caller sees.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalMediaStore } from '@vybestack/llxprt-code-core';
import { bindProviderMedia } from '@vybestack/llxprt-code-core/runtime/bindProviderMedia.js';
import { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  promptDirs,
  startSourceRouteHarness,
  type SourceRouteHarness,
} from './__tests__/support/source-route-harness.js';

/** Remembers every key the provider installs so the test can ask about it afterwards. */
class RecordingWeakMap<K extends object, V> extends WeakMap<K, V> {
  readonly installed: K[] = [];

  constructor(private readonly onInstall: () => void) {
    super();
  }

  override set(key: K, value: V): this {
    this.installed.push(key);
    const result = super.set(key, value);
    this.onInstall();
    return result;
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
    const controller = new AbortController();
    const reason = new SyntaxError(
      'projection cancelled after token installation',
    );
    const installed = new RecordingWeakMap<object, unknown>(() =>
      controller.abort(reason),
    );
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
    const before = promptDirs();
    const failure = await provider
      .projectPromptEnvelope({
        ...options,
        metadata: { ...options.metadata, abortSignal: controller.signal },
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(failure).toBeInstanceOf(SyntaxError);
    expect(failure).toBe(reason);
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
