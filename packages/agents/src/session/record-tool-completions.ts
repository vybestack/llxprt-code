/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { CompletedToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';

export function recordToolCompletions(
  client: AgentClientContract,
  readDefaultModel: () => string,
  completed: readonly CompletedToolCall[],
): void {
  const model = client.getCurrentSequenceModel() ?? readDefaultModel();
  client.getChat().recordCompletedToolCalls(model, [...completed]);
}
