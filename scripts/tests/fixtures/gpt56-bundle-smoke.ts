/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createRuntimeTokenizerFactory } from '../../../packages/providers/src/composition/runtimeTokenizerFactory.js';

const factory = createRuntimeTokenizerFactory();
await factory.prepareTokenizer?.('codex-alias', 'gpt-5.6-sol');
const tokenizer = factory.getTokenizer('codex-alias', 'gpt-5.6-sol');
if (tokenizer === undefined) {
  throw new Error('production factory did not provide the GPT-5.6 tokenizer');
}
process.stdout.write(
  `${await tokenizer.countTokens('The quick brown fox jumps over the lazy dog.')}\n`,
);
