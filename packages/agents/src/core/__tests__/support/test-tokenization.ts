/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';

export function bindClientTokenization(
  client: AgentClientContract,
  tokenizer: RuntimeTokenizerFactory,
): void {
  client.bindTokenization(
    (provider, model) => tokenizer.getTokenizer(provider, model),
    tokenizer,
  );
}
