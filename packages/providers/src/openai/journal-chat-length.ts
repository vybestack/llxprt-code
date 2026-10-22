/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type OpenAI from 'openai';
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
} from '@vybestack/llxprt-code-core/journal/summaryComposition.js';
import { journalEntryPlans } from '@vybestack/llxprt-code-core/services/history/journal-entry-plans.js';
import { JournalTailSource } from '@vybestack/llxprt-code-core/services/history/journal-tail-source.js';
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

export const PLAIN_CHAT_FORMAT_REV = 1;
const jsonBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value), 'utf8');

function factsOf(
  row: IContent,
  stripped: boolean,
  settings: RowFormatSettings,
  previous: readonly string[],
): { facts: ChatUnitLengthFacts; lastIds: readonly string[] } {
  const unit = stripped ? removeThinkingFromContent(row) : row;
  const pending: MediaBlock[] = [];
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (unit.speaker === 'human') {
    const message = processUserMessage(unit);
    if (message !== null) messages.push(message);
  } else if (unit.speaker === 'ai') {
    const message = processAssistantMessage(
      unit,
      settings.chat?.includeInContext ?? true,
      undefined,
      (call) => normalizeToOpenAIToolId(call.id),
      normalizeToolCallArguments,
    );
    if (message !== null) messages.push(message);
  } else
    messages.push(
      ...processToolResponses(
        unit,
        'openai',
        (response) => normalizeToOpenAIToolId(response.callId),
        buildToolResponseContent,
        settings.outputLimits ?? undefined,
        pending,
      ),
    );
  let lastIds = previous;
  const facts = messages.map((message) => {
    const dropped =
      message.role === 'tool' && !lastIds.includes(message.tool_call_id);
    if (!dropped) {
      if (message.role === 'assistant' && message.tool_calls !== undefined)
        lastIds = message.tool_calls.map((call) => call.id);
      else if (message.role !== 'assistant' && message.role !== 'tool')
        lastIds = [];
    }
    return { bytes: jsonBytes(message), dropped };
  });
  return {
    facts: {
      speaker: row.speaker,
      messages: facts,
      media: pending.map((block) => {
        const part = convertBlockToPart(block);
        return {
          bytes: part === null ? null : jsonBytes(part),
          video: classifyMediaBlock(block) === 'video',
        };
      }),
    },
    lastIds,
  };
}

function supported(settings: RowFormatSettings): void {
  const unsupported = [
    settings.formatId !== 'openai-chat:plain',
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
): Promise<RowLengthFacts> {
  supported(settings);
  const source = await JournalTailSource.create(snapshot, []);
  let summary = identitySlotSummary('chat');
  const lens: Array<readonly [ChatUnitLengthFacts, ChatUnitLengthFacts]> = [];
  let keptIds: readonly string[] = [];
  let removedIds: readonly string[] = [];
  for await (const plan of journalEntryPlans(source, entry)) {
    const blocks: IContent['blocks'] = [];
    for await (const block of plan.openBlocks()) {
      if (
        block.type === 'media' &&
        block.encoding !== 'base64' &&
        block.encoding !== 'url'
      )
        throw new JournalFormatError(
          'Stored-media reference length measurement requires media projection',
        );
      if (block.type === 'tool_call' && plan.header.speaker !== 'ai')
        throw new JournalFormatError(
          'Non-AI tool-call length facts need indexed global call presence',
        );
      blocks.push(block);
    }
    const row = { ...plan.header, blocks };
    const kept = factsOf(row, false, settings, keptIds);
    const removed = factsOf(row, true, settings, removedIds);
    keptIds = kept.lastIds;
    removedIds = removed.lastIds;
    lens.push([kept.facts, removed.facts]);
    summary = composeSlotSummaries(summary, {
      kind: 'chat',
      variants: [chatUnitSummary(kept.facts), chatUnitSummary(removed.facts)],
    });
  }
  return {
    summary,
    lens: new TextEncoder().encode(
      JSON.stringify({ revision: PLAIN_CHAT_FORMAT_REV, units: lens }),
    ),
  };
}

export function plainChatLengthRegistration(
  settings: RowFormatSettings,
): RowFormatRegistration {
  supported(settings);
  return { settings, measure };
}

export interface StoredChatMessagePlan {
  readonly bytes: number;
  readonly items: number;
  readonly key: bigint;
  readonly generation: number;
  readonly settings: RowFormatSettings;
}

export function planStoredChatMessages(
  snapshot: VersionSnapshot,
  settings: RowFormatSettings,
  selected: 0 | 1,
  systemInstruction: string,
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
    version.rows === 0
      ? identitySlotSummary('chat')
      : decodeSlotSummary(version.aggregate.summaries[slot], format);
  if (summary.kind !== 'chat')
    throw new JournalFormatError('Request format has no chat summary');
  const root = summary.variants[selected];
  const state = 3;
  const end = root.out[state];
  let flush = 0;
  if (end % 3 !== 0)
    flush =
      Number(end >= 3) + chatMediaFrameBytes(end % 3 === 2) + root.p[state];
  return Object.freeze({
    bytes:
      2 +
      jsonBytes({ role: 'system', content: systemInstruction }) +
      root.bytes[state] +
      flush,
    items: 1 + root.count[state] + (end % 3 === 0 ? 0 : 1),
    key,
    generation: format.gen,
    settings: captureRowFormatSettings(settings),
  });
}
