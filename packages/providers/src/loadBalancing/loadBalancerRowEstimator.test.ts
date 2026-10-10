/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { estimateTokens } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import { createRuntimeTokenizerFactory } from '../composition/runtimeTokenizerFactory.js';
import type { GenerateChatOptions, IProvider } from '../IProvider.js';
import { estimatePreparedPrompt } from './preparedPromptOptions.js';
import {
  estimateRequestTokens,
  estimateRowSourceTokens,
  type EstimationRowSource,
} from './loadBalancerTokenEstimator.js';

const texts = ['alpha 雪', 'beta\n\n  gamma', ''.padEnd(5000, 'delta ')];
const rows: readonly IContent[] = texts.map((text, index) => ({
  speaker: index % 2 === 0 ? 'human' : 'ai',
  blocks: [{ type: 'text', text }],
}));

function referenceRow(): IContent {
  const contentId =
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const object = {
    contentId,
    mimeType: 'application/pdf',
    byteLength: 3000,
    normalizedBase64Length: 4000,
  };
  return {
    speaker: 'human',
    blocks: [
      {
        type: 'media',
        mimeType: 'application/pdf',
        encoding: 'reference',
        contentId,
        originalContentId: contentId,
        selectedContentId: contentId,
        originalObject: object,
        selectedObject: object,
        transformation: {
          policyId: 'identity',
          policyVersion: 1,
          parameters: {},
        },
        byteLength: 3000,
        normalizedBase64Length: 4000,
        semanticMetadata: {},
      },
    ],
  };
}

function repeatableRows(source: readonly IContent[]): {
  rows: ProviderRequestRows;
  opened: () => number;
} {
  let opened = 0;
  return {
    rows: {
      count: source.length,
      openReader: async function* open() {
        opened++;
        yield* source;
      },
    },
    opened: () => opened,
  };
}

function rowSource(rows: ProviderRequestRows): EstimationRowSource {
  return { count: rows.count, open: () => rows.openReader() };
}

describe('row-source load balancer estimation', () => {
  it('folds rows to the exact generic estimate without a tokenizer', async () => {
    const { rows: reader } = repeatableRows(rows);
    const actual = await estimateRowSourceTokens(
      rowSource(reader),
      'openai',
      'unknown-model',
      {},
    );
    expect(actual.tokens).toBe(
      texts.reduce((sum, text) => sum + estimateTokens(text), 0),
    );
    expect(actual).toStrictEqual(
      await estimateRequestTokens([...rows], 'openai', 'unknown-model', {}),
    );
  });

  it('matches the array estimate with a real tokenizer factory', async () => {
    const tokenizerFactory = createRuntimeTokenizerFactory();
    const { rows: reader } = repeatableRows(rows);
    const actual = await estimateRowSourceTokens(
      rowSource(reader),
      'openai',
      'gpt-5.6-sol',
      { tokenizerFactory },
    );
    expect(actual).toStrictEqual(
      await estimateRequestTokens([...rows], 'openai', 'gpt-5.6-sol', {
        tokenizerFactory,
      }),
    );
    expect(actual.source).toContain('(tokenizer)');
  });

  it('adds reference-media metadata cost while streaming', async () => {
    const withReference = [...rows, referenceRow()];
    const { rows: reader } = repeatableRows(withReference);
    const actual = await estimateRowSourceTokens(
      rowSource(reader),
      'openai',
      'unknown-model',
      {},
    );
    // 4000 base64 chars / 4 = 1000 characters / 3 characters per token.
    expect(actual.tokens).toBe(
      texts.reduce((sum, text) => sum + estimateTokens(text), 0) + 334,
    );
  });

  it('keeps the non-empty floor and the empty-selection result', async () => {
    const blank: readonly IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: '' }] },
    ];
    expect(
      (
        await estimateRowSourceTokens(
          rowSource(repeatableRows(blank).rows),
          'openai',
          'unknown-model',
          {},
        )
      ).tokens,
    ).toBe(1);
    expect(
      await estimateRowSourceTokens(
        rowSource(repeatableRows([]).rows),
        'openai',
        'unknown-model',
        {},
      ),
    ).toStrictEqual({ tokens: 0, source: 'empty contents' });
  });

  it('surfaces reader failures instead of degrading to a fallback estimate', async () => {
    const failing: ProviderRequestRows = {
      count: 2,
      openReader: async function* open() {
        yield rows[0];
        throw new Error('reader exploded');
      },
    };
    await expect(
      estimateRowSourceTokens(
        rowSource(failing),
        'openai',
        'unknown-model',
        {},
      ),
    ).rejects.toThrow('reader exploded');
  });

  it('estimates a requestRows selection without touching the contents stream', async () => {
    const { rows: reader, opened } = repeatableRows(rows);
    const options = {
      contents: {
        [Symbol.asyncIterator]: () => {
          throw new Error('contents must not be collected');
        },
      },
      requestRows: { ...reader, close: () => undefined },
    } as unknown as GenerateChatOptions;
    const result = await estimatePreparedPrompt(
      {
        providerName: 'openai',
        modelParams: {},
        model: 'unknown-model',
      } as never,
      options,
      {} as IProvider,
      undefined,
    );
    expect(result.tokens).toBe(
      texts.reduce((sum, text) => sum + estimateTokens(text), 0),
    );
    expect(opened()).toBe(1);
  });
});
