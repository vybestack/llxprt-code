import type { RecordingIntegration } from '@vybestack/llxprt-code-core';
import { prepareProfileClient } from '@vybestack/llxprt-code-core/config/agentClientLifecycle.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
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
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  extractExistingState,
  prepareAgentClientReplacement,
} from '@vybestack/llxprt-code-core/config/agentClientLifecycle.js';
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

export async function replaceSessionClient(
  previous: AgentClientContract,
  state: AgentRuntimeState,
  factory: RuntimeContentGeneratorFactory<ContentGenerator>,
  tokenizer: RuntimeTokenizerFactory,
  ledger: OwnedClientLedger,
  acquire: (state: AgentRuntimeState) => AgentClientContract,
  bind: (client: AgentClientContract, state: AgentRuntimeState) => void,
  publish: (client: AgentClientContract, state: AgentRuntimeState) => void,
  borrowed: AgentClientContract | undefined,
): Promise<void> {
  const logger = new DebugLogger('llxprt:session:refreshAuth');
  const { history, historyService } = await extractExistingState(
    logger,
    previous,
  );
  const prepared = buildNewContentGeneratorConfig(factory, state);
  await tokenizer.prepareTokenizer?.(state.provider, state.model);
  const next = acquire(state);
  try {
    bind(next, state);
  } catch (error) {
    await ledger.disposeAfterFailure(next, error);
  }
  try {
    await prepareAgentClientReplacement(
      logger,
      next,
      undefined,
      history,
      historyService,
      prepared.contentGeneratorConfig,
      previous.getContentGeneratorConfig()?.vertexai,
    );
  } catch (error) {
    await ledger.releaseFailedReplacement(next, error);
  }
  publish(next, prepared.runtimeState);
  next.getHistoryService()?.setTokenizerFactory({
    getTokenizer: (provider, model) => tokenizer.getTokenizer(provider, model),
  });
  if (previous !== borrowed) {
    // The new client reuses the previous client's HistoryService. Rebind the
    // previous chat to a throwaway service so disposing it clears that one
    // instead of the shared conversation.
    previous.prepareHistoryRebind(new HistoryService())();
    await ledger.dispose(previous);
  }
}

export async function prepareBoundProfileClient(
  config: Config,
  previous: AgentClientContract,
  selectedState: AgentRuntimeState,
  tokenizer: RuntimeTokenizerFactory,
  factory: RuntimeContentGeneratorFactory<ContentGenerator>,
  acquire: (state: AgentRuntimeState) => AgentClientContract,
  bind: (client: AgentClientContract, state: AgentRuntimeState) => void,
  ledger: OwnedClientLedger,
): ReturnType<typeof prepareProfileClient> {
  await tokenizer.prepareTokenizer?.(
    selectedState.provider,
    selectedState.model,
  );
  let candidate: AgentClientContract | undefined;
  let bound = false;
  return prepareProfileClient(
    config,
    previous,
    (_config, state) => {
      candidate = acquire(state);
      bind(candidate, state);
      bound = true;
      return candidate;
    },
    selectedState,
    factory,
  ).catch(async (primary: unknown) => {
    if (candidate !== undefined) {
      if (!bound) await ledger.disposeAfterFailure(candidate, primary);
      await ledger.releaseFailedReplacement(candidate, primary);
    }
    throw primary;
  });
}

export interface PreparedProfileClient extends PreparedSessionClient {
  prepareHistoryCommit: () => Promise<() => void>;
}

export interface PreparedRecordingSession {
  publish(): void;
  retire(): Promise<void>;
  discard(): Promise<void>;
  attachRecording(recording: RecordingIntegration, origin: object): void;
}
