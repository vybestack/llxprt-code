/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import { createHistoryProviderFileBindingStore } from './provider-file-binding.js';
import type {
  MediaReferenceBlock,
  ProviderFileReferenceMetadata,
} from './IContent.js';

const CONTENT_ID =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function mediaReference(): MediaReferenceBlock {
  const object = {
    contentId: CONTENT_ID,
    mimeType: 'application/pdf',
    byteLength: 3,
    normalizedBase64Length: 4,
  };
  return {
    type: 'media',
    encoding: 'reference',
    mimeType: 'application/pdf',
    contentId: CONTENT_ID,
    originalContentId: CONTENT_ID,
    selectedContentId: CONTENT_ID,
    originalObject: object,
    selectedObject: object,
    transformation: {
      policyId: 'identity',
      policyVersion: 1,
      parameters: {},
    },
    byteLength: 3,
    normalizedBase64Length: 4,
    semanticMetadata: {},
  };
}

const PROVIDER_FILE: ProviderFileReferenceMetadata = {
  provider: 'kimi',
  baseURL: 'https://api.moonshot.ai/v1',
  credentialHash: 'credential-a',
  fileId: 'file-stable',
  byteLength: 3,
  scope: 'session',
  scopeId: 'session-a',
  createdAt: 1_000,
  expiresAt: 61_000,
  deletion: 'delete',
  zeroDataRetention: 'incompatible-while-retained',
  deletionState: 'active',
};

describe('HistoryService provider file binding', () => {
  it('persists stable provider file metadata on every matching media reference', async () => {
    const history = new HistoryService();
    history.add({
      speaker: 'human',
      blocks: [mediaReference(), { type: 'text', text: 'read it' }],
    });
    history.add({ speaker: 'ai', blocks: [mediaReference()] });

    await createHistoryProviderFileBindingStore(history).bind(
      CONTENT_ID,
      PROVIDER_FILE,
    );

    const references = history
      .getRawHistory()
      .flatMap((content) => content.blocks)
      .filter(
        (block) => block.type === 'media' && block.encoding === 'reference',
      );
    expect(
      references.map((reference) => reference.providerFiles),
    ).toStrictEqual([[PROVIDER_FILE], [PROVIDER_FILE]]);
  });

  it('replaces the same provider identity instead of accumulating stale ids', async () => {
    const history = new HistoryService();
    history.add({ speaker: 'human', blocks: [mediaReference()] });

    await createHistoryProviderFileBindingStore(history).bind(
      CONTENT_ID,
      PROVIDER_FILE,
    );
    await createHistoryProviderFileBindingStore(history).bind(CONTENT_ID, {
      ...PROVIDER_FILE,
      fileId: 'file-replacement',
      createdAt: 2_000,
      expiresAt: 62_000,
    });

    const block = history.getRawHistory()[0].blocks[0];
    const providerFiles =
      block.type === 'media' && block.encoding === 'reference'
        ? block.providerFiles
        : undefined;
    expect(providerFiles?.map((reference) => reference.fileId)).toStrictEqual([
      'file-replacement',
    ]);
  });

  it('removes only the matching provider file binding after retention ends', async () => {
    const history = new HistoryService();
    history.add({ speaker: 'human', blocks: [mediaReference()] });
    const bindings = createHistoryProviderFileBindingStore(history);
    await bindings.bind(CONTENT_ID, PROVIDER_FILE);
    await bindings.bind(CONTENT_ID, {
      ...PROVIDER_FILE,
      provider: 'other-provider',
      fileId: 'other-file',
    });

    await bindings.unbind(CONTENT_ID, PROVIDER_FILE);

    const block = history.getRawHistory()[0].blocks[0];
    const providerFiles =
      block.type === 'media' && block.encoding === 'reference'
        ? block.providerFiles
        : undefined;
    expect(providerFiles?.map((reference) => reference.fileId)).toStrictEqual([
      'other-file',
    ]);
  });

  it('preserves a queued append when binding waits behind another history mutation', async () => {
    const history = new HistoryService();
    const mediaContent = {
      speaker: 'human' as const,
      blocks: [mediaReference()],
    };
    history.add(mediaContent);
    const replacement = history.replaceAll([mediaContent]);
    history.add({
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'queued response' }],
    });

    const binding = createHistoryProviderFileBindingStore(history).bind(
      CONTENT_ID,
      PROVIDER_FILE,
    );
    await Promise.all([replacement, binding]);

    const rawHistory = history.getRawHistory();
    const boundContent = rawHistory.find((_entry, index) => index === 0);
    const boundReference = boundContent?.blocks.find(
      (_entry, index) => index === 0,
    );
    const providerFiles =
      boundReference?.type === 'media' &&
      boundReference.encoding === 'reference'
        ? boundReference.providerFiles
        : undefined;
    expect({
      texts: rawHistory.flatMap((content) =>
        content.blocks.flatMap((block) =>
          block.type === 'text' ? [block.text] : [],
        ),
      ),
      providerFileIds: providerFiles?.map((reference) => reference.fileId),
    }).toStrictEqual({
      texts: ['queued response'],
      providerFileIds: ['file-stable'],
    });
  });

  it('isolates retained provider metadata from later caller mutation', async () => {
    const history = new HistoryService();
    history.add({ speaker: 'human', blocks: [mediaReference()] });
    const callerOwned = { ...PROVIDER_FILE };

    await createHistoryProviderFileBindingStore(history).bind(
      CONTENT_ID,
      callerOwned,
    );
    callerOwned.fileId = 'caller-mutated';
    callerOwned.expiresAt = 99_000;

    const retainedContent = history
      .getRawHistory()
      .find((_entry, index) => index === 0);
    const block = retainedContent?.blocks.find((_entry, index) => index === 0);
    const retained =
      block?.type === 'media' && block.encoding === 'reference'
        ? block.providerFiles?.[0]
        : undefined;
    expect({
      fileId: retained?.fileId,
      expiresAt: retained?.expiresAt,
      metadataFrozen: Object.isFrozen(retained),
      collectionFrozen:
        block?.type === 'media' && block.encoding === 'reference'
          ? Object.isFrozen(block.providerFiles)
          : false,
    }).toStrictEqual({
      fileId: 'file-stable',
      expiresAt: 61_000,
      metadataFrozen: true,
      collectionFrozen: true,
    });
  });
});
