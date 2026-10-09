import { observeHistorySynchronouslyForTest } from '@vybestack/llxprt-code-test-utils/core/synchronous-history-test-observation.js';
import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import type {
  IContent,
  MediaReferenceBlock,
  ProviderFileReferenceMetadata,
} from './IContent.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { createHistoryProviderFileBindingStore } from './provider-file-binding.js';
import { withCoreSuffixFixture } from './core-suffix-fixture-test-helpers.js';
import { ownerFixtureRow } from './chronology-rollback-owner-test-helpers.js';
import {
  exactTokenizer,
  rejectedValue,
} from './chronology-rollback-test-helpers.js';

class CursorOnlyHistory extends HistoryService {
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(this, 'Whole-history array escape');
  }
}

describe('journal materialization guard', () => {
  it('CursorOnlyHistory rejects journal eager materialization', () => {
    const history = new CursorOnlyHistory();

    try {
      expect(() => observeHistorySynchronouslyForTest(history)).toThrow(
        'Whole-history array escape',
      );
    } finally {
      history.dispose();
    }
  });
});

const contentId =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const object = {
  contentId,
  mimeType: 'application/pdf',
  byteLength: 3,
  normalizedBase64Length: 4,
};
const media: MediaReferenceBlock = {
  type: 'media',
  encoding: 'reference',
  mimeType: 'application/pdf',
  contentId,
  originalContentId: contentId,
  selectedContentId: contentId,
  originalObject: object,
  selectedObject: object,
  transformation: { policyId: 'identity', policyVersion: 1, parameters: {} },
  byteLength: 3,
  normalizedBase64Length: 4,
  semanticMetadata: {},
  caption: 'reference media',
};
const providerFile: ProviderFileReferenceMetadata = {
  provider: 'kimi',
  baseURL: 'https://api.moonshot.ai/v1',
  credentialHash: 'test',
  fileId: 'stable-file',
  byteLength: 3,
  scope: 'session',
  scopeId: 'session',
  createdAt: 1,
  expiresAt: 1000,
  deletion: 'delete',
  zeroDataRetention: 'incompatible-while-retained',
  deletionState: 'active',
};

function bindingRow(index: number, bytes: number): IContent {
  const row = ownerFixtureRow(index, bytes);
  return index === 0
    ? {
        ...row,
        blocks: row.blocks.map((block) =>
          block.type === 'media' ? media : block,
        ),
      }
    : row;
}

async function verifyRows(
  history: HistoryService,
  size: number,
  bound: boolean,
): Promise<void> {
  let index = 0;
  for await (const row of history.streamRawHistory()) {
    const expected = bindingRow(index, 2048);
    if (bound && index === 0) {
      const blocks = expected.blocks.map((block) =>
        block.type === 'media'
          ? { ...block, providerFiles: [providerFile] }
          : block,
      );
      expect(row).toStrictEqual({ ...expected, blocks });
    } else expect(row).toStrictEqual(expected);
    index++;
  }
  expect(index).toBe(size);
}

function expectBindingTokens(history: HistoryService, size: number): void {
  expect(history.getTotalTokens()).toBe(4 * size);
}

describe('provider file binding through a disk row transform', () => {
  for (const size of [512, 8192]) {
    it(`binds and unbinds ${size} media/tool journal rows without any whole-history accessor`, async () => {
      const owners = new RowOwnership();
      await withCoreSuffixFixture(
        size,
        async (history) => {
          history.setTokenizerFactory(exactTokenizer());
          const binding = createHistoryProviderFileBindingStore(history);
          await binding.bind(contentId, providerFile);
          expectBindingTokens(history, size);
          await verifyRows(history, size, true);
          await binding.unbind(contentId, providerFile);
          expectBindingTokens(history, size);
          await verifyRows(history, size, false);
          expect(owners.snapshot().peakRows).toBeLessThanOrEqual(440);
          expect(owners.snapshot().peakSerializedBytes).toBeLessThanOrEqual(
            8 * 1024 * 1024,
          );
          expect(owners.snapshot().liveRows).toBe(0);
        },
        2048,
        bindingRow,
        owners,
        (options) => new CursorOnlyHistory(options),
      );
    }, 120_000);
  }

  it('rejects late publication and restores every original binding field and token count', async () => {
    const owners = new RowOwnership();
    await withCoreSuffixFixture(
      512,
      async (history) => {
        history.setTokenizerFactory(exactTokenizer());
        const failure = new Error('binding token publication');
        history.once('tokensUpdated', () => {
          throw failure;
        });
        expect(
          await rejectedValue(
            createHistoryProviderFileBindingStore(history).bind(
              contentId,
              providerFile,
            ),
          ),
        ).toBe(failure);
        await verifyRows(history, 512, false);
        expect(history.getTotalTokens()).toBe(0);
        expect(owners.snapshot().liveRows).toBe(0);
      },
      2048,
      bindingRow,
      owners,
      (options) => new CursorOnlyHistory(options),
    );
  });
});
