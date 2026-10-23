import type { AuxiliaryWork } from '../core/auxiliary-work.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  AgentChatRecordingExecution,
  AgentClientContract,
  AgentClientMessageParams,
} from '@vybestack/llxprt-code-core/core/clientContract.js';
import { getResponseTextFromBlocks } from '@vybestack/llxprt-code-core';
import type {
  AdmittedModelParameters,
  AdmittedProviderRoute,
} from '@vybestack/llxprt-code-core/runtime/admittedModelParameters.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { AgentInput, GenerateOptions } from '../api/agent.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type {
  RuntimeTokenizerFactory,
  RuntimeContentGeneratorFactory,
  ContentGenerator,
} from '@vybestack/llxprt-code-core';
import type { NetworkFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';
import { buildNewContentGeneratorConfig } from '@vybestack/llxprt-code-core/config/agentClientLifecycle.js';
import type { OwnedClientLedger } from './session-client-cleanup.js';
import { toPartListUnion } from '../api/agentBootstrap.js';
import { normalizeToolInteractionInput } from '../core/MessageConverter.js';
import { prepareTextGenerationRequest } from './text-generation-request.js';
import { rethrowAfterCleanup } from './session-client-cleanup.js';

export class SessionTextGeneration {
  constructor(
    private readonly settings: SessionSettingsOwner,
    private readonly readProvider: () => RuntimeProvider | undefined,
    private readonly captureState: () => AgentRuntimeState,
    private readonly tokenizer: RuntimeTokenizerFactory,
    private readonly factory: RuntimeContentGeneratorFactory<ContentGenerator>,
    private readonly acquire: (
      state: AgentRuntimeState,
    ) => Promise<AgentClientContract>,
    private readonly ledger: OwnedClientLedger,
    private readonly fetch: NetworkFetch,
    private readonly auxiliary: AuxiliaryWork,
  ) {}

  async #executeRequest(
    primary: AgentClientContract,
    state: AgentRuntimeState,
    useTemporary: boolean,
    input: IContent[],
    params: AgentClientMessageParams & {
      modelParameters: AdmittedModelParameters & {
        route: AdmittedProviderRoute;
      };
    },
    promptId: string,
    writeHistory: boolean,
    signal: AbortSignal,
    recording: AgentChatRecordingExecution,
  ): Promise<string> {
    let temporary: AgentClientContract | undefined;
    const cleanup = async (): Promise<void> => {
      if (temporary !== undefined) await this.ledger.dispose(temporary);
    };
    let text: string;
    try {
      signal.throwIfAborted();
      if (input.length === 0) return '';
      if (useTemporary) temporary = await this.#acquireTemporary(state, signal);
      signal.throwIfAborted();
      const response = await (temporary ?? primary).generateDirectMessage(
        { ...params, config: { ...params.config, abortSignal: signal } },
        promptId,
        {
          ...recording,
          ...(recording.hookOwner === undefined
            ? {}
            : { hookOwner: { ...recording.hookOwner, signal } }),
        },
      );
      signal.throwIfAborted();
      if (writeHistory) {
        if (!primary.hasChatInitialized())
          await primary.startChat(await primary.getHistory());
        signal.throwIfAborted();
        await primary
          .getChat()
          .appendGeneration(
            input,
            response,
            params.modelParameters.route.model,
            signal,
            recording.historyOrigin,
          );
      }
      text = getResponseTextFromBlocks(response.content.blocks) ?? '';
    } catch (error) {
      return rethrowAfterCleanup(
        error,
        cleanup,
        'Text generation and cleanup failed',
      );
    }
    await cleanup();
    return text;
  }

  async #acquireTemporary(
    state: AgentRuntimeState,
    signal: AbortSignal,
  ): Promise<AgentClientContract> {
    signal.throwIfAborted();
    await this.tokenizer.prepareTokenizer?.(state.provider, state.model);
    signal.throwIfAborted();
    const client = await this.acquire(state);
    try {
      signal.throwIfAborted();
      await client.initialize(
        buildNewContentGeneratorConfig(this.factory, state)
          .contentGeneratorConfig,
      );
      signal.throwIfAborted();
      client.clearTools();
      return client;
    } catch (error) {
      try {
        await this.ledger.dispose(client);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Detached client setup and cleanup failed',
        );
      }
      throw error;
    }
  }

  generate(
    primary: AgentClientContract,
    input: AgentInput,
    options: GenerateOptions | undefined,
    recording: AgentChatRecordingExecution,
    admitted: AdmittedModelParameters | undefined,
  ): Promise<string> {
    return this.auxiliary.run(
      (signal) =>
        this.execute(primary, input, options, recording, signal, admitted),
      options?.signal,
    );
  }

  private async execute(
    primary: AgentClientContract,
    input: AgentInput,
    options: GenerateOptions | undefined,
    recording: AgentChatRecordingExecution,
    signal: AbortSignal,
    admitted: AdmittedModelParameters | undefined,
  ): Promise<string> {
    const provider = this.readProvider();
    if (provider === undefined)
      throw new Error('No active provider configured');
    const state = this.captureState();
    const invocation = this.settings.prepareProviderInvocation(
      state.runtimeId,
      provider.name,
      admitted,
      signal,
      state.sessionId,
      this.fetch,
    );
    const supplied = normalizeToolInteractionInput(
      structuredClone(toPartListUnion(input)),
    );
    const request = prepareTextGenerationRequest(
      provider,
      options?.model,
      invocation,
      structuredClone(options?.config),
      admitted,
      state.model,
    );
    const promptId = options?.promptId ?? `generate-${Date.now()}`;
    const writeHistory = options?.writeHistory === true;
    const history =
      options?.readHistory === true
        ? primary.getHistory().then((contents) => structuredClone(contents))
        : undefined;
    const release = this.ledger.retain(primary);
    try {
      return await this.#executeRequest(
        primary,
        state,
        provider.name.toLowerCase() === 'gemini',
        supplied,
        { ...request, message: supplied, historyPrefix: await history },
        promptId,
        writeHistory,
        signal,
        recording,
      );
    } finally {
      release();
    }
  }
}
