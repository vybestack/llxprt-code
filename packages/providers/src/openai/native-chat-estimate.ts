/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  RuntimePromptEstimateRequest,
  RuntimePromptEstimateResult,
  RuntimeTokenizerFactory,
} from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import type { NativeProviderFormat } from '@vybestack/llxprt-code-core/services/history/native-provider-format.js';
import type {
  RowFormatRegistration,
  RowFormatSettings,
} from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { captureRowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import {
  canonicalizePromptValue,
  projectOpenAIChatPromptEnvelope,
  type ProjectionImageEntry,
} from '../runtime/promptEnvelopeProjections.js';
import { estimateImageTokens } from '@vybestack/llxprt-code-tools/utils/imageTokenEstimation.js';
import { countO200kBaseTokensFromChunks } from '../tokenizers/o200k-chunked-source.js';
import { getO200kBaseEncoder } from '../tokenizers/o200kBaseCounter.js';
import { countAtSafeBoundaries } from '../tokenizers/official/official-segment-chunking.js';
import { O200K_BASE_ASSET_REVISION } from '../tokenizers/o200kBaseCounter.js';
import {
  plainChatLengthRegistration,
  planRequestChatMessages,
  type ChatUnitTokenMeasurer,
  type StoredChatMessagePlan,
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

export type StreamedChatPlan = (
  settings: RowFormatSettings,
  count: ChatUnitTokenMeasurer,
) => Promise<StoredChatMessagePlan>;

/** The unit counter, the whole-prompt estimator and the settings that key them. */
export async function chatTokenMeasure(
  settings: RowFormatSettings,
  identity: EstimateIdentity,
  factory: RuntimeTokenizerFactory,
): Promise<{
  readonly settings: RowFormatSettings;
  readonly count: ChatUnitTokenMeasurer;
  readonly estimate: ReturnType<typeof unitEstimator>;
}> {
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
  const captured: RowFormatSettings = {
    ...settings,
    chat: {
      includeInContext: settings.chat?.includeInContext ?? true,
      ...settings.chat,
      toolFormat: settings.chat?.toolFormat ?? 'openai',
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
  return { settings: captured, count: unitCounter(estimate), estimate };
}

export async function chatTokenRegistration(
  settings: RowFormatSettings,
  identity: EstimateIdentity,
  factory: RuntimeTokenizerFactory,
): Promise<{
  readonly registration: RowFormatRegistration;
  readonly count: ChatUnitTokenMeasurer;
  readonly estimate: ReturnType<typeof unitEstimator>;
}> {
  const measure = await chatTokenMeasure(settings, identity, factory);
  return {
    registration: plainChatLengthRegistration(measure.settings, measure.count),
    count: measure.count,
    estimate: measure.estimate,
  };
}

export type StreamedChatPrompt = (
  observeImages: (images: readonly ProjectionImageEntry[]) => void,
) => AsyncIterable<string>;

export class NativeChatEstimateProjection {
  private closed = false;
  private readonly settings: RowFormatSettings;
  constructor(
    private readonly native: NativeProviderFormat | undefined,
    settings: RowFormatSettings,
    private readonly selected: 0 | 1 | 2,
    private readonly system: string,
    private readonly tools: unknown,
    readonly signal?: AbortSignal,
    private readonly streamedPlan?: StreamedChatPlan,
    private readonly streamedPrompt?: StreamedChatPrompt,
  ) {
    this.settings = captureRowFormatSettings(settings);
  }

  async estimate(
    request: RuntimePromptEstimateRequest,
    factory: RuntimeTokenizerFactory,
  ): Promise<RuntimePromptEstimateResult> {
    this.requireOpen();
    if (this.streamedPrompt !== undefined)
      return this.estimateStream(request, factory, this.streamedPrompt);
    const identity: EstimateIdentity = {
      activeProvider: request.activeProvider,
      canonicalModel: request.canonicalModel,
      protocol: request.protocol,
      wireMethod: request.wireMethod,
      projectionRevision: request.projectionRevision,
    };
    const measure = await chatTokenMeasure(this.settings, identity, factory);
    const envelope = await measure.estimate(
      [{ role: 'system', content: this.system }],
      this.tools,
    );
    this.requireOpen();
    const plan = await this.plan(measure.settings, measure.count);
    this.requireOpen();
    return { ...envelope, count: envelope.count + plan.tokens };
  }

  private async estimateStream(
    request: RuntimePromptEstimateRequest,
    factory: RuntimeTokenizerFactory,
    messages: StreamedChatPrompt,
  ): Promise<RuntimePromptEstimateResult> {
    const empty = projectOpenAIChatPromptEnvelope({
      model: request.canonicalModel,
      messages: [],
    });
    const metadata = await factory.estimatePrompt({
      ...request,
      finalizedProjection: empty.finalizedProjection,
      legacyEstimate: empty.legacyEstimate,
    });
    let imageTokens = 0;
    const observeImages = (images: readonly ProjectionImageEntry[]): void => {
      for (const image of images)
        imageTokens += estimateImageTokens({
          provider: 'openai',
          model: request.canonicalModel,
          dimensions: image.dimensions,
        });
    };
    const toolImages: ProjectionImageEntry[] = [];
    const tools =
      this.tools === undefined
        ? undefined
        : JSON.stringify(
            canonicalizePromptValue(this.tools, 'tools', toolImages),
          );
    observeImages(toolImages);
    let count = 0;
    if (metadata.method === 'exact') {
      const tokenizer = factory.getTokenizer(
        request.activeProvider,
        request.canonicalModel,
      );
      if (tokenizer === undefined)
        throw new Error('Missing exact Chat tokenizer');
      count = await countAtSafeBoundaries(
        this.checkedPieces(messages(observeImages)),
        (text) => tokenizer.countTokens(text),
      );
      if (tools !== undefined) count += await tokenizer.countTokens(tools);
      count += imageTokens;
    } else {
      if (!metadata.family.startsWith('legacy-'))
        throw new Error(
          `Native Chat streamed estimator does not support ${metadata.family}`,
        );
      const scan = { length: 0, special: false, carry: '' };
      count = await countO200kBaseTokensFromChunks(
        this.legacyPieces(messages(observeImages), tools, scan),
        await getO200kBaseEncoder(),
      );
      if (scan.special) count = Math.ceil(scan.length / 3);
    }
    this.requireOpen();
    return { ...metadata, count };
  }

  private async *checkedPieces(
    pieces: AsyncIterable<string>,
  ): AsyncGenerator<string> {
    for await (const piece of pieces) {
      this.requireOpen();
      yield piece;
    }
  }

  private async *legacyPieces(
    messages: AsyncIterable<string>,
    tools: string | undefined,
    scan: { length: number; special: boolean; carry: string },
  ): AsyncGenerator<string> {
    const observe = (piece: string): string => {
      scan.length += piece.length;
      const window = scan.carry + piece;
      scan.special ||=
        window.includes('<|endoftext|>') || window.includes('<|endofprompt|>');
      scan.carry = window.slice(-16);
      return piece;
    };
    yield observe('{"messages":');
    for await (const piece of this.checkedPieces(messages))
      yield observe(piece);
    if (tools !== undefined) yield observe(`,"tools":${tools}`);
    yield observe('}');
  }

  private plan(
    settings: RowFormatSettings,
    count: ChatUnitTokenMeasurer,
  ): Promise<StoredChatMessagePlan> {
    if (this.streamedPlan !== undefined)
      return this.streamedPlan(settings, count);
    const native = this.native;
    if (native === undefined)
      throw new Error('Chat estimate requires a native planner');
    const registration = plainChatLengthRegistration(settings, count);
    return native.withFormat(registration, (snapshot) =>
      planRequestChatMessages(
        snapshot,
        native.indexed,
        registration.settings,
        this.selected,
        this.system,
        count,
      ),
    );
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
