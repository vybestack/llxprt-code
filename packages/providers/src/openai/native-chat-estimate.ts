/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  RuntimePromptEstimateRequest,
  RuntimePromptEstimateResult,
  RuntimeTokenizerFactory,
} from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import type { NativeProviderFormat } from '@vybestack/llxprt-code-core/services/history/native-provider-format.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { captureRowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { projectOpenAIChatPromptEnvelope } from '../runtime/promptEnvelopeProjections.js';
import { O200K_BASE_ASSET_REVISION } from '../tokenizers/o200kBaseCounter.js';
import {
  plainChatLengthRegistration,
  planRequestChatMessages,
  type ChatUnitTokenMeasurer,
} from './journal-chat-length.js';

type EstimateIdentity = Pick<
  RuntimePromptEstimateRequest,
  | 'activeProvider'
  | 'canonicalModel'
  | 'protocol'
  | 'wireMethod'
  | 'projectionRevision'
>;

function unitEstimator(
  factory: RuntimeTokenizerFactory,
  identity: EstimateIdentity,
): (
  messages: readonly unknown[],
  tools?: unknown,
) => Promise<RuntimePromptEstimateResult> {
  return (messages, tools) => {
    const projection = projectOpenAIChatPromptEnvelope({
      model: identity.canonicalModel,
      messages,
      tools,
    });
    return factory.estimatePrompt({
      ...identity,
      finalizedProjection: projection.finalizedProjection,
      legacyEstimate: projection.legacyEstimate,
    });
  };
}

function unitCounter(
  estimate: ReturnType<typeof unitEstimator>,
): ChatUnitTokenMeasurer {
  return async (messages) => {
    if (messages.length === 0) return 0;
    const single = await estimate(messages);
    const repeated = await estimate([...messages, ...messages]);
    const tokens = repeated.count - single.count;
    if (!Number.isSafeInteger(tokens) || tokens < 0)
      throw new Error(
        'Native Chat unit estimate must be a nonnegative integer',
      );
    return tokens;
  };
}

export class NativeChatEstimateProjection {
  private closed = false;
  private readonly settings: RowFormatSettings;
  constructor(
    private readonly native: NativeProviderFormat,
    settings: RowFormatSettings,
    private readonly selected: 0 | 1 | 2,
    private readonly system: string,
    private readonly tools: unknown,
    readonly signal?: AbortSignal,
  ) {
    this.settings = captureRowFormatSettings(settings);
  }

  async estimate(
    request: RuntimePromptEstimateRequest,
    factory: RuntimeTokenizerFactory,
  ): Promise<RuntimePromptEstimateResult> {
    this.requireOpen();
    const identity: EstimateIdentity = {
      activeProvider: request.activeProvider,
      canonicalModel: request.canonicalModel,
      protocol: request.protocol,
      wireMethod: request.wireMethod,
      projectionRevision: request.projectionRevision,
    };
    const estimate = unitEstimator(factory, identity);
    const empty = await estimate([]);
    if (empty.method === 'exact')
      throw new Error(
        'Native Chat exact whole-prompt token boundaries are not installed',
      );
    if (!empty.family.startsWith('legacy-'))
      throw new Error(
        'Native Chat calibrated family unit measurements are not installed',
      );
    const settings: RowFormatSettings = {
      ...this.settings,
      chat: {
        includeInContext: this.settings.chat?.includeInContext ?? true,
        ...this.settings.chat,
        toolFormat: this.settings.chat?.toolFormat ?? 'openai',
        estimatorKey: JSON.stringify({
          contract: 'chat-unit-repeat-delta-v2',
          legacyEncoding: O200K_BASE_ASSET_REVISION,
          ...identity,
          family: empty.family,
          revision: empty.estimatorVersion,
          assets: empty.assetRevision,
        }),
      },
    };
    const count = unitCounter(estimate);
    const envelope = await estimate(
      [{ role: 'system', content: this.system }],
      this.tools,
    );
    this.requireOpen();
    const plan = await this.native.withFormat(
      plainChatLengthRegistration(settings, count),
      (snapshot) =>
        planRequestChatMessages(
          snapshot,
          this.native.indexed,
          settings,
          this.selected,
          this.system,
          count,
        ),
    );
    this.requireOpen();
    return { ...envelope, count: envelope.count + plan.tokens };
  }

  private requireOpen(): void {
    this.signal?.throwIfAborted();
    if (this.closed)
      throw new Error('Native Chat estimate projection is closed');
  }

  dispose(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}
