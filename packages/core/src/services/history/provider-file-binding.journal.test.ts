/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { HISTORY_BACKEND_ENV } from './historyBackendSelect.js';
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

/**
 * The journal twin of "isolates retained provider metadata from later caller
 * mutation" in provider-file-binding.test.ts. The old store keeps the bound
 * metadata as frozen objects. The journal store keeps bytes and decodes a new
 * object on every read, so isolation is by copy: neither the caller's object
 * nor a row from an earlier read is shared with a later read.
 */
describe('HistoryService provider file binding on the journal store', () => {
  const saved = process.env[HISTORY_BACKEND_ENV];
  let history: HistoryService;
  beforeEach(() => {
    process.env[HISTORY_BACKEND_ENV] = 'journal';
    history = new HistoryService();
  });
  afterEach(async () => {
    if (saved === undefined) delete process.env[HISTORY_BACKEND_ENV];
    else process.env[HISTORY_BACKEND_ENV] = saved;
    await history.dispose();
  });

  async function boundFiles(): Promise<
    readonly ProviderFileReferenceMetadata[] | undefined
  > {
    const [content] = await collectRawHistory(history);
    const block = content.blocks[0];
    return block.type === 'media' && block.encoding === 'reference'
      ? block.providerFiles
      : undefined;
  }

  it('keeps the metadata as it was bound, whatever the caller does afterwards', async () => {
    history.add({ speaker: 'human', blocks: [mediaReference()] });
    const callerOwned = { ...PROVIDER_FILE };

    await createHistoryProviderFileBindingStore(history).bind(
      CONTENT_ID,
      callerOwned,
    );
    callerOwned.fileId = 'caller-mutated';
    callerOwned.expiresAt = 99_000;

    expect(await boundFiles()).toStrictEqual([PROVIDER_FILE]);
  });

  it('gives each read its own copy of the bound metadata', async () => {
    history.add({ speaker: 'human', blocks: [mediaReference()] });
    await createHistoryProviderFileBindingStore(history).bind(
      CONTENT_ID,
      PROVIDER_FILE,
    );

    const first = await boundFiles();
    if (first === undefined) throw new Error('No bound metadata');
    Object.assign(first[0], { fileId: 'reader-mutated' });

    expect(await boundFiles()).toStrictEqual([PROVIDER_FILE]);
  });
});
