/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Batch history mutations must count tokens with the active tokenization
 * target, the same way single-entry add() does. Falling back to the hard-coded
 * default model instead selects an unrelated provider tokenizer, which loads a
 * second tiktoken WASM encoder (about 30 MiB) the first time /clear republishes
 * retained history.
 */

import { describe, it, expect } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import { createUserMessage } from './IContent.js';

function createRecordingTokenizerSelection(): {
  readonly getTokenizer: (provider: string, model: string) => undefined;
  readonly requested: string[];
} {
  const requested: string[] = [];
  return {
    requested,
    getTokenizer: (provider, model) => {
      requested.push(`${provider}/${model}`);
      return undefined;
    },
  };
}

function createServiceTargeting(
  provider: string,
  model: string,
): {
  readonly history: HistoryService;
  readonly requested: string[];
} {
  const selection = createRecordingTokenizerSelection();
  const history = new HistoryService();
  history.setTokenizerFactory(selection);
  history.setActiveTokenizationTarget(model, provider);
  return { history, requested: selection.requested };
}

describe('HistoryService batch tokenizer selection', () => {
  it('replaceBatch counts retained history with the active target tokenizer', async () => {
    const { history, requested } = createServiceTargeting('fake', 'fake-model');

    await history.replaceBatch([createUserMessage('retained shell turn')]);

    expect(requested).toStrictEqual(['fake/fake-model']);
  });

  it('addBatch counts new entries with the active target tokenizer', async () => {
    const { history, requested } = createServiceTargeting('fake', 'fake-model');

    await history.addBatch([createUserMessage('first entry')]);

    expect(requested).toStrictEqual(['fake/fake-model']);
  });

  it('an explicit model argument still selects that model tokenizer', async () => {
    const { history, requested } = createServiceTargeting('fake', 'fake-model');

    await history.replaceBatch([createUserMessage('pinned')], 'other-model');

    expect(requested).toStrictEqual(['fake/other-model']);
  });
});
