/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { requestFormatSlot } from '@vybestack/llxprt-code-core/services/history/native-provider-format.js';
import { createUnitTokenCounter } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import type OpenAI from 'openai';
import {
  mistralRowIds,
  type NativeMistralResolver,
} from './native-mistral-row.js';
import type { NativeRowIds } from './native-row-ids.js';
import type { StreamingToolIdMapper } from '@vybestack/llxprt-code-tools/ToolIdStrategy.js';
import { JournalRequestMistral } from '@vybestack/llxprt-code-core/services/history/journal-request-mistral.js';
import { measurableChatRow } from './chat-measure-media.js';
import { JournalFormatError } from '@vybestack/llxprt-code-core/journal/errors.js';
import {
  rowFormatKey,
  captureRowFormatSettings,
  type RowFormatRegistration,
  type RowFormatSettings,
  type RowLengthFacts,
} from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import type { RowEntry } from '@vybestack/llxprt-code-core/journal/rowEntry.js';
import type { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import { decodeSlotSummary } from '@vybestack/llxprt-code-core/journal/slotSummary.js';
import {
  composeSlotSummaries,
  identitySlotSummary,
  composeAffineTables,
  CHAT_MEDIA_PENDING_MASK,
} from '@vybestack/llxprt-code-core/journal/summaryComposition.js';
import { journalEntryPlans } from '@vybestack/llxprt-code-core/services/history/journal-entry-plans.js';
import { JournalTailSource } from '@vybestack/llxprt-code-core/services/history/journal-tail-source.js';
import { ROW_FLAG } from '@vybestack/llxprt-code-core/journal/rowRecord.js';
import type { JournalResponsePlan } from '@vybestack/llxprt-code-core/services/history/journal-response-plan.js';
import type { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import type {
  SlotSummary,
  ChatVariant,
} from '@vybestack/llxprt-code-core/journal/slotSummary.js';
import type {
  IContent,
  MediaBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { normalizeToOpenAIToolId } from '@vybestack/llxprt-code-tools';
import { removeThinkingFromContent } from '../reasoning/reasoningUtils.js';
import { classifyMediaBlock } from '../utils/mediaUtils.js';
import {
  buildToolResponseContent,
  convertBlockToPart,
  normalizeToolCallArguments,
  processAssistantMessage,
  processToolResponses,
  processUserMessage,
} from './OpenAIRequestBuilder.js';
import {
  chatMediaFrameBytes,
  chatUnitSummary,
  type ChatUnitLengthFacts,
} from './chat-length-facts.js';

export const PLAIN_CHAT_FORMAT_REV = 2;
export type ChatUnitTokenMeasurer = (
  messages: readonly unknown[],
  countTokens?: (text: string) => number,
) => Promise<number>;
const jsonBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value), 'utf8');

function estimateMediaMessage(
  pending: readonly MediaBlock[],
): readonly unknown[] {
  return pending.length === 0
    ? []
    : [
        {
          role: 'user' as const,
          content: [
            {
              type: 'text' as const,
              text: pending.some(
                (block) => classifyMediaBlock(block) === 'video',
              )
                ? '[Media from tool response]'
                : '[Images from tool response]',
            },
            ...pending.flatMap((block) => {
              const part = convertBlockToPart(block);
              return part === null ? [] : [part];
            }),
          ],
        },
      ];
}

function factsOf(
  row: IContent,
  stripped: boolean,
  settings: RowFormatSettings,
  previous: readonly string[],
  mapper?: StreamingToolIdMapper,
  allowOrphans = false,
): {
  facts: ChatUnitLengthFacts;
  lastIds: readonly string[];
  messages: readonly unknown[];
} {
  const measured = measurableChatRow(
    stripped ? removeThinkingFromContent(row) : row,
  );
  const unit = measured.row;
  const pending: MediaBlock[] = [];
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (unit.speaker === 'human') {
    const message = processUserMessage(unit);
    if (message !== null) messages.push(message);
  } else if (unit.speaker === 'ai') {
    const message = processAssistantMessage(
      unit,
      settings.chat?.includeInContext ?? true,
      settings.chat?.toolFormat,
      mapper?.resolveToolCallId ?? ((call) => normalizeToOpenAIToolId(call.id)),
      normalizeToolCallArguments,
    );
    if (message !== null) messages.push(message);
  } else
    messages.push(
      ...processToolResponses(
        unit,
        settings.chat?.toolFormat ?? 'openai',
        mapper?.resolveToolResponseId ??
          ((response) => normalizeToOpenAIToolId(response.callId)),
        buildToolResponseContent,
        settings.outputLimits ?? undefined,
        pending,
      ),
    );
  let lastIds = previous;
  const facts = messages.map((message) => {
    const dropped =
      message.role === 'tool' &&
      !allowOrphans &&
      !lastIds.includes(message.tool_call_id);
    if (!dropped) {
      if (message.role === 'assistant' && message.tool_calls !== undefined)
        lastIds = message.tool_calls.map((call) => call.id);
      else if (message.role !== 'assistant' && message.role !== 'tool')
        lastIds = [];
    }
    return { bytes: jsonBytes(message) + measured.userBytes, dropped };
  });
  return {
    messages: [
      ...messages.filter((_message, index) => !facts[index].dropped),
      ...estimateMediaMessage(pending),
    ],
    facts: {
      speaker: row.speaker,
      messages: facts,
      media: pending.map((block) => {
        const part = convertBlockToPart(block);
        return {
          bytes:
            part === null ? null : jsonBytes(part) + measured.mediaBytes(block),
          video: classifyMediaBlock(block) === 'video',
        };
      }),
    },
    lastIds,
  };
}

function supported(settings: RowFormatSettings): void {
  const unsupported = [
    settings.formatId !== 'openai-chat:plain' &&
      settings.formatId !== 'openai-chat:mistral',
    (settings.formatId === 'openai-chat:mistral') !==
      (settings.chat?.toolFormat === 'mistral'),
    settings.formatRev !== PLAIN_CHAT_FORMAT_REV,
    settings.isOAuth,
    settings.toolNameTransform !== 'none',
    !settings.supportsUrlImages,
    settings.reasoningEnabled,
    settings.reasoningFieldName !== 'reasoning_content',
    settings.mediaPdfEnabled,
    settings.unsupportedMedia !== 'notice',
  ];
  if (unsupported.includes(true))
    throw new JournalFormatError(
      'Plain chat length measurer does not support these converter settings',
    );
}

async function measure(
  snapshot: VersionSnapshot,
  entry: RowEntry,
  settings: RowFormatSettings,
  count?: ChatUnitTokenMeasurer,
): Promise<RowLengthFacts> {
  supported(settings);
  const source = await JournalTailSource.create(snapshot, []);
  const resolver =
    settings.chat?.toolFormat === 'mistral'
      ? await JournalRequestMistral.create(
          snapshot,
          source,
          [],
          requestFormatSlot(snapshot, settings),
        )
      : undefined;
  return measurePlans(
    journalEntryPlans(source, entry),
    settings,
    count,
    resolver,
  );
}

type ChatUnitFacts = readonly [ChatUnitLengthFacts, ChatUnitLengthFacts];

interface ChatFoldState {
  readonly keptIds: readonly string[];
  readonly removedIds: readonly string[];
}

function keptBytes(facts: ChatUnitLengthFacts): number {
  return facts.messages.reduce(
    (sum, message) => sum + (message.dropped ? 0 : message.bytes),
    0,
  );
}

/** One unit's summary and the length facts of its two thinking variants. */
async function chatUnit(
  row: IContent,
  index: number,
  settings: RowFormatSettings,
  state: ChatFoldState,
  count: ChatUnitTokenMeasurer | undefined,
  rowIds: NativeRowIds | undefined,
  allowOrphans: boolean,
): Promise<{
  readonly unit: SlotSummary;
  readonly thinking: boolean;
  readonly facts: ChatUnitFacts;
  readonly state: ChatFoldState;
}> {
  const ids = await rowIds?.(row, index);
  const hasThinking = row.blocks.some((block) => block.type === 'thinking');
  const kept = factsOf(
    row,
    false,
    settings,
    state.keptIds,
    ids?.(),
    allowOrphans,
  );
  const removed = hasThinking
    ? factsOf(row, true, settings, state.removedIds, ids?.(), allowOrphans)
    : kept;
  const omitted =
    hasThinking && settings.chat?.includeInContext !== false
      ? factsOf(
          row,
          false,
          { ...settings, chat: { ...settings.chat, includeInContext: false } },
          state.keptIds,
          ids?.(),
          allowOrphans,
        )
      : kept;
  // Both variants belong to this unit; never retain payload counts across rows.
  const countTokens =
    count === undefined ? undefined : createUnitTokenCounter();
  const keptTokens = await count?.(kept.messages, countTokens);
  const removedTokens =
    removed === kept ||
    (count !== undefined &&
      JSON.stringify(removed.messages) === JSON.stringify(kept.messages))
      ? keptTokens
      : await count?.(removed.messages, countTokens);
  return {
    unit: {
      kind: 'chat',
      omittedReasoningBytes: keptBytes(kept.facts) - keptBytes(omitted.facts),
      thinkingRank: { units: 1, last: hasThinking ? 1 : 0 },
      ...(keptTokens === undefined || removedTokens === undefined
        ? {}
        : { tokens: [keptTokens, removedTokens] as const }),
      variants: [chatUnitSummary(kept.facts), chatUnitSummary(removed.facts)],
    },
    thinking: hasThinking,
    facts: [kept.facts, removed.facts],
    state: { keptIds: kept.lastIds, removedIds: removed.lastIds },
  };
}

export interface ChatFoldOptions {
  readonly allowOrphans?: boolean;
  readonly count?: ChatUnitTokenMeasurer;
  readonly rowIds?: NativeRowIds;
  /** Sees each unit's length facts; a request fold keeps none of them. */
  readonly onUnit?: (facts: ChatUnitFacts) => void;
  /** Also folds the variant that keeps only the last thinking unit's reasoning. */
  readonly lastThinkingOnly?: boolean;
}

export interface ChatFold {
  readonly summary: SlotSummary;
  readonly lastThinkingOnly: SlotSummary | undefined;
}

/**
 * Folds the units of a request into one chat summary, one unit at a time, so
 * the units are never held together. This is the measurement a format fill
 * stores per unit, taken over the whole request instead.
 */
export async function foldChatUnits(
  rows: AsyncIterable<IContent>,
  settings: RowFormatSettings,
  options: ChatFoldOptions = {},
): Promise<ChatFold> {
  let summary = identitySlotSummary('chat');
  let mixed = options.lastThinkingOnly === true ? summary : undefined;
  let state: ChatFoldState = { keptIds: [], removedIds: [] };
  let index = 0;
  let pendingMedia = false;
  for await (const row of rows) {
    if (row.speaker !== 'tool' && pendingMedia) {
      state = { keptIds: [], removedIds: [] };
      pendingMedia = false;
    }
    const done = await chatUnit(
      row,
      index++,
      settings,
      state,
      options.count,
      options.rowIds,
      options.allowOrphans ?? settings.chat?.allowOrphans === true,
    );
    state = done.state;
    pendingMedia ||= done.facts[0].media.length > 0;
    options.onUnit?.(done.facts);
    if (mixed !== undefined)
      mixed = done.thinking
        ? composeSlotSummaries(
            selectChatSummary(summary, false),
            selectChatSummary(done.unit, true),
          )
        : composeSlotSummaries(mixed, selectChatSummary(done.unit, false));
    summary = composeSlotSummaries(summary, done.unit);
  }
  return { summary, lastThinkingOnly: mixed };
}

async function* planRows(
  plans: AsyncIterable<JournalResponsePlan>,
): AsyncGenerator<IContent> {
  for await (const plan of plans) {
    const blocks: IContent['blocks'] = [];
    for await (const block of plan.openBlocks()) blocks.push(block);
    yield { ...plan.header, blocks };
  }
}

async function measurePlans(
  plans: AsyncIterable<JournalResponsePlan>,
  settings: RowFormatSettings,
  count?: ChatUnitTokenMeasurer,
  resolver?: NativeMistralResolver,
): Promise<RowLengthFacts> {
  const lens: ChatUnitFacts[] = [];
  const { summary } = await foldChatUnits(planRows(plans), settings, {
    count,
    rowIds: resolver === undefined ? undefined : mistralRowIds(resolver),
    onUnit: (facts) => {
      lens.push(facts);
    },
  });
  return {
    summary,
    lens: new TextEncoder().encode(
      JSON.stringify({ revision: 1, units: lens }),
    ),
  };
}

export function plainChatLengthRegistration(
  settings: RowFormatSettings,
  count?: ChatUnitTokenMeasurer,
): RowFormatRegistration {
  supported(settings);
  return {
    settings,
    ...(settings.chat?.toolFormat === 'mistral' ? { mistral: true } : {}),
    measure: (snapshot, entry, captured) =>
      measure(snapshot, entry, captured, count),
    prepare: async (snapshot, captured) => {
      const source = await JournalTailSource.create(snapshot, []);
      const resolver =
        captured.chat?.toolFormat === 'mistral'
          ? await JournalRequestMistral.create(
              snapshot,
              source,
              [],
              requestFormatSlot(snapshot, captured),
            )
          : undefined;
      const entries = snapshot.entries();
      let following = await entries.next();
      return {
        measure: async (_snapshot, entry) => {
          while (
            following.done !== true &&
            (following.value.label <= entry.label ||
              (following.value.flags & ROW_FLAG.curated) === 0)
          )
            following = await entries.next();
          return measurePlans(
            journalEntryPlans(
              source,
              entry,
              following.done === true ? null : following.value,
            ),
            captured,
            count,
            resolver,
          );
        },
        finish: async () => new Uint8Array(0),
        close: async () => {
          await entries.return(undefined);
        },
      };
    },
    prepareAppend: async (snapshot, captured) => {
      const source = await JournalTailSource.create(snapshot, []);
      const resolver =
        captured.chat?.toolFormat === 'mistral'
          ? await JournalRequestMistral.create(
              snapshot,
              source,
              [],
              requestFormatSlot(snapshot, captured),
            )
          : undefined;
      return {
        measure: async (_snapshot, entry) =>
          measurePlans(
            journalEntryPlans(source, entry),
            captured,
            count,
            resolver,
          ),
        finish: async () => new Uint8Array(0),
        close: () => undefined,
      };
    },
  };
}

export interface StoredChatMessagePlan {
  readonly bytes: number;
  readonly items: number;
  readonly tokens: number;
  readonly key: bigint;
  readonly generation: number;
  readonly settings: RowFormatSettings;
  readonly lastThinking: number;
  readonly omittedReasoningBytes: number;
  readonly root: ChatVariant;
}

function finalizedChat(root: ChatVariant): { bytes: number; items: number } {
  const state = 3;
  const end = root.out[state];
  const pending = end % 3 !== 0;
  return {
    bytes:
      root.bytes[state] +
      (pending
        ? Number(end >= 3) + chatMediaFrameBytes(end % 3 === 2) + root.p[state]
        : 0),
    items: root.count[state] + Number(pending),
  };
}

export function appendStoredChatTail(
  plan: StoredChatMessagePlan,
  tail: readonly OpenAI.Chat.ChatCompletionMessageParam[],
): { bytes: number; items: number } {
  const appended = chatUnitSummary({
    speaker: 'ai',
    messages: tail.map((message) => ({
      bytes: jsonBytes(message),
      dropped: false,
    })),
    media: [],
  });
  const combined = composeAffineTables(
    plan.root,
    appended,
    CHAT_MEDIA_PENDING_MASK,
  );
  const before = finalizedChat(plan.root);
  const after = finalizedChat(combined);
  return {
    bytes: plan.bytes - before.bytes + after.bytes,
    items: plan.items - before.items + after.items,
  };
}

/** The plan of one thinking variant of a request's chat summary. */
export function chatPlanOf(
  summary: SlotSummary,
  settings: RowFormatSettings,
  selected: 0 | 1,
  systemInstruction: string,
  format: { readonly key: bigint; readonly generation: number },
): StoredChatMessagePlan {
  if (summary.kind !== 'chat')
    throw new JournalFormatError('Request format has no chat summary');
  const root = summary.variants[selected];
  const finalized = finalizedChat(root);
  return Object.freeze({
    root,
    omittedReasoningBytes:
      selected === 0 ? (summary.omittedReasoningBytes ?? 0) : 0,
    tokens: summary.tokens?.[selected] ?? 0,
    lastThinking: (summary.thinkingRank?.last ?? 0) - 1,
    bytes:
      2 +
      jsonBytes({ role: 'system', content: systemInstruction }) +
      finalized.bytes,
    items: 1 + finalized.items,
    key: format.key,
    generation: format.generation,
    settings: captureRowFormatSettings(settings),
  });
}

export function planStoredChatMessages(
  snapshot: VersionSnapshot,
  settings: RowFormatSettings,
  selected: 0 | 1,
  systemInstruction: string,
  requestSummary?: SlotSummary,
): StoredChatMessagePlan {
  snapshot.requireOpen();
  supported(settings);
  const key = rowFormatKey(settings);
  const version = snapshot.version;
  const slot =
    version?.slots.formatSlots.findIndex(
      (format) => format.summaryKind === 'chat' && format.formatKeyHash === key,
    ) ?? -1;
  if (slot < 0 || version === undefined)
    throw new JournalFormatError(
      'Request format is not registered in this pin',
    );
  const format = version.slots.formatSlots[slot];
  if (
    version.rows !== 0 &&
    (version.aggregate.stamp[slot].gen !== format.gen ||
      version.aggregate.missingBase[slot] !== 0)
  )
    throw new JournalFormatError(
      'Request format length facts are unmeasured or stale',
    );
  const summary =
    requestSummary ??
    (version.rows === 0
      ? identitySlotSummary('chat')
      : decodeSlotSummary(version.aggregate.summaries[slot], format));
  return chatPlanOf(summary, settings, selected, systemInstruction, {
    key,
    generation: format.gen,
  });
}

function selectChatSummary(value: SlotSummary, kept: boolean): SlotSummary {
  if (value.kind !== 'chat')
    throw new JournalFormatError('Expected Chat summary');
  const index = kept ? 0 : 1;
  return {
    ...value,
    variants: [value.variants[index], value.variants[index]],
    ...(value.omittedReasoningBytes === undefined
      ? {}
      : { omittedReasoningBytes: kept ? value.omittedReasoningBytes : 0 }),
    ...(value.tokens === undefined
      ? {}
      : { tokens: [value.tokens[index], value.tokens[index]] as const }),
  };
}

export async function planRequestChatMessages(
  snapshot: VersionSnapshot,
  indexed: IndexedJournalRequestSnapshot,
  settings: RowFormatSettings,
  selected: 0 | 1 | 2,
  systemInstruction: string,
  count?: ChatUnitTokenMeasurer,
): Promise<StoredChatMessagePlan> {
  const variant = selected === 2 ? 1 : selected;
  const planned = (
    choice: 0 | 1,
    summary?: SlotSummary,
  ): StoredChatMessagePlan =>
    planStoredChatMessages(
      snapshot,
      settings,
      choice,
      systemInstruction,
      summary,
    );
  const base = planned(variant);
  if (indexed.viewPlan.changedSources.length === 0 && selected !== 2)
    return base;
  const slot = snapshot.version?.slots.formatSlots.findIndex(
    (format) =>
      format.summaryKind === 'chat' && format.formatKeyHash === base.key,
  );
  if (slot === undefined || slot < 0)
    throw new JournalFormatError('Request format is not registered');
  const resolver =
    settings.chat?.toolFormat === 'mistral'
      ? await indexed.mistralForSnapshot(snapshot, slot)
      : undefined;
  const measure = async (
    plans: AsyncIterable<JournalResponsePlan>,
  ): Promise<SlotSummary> =>
    (await measurePlans(plans, settings, count, resolver)).summary;
  const summary = await indexed.formatSummary(
    snapshot,
    slot,
    measure,
    undefined,
    resolver?.affectedSources(),
  );
  if (selected !== 2) return planned(selected, summary);
  if (summary.kind !== 'chat')
    throw new JournalFormatError('Expected Chat summary');
  const lastThinking = (summary.thinkingRank?.last ?? 0) - 1;
  if (lastThinking < 0) return planned(1, summary);
  const target = await indexed.unitEntryAt(lastThinking);
  const mixed = await indexed.formatSummary(
    snapshot,
    slot,
    measure,
    {
      label: target.entry.label,
      select: selectChatSummary,
    },
    resolver?.affectedSources(),
  );
  return Object.freeze({
    ...planned(0, mixed),
    lastThinking,
  });
}
