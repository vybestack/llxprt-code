/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type {
  RuntimeTokenizerFactory,
  RuntimeContentGeneratorFactory,
  ContentGenerator,
} from '@vybestack/llxprt-code-core';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { buildNewContentGeneratorConfig } from '@vybestack/llxprt-code-core/config/agentClientLifecycle.js';
import type { OwnedClientLedger } from './session-client-cleanup.js';

export interface PreparedSessionClient {
  client: AgentClientContract;
  publish: () => void;
  retire: () => Promise<void>;
  discard: () => Promise<void>;
}

export async function prepareNewSessionClient(
  state: AgentRuntimeState,
  tokenizer: RuntimeTokenizerFactory,
  factory: RuntimeContentGeneratorFactory<ContentGenerator>,
  settings: SessionSettingsOwner,
  previous: AgentClientContract,
  borrowed: AgentClientContract | undefined,
  ledger: OwnedClientLedger,
  acquire: (state: AgentRuntimeState) => AgentClientContract,
  bind: (client: AgentClientContract, state: AgentRuntimeState) => void,
  publish: (client: AgentClientContract, state: AgentRuntimeState) => void,
): Promise<PreparedSessionClient> {
  const prepared = buildNewContentGeneratorConfig(factory, state);
  await tokenizer.prepareTokenizer?.(state.provider, state.model);
  const next = acquire(state);
  let telemetry: Awaited<
    ReturnType<SessionSettingsOwner['prepareNewSessionTelemetry']>
  >;
  try {
    bind(next, state);
    await next.initialize(prepared.contentGeneratorConfig);
    await next.resetChat();
    telemetry = await settings.prepareNewSessionTelemetry(state.sessionId);
  } catch (error) {
    return ledger.disposeAfterFailure(next, error);
  }
  return {
    client: next,
    publish: () => {
      telemetry.publish();
      publish(next, state);
    },
    retire: async () => {
      await telemetry.retire();
      if (previous !== borrowed) await ledger.dispose(previous);
    },
    discard: async () => {
      const results = await Promise.allSettled([
        telemetry.discard(),
        ledger.dispose(next),
      ]);
      const failures = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      );
      if (failures.length > 0)
        throw new AggregateError(
          failures,
          'New session candidate cleanup failed',
        );
    },
  };
}

export async function prepareDetachedSessionClient(input: {
  state: AgentRuntimeState;
  tokenizer: RuntimeTokenizerFactory;
  factory: RuntimeContentGeneratorFactory<ContentGenerator>;
  create: (state: AgentRuntimeState) => AgentClientContract;
  ledger: OwnedClientLedger;
}): Promise<AgentClientContract> {
  await input.tokenizer.prepareTokenizer?.(
    input.state.provider,
    input.state.model,
  );
  const client = input.create(input.state);
  try {
    await client.initialize(
      buildNewContentGeneratorConfig(input.factory, input.state)
        .contentGeneratorConfig,
    );
    client.clearTools();
    return client;
  } catch (error) {
    try {
      await input.ledger.dispose(client);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Detached client setup and cleanup failed',
      );
    }
    throw error;
  }
}
