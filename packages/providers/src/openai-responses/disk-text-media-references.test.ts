/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalMediaStore } from '@vybestack/llxprt-code-core';
import type {
  IContent,
  MediaReferenceBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { bindProviderMedia } from '@vybestack/llxprt-code-core/runtime/bindProviderMedia.js';
import { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import {
  promptDirs,
  startSourceRouteHarness,
  type SourceRouteHarness,
} from './__tests__/support/source-route-harness.js';

const PNG_BYTES = new Uint8Array([1, 2, 3]);
const OTHER_PNG_BYTES = new Uint8Array([4, 5, 6]);
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

describe('Responses source route stored media references', () => {
  let harness: SourceRouteHarness;
  let directory: string;
  let store: LocalMediaStore;
  let resolver: RequestMediaResolver;

  beforeEach(async () => {
    harness = await startSourceRouteHarness();
    directory = await mkdtemp(join(tmpdir(), 'llxprt-responses-source-media-'));
    store = new LocalMediaStore({ rootDirectory: directory, quotaBytes: 4096 });
    resolver = new RequestMediaResolver(store);
  });
  afterEach(async () => {
    await harness.close();
    await rm(directory, { recursive: true, force: true });
  });

  const admit = (
    bytes: Uint8Array,
    mimeType = 'image/png',
  ): Promise<MediaReferenceBlock> =>
    store.admit({
      bytes,
      mimeType,
      semanticMetadata: { variantPolicy: 'admitted-v1' },
    });

  // The media resolver and aggregate budget are provider-bound state; the
  // request options carry only the invocation.
  function mediaProvider(budget: number): typeof harness.setup.provider {
    return bindProviderMedia(harness.setup.provider, resolver, budget);
  }

  async function project(
    rows: readonly IContent[],
    budget: number,
    ephemerals: Record<string, unknown> = {},
  ): Promise<PromptEnvelopeProjection> {
    return mediaProvider(budget).projectPromptEnvelope(
      harness.options(rows, ephemerals),
    );
  }

  async function sendProjected(
    rows: readonly IContent[],
    budget: number,
    ephemerals: Record<string, unknown> = {},
  ): Promise<void> {
    const provider = mediaProvider(budget);
    const options = harness.options(rows, ephemerals);
    const projection = await provider.projectPromptEnvelope(options);
    for await (const _ of provider.generateChatCompletion({
      ...options,
      promptEnvelopeTransportToken: projection.transportToken,
    }));
  }

  const idle = {
    activeRequestCount: 0,
    reservedContentCount: 0,
    materializedNormalizedBytes: 0,
  };

  it('sends an admitted reference image as the inline data URI and releases its reservation', async () => {
    const image = await admit(PNG_BYTES);
    const before = promptDirs();
    await sendProjected(
      [{ speaker: 'human', blocks: [{ type: 'text', text: 'see' }, image] }],
      image.normalizedBase64Length,
    );
    const body = JSON.parse(harness.bodies[0]) as { input: unknown[] };
    expect(body.input).toStrictEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'see' },
          { type: 'input_image', image_url: 'data:image/png;base64,AQID' },
        ],
      },
    ]);
    expect(resolver.accounting()).toStrictEqual({ ...idle, storeReadCount: 1 });
    expect([...promptDirs()].filter((e) => !before.has(e))).toHaveLength(0);
  }, 60000);

  it('sends an enabled reference PDF as an input file', async () => {
    const pdf = await admit(PDF_BYTES, 'application/pdf');
    await sendProjected(
      [{ speaker: 'human', blocks: [pdf] }],
      pdf.normalizedBase64Length,
    );
    const body = JSON.parse(harness.bodies[0]) as {
      input: Array<{ content: Array<Record<string, unknown>> }>;
    };
    expect(body.input[0].content[0]['type']).toBe('input_file');
    expect(body.input[0].content[0]['file_data']).toBe(
      'data:application/pdf;base64,JVBERg==',
    );
    expect(resolver.accounting()).toStrictEqual({ ...idle, storeReadCount: 1 });
  }, 60000);

  it('resolves the media of a stateful suffix only and never reads media before the parent', async () => {
    const beforeParent = await admit(PNG_BYTES);
    const afterParent = await admit(OTHER_PNG_BYTES);
    await unlink(
      join(
        store.rootDirectory,
        'objects',
        'sha256',
        beforeParent.contentId.slice('sha256:'.length),
      ),
    );
    const rows: IContent[] = [
      { speaker: 'human', blocks: [beforeParent] },
      {
        speaker: 'ai',
        metadata: { id: 'resp_parent', responsesStored: true },
        blocks: [{ type: 'text', text: 'stored response' }],
      },
      { speaker: 'human', blocks: [afterParent] },
    ];
    await sendProjected(
      rows,
      beforeParent.normalizedBase64Length + afterParent.normalizedBase64Length,
      { 'responses-stateful': true },
    );
    expect(harness.bodies).toHaveLength(1);
    expect(harness.bodies[0]).toContain('BAUG');
    expect(harness.bodies[0]).not.toContain('AQID');
    expect(harness.bodies[0]).toContain('"previous_response_id":"resp_parent"');
    expect(resolver.accounting()).toStrictEqual({ ...idle, storeReadCount: 1 });
  }, 60000);

  it('enforces the aggregate media budget across rows and releases what it reserved', async () => {
    const first = await admit(PNG_BYTES);
    const second = await admit(OTHER_PNG_BYTES);
    const before = promptDirs();
    await expect(
      sendProjected(
        [
          { speaker: 'human', blocks: [first] },
          { speaker: 'human', blocks: [second] },
        ],
        first.normalizedBase64Length + second.normalizedBase64Length - 1,
      ),
    ).rejects.toThrow('aggregate budget');
    expect(resolver.accounting()).toStrictEqual({ ...idle, storeReadCount: 1 });
    expect(harness.bodies).toHaveLength(0);
    expect([...promptDirs()].filter((e) => !before.has(e))).toHaveLength(0);
  }, 60000);

  it('does not reserve or read media when a projection is dropped unsent', async () => {
    const image = await admit(PNG_BYTES);
    const projection = await project(
      [{ speaker: 'human', blocks: [image] }],
      image.normalizedBase64Length,
    );
    expect(resolver.accounting().reservedContentCount).toBe(0);
    expect(resolver.accounting()).toStrictEqual({ ...idle, storeReadCount: 0 });
    await projection.releaseIfUnsent?.();
    expect(resolver.accounting()).toStrictEqual({ ...idle, storeReadCount: 0 });
  }, 60000);
});
