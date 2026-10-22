/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect, spyOn } from 'bun:test';
import type { HistoryService } from '../../../../../core/src/services/history/HistoryService.js';
import type { JournalStore } from '../../../../../core/src/journal/journalStore.js';
import { JournalProviderRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/journal-provider-request.js';
import type { RowFormatRegistration } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import type { VersionSnapshot } from '../../../../../core/src/journal/versionSnapshot.js';
import type { RowFormatSettings } from '../../../../../core/src/journal/rowFormat.js';
import { requestFormatSlot } from '../../../../../core/src/services/history/native-provider-format.js';
import {
  anthropicLengthRegistration,
  planStoredAnthropicRequest,
} from '../../../../../providers/src/anthropic/journal-anthropic-length.js';
import { anthropicRepairFactIndex } from '../../../../../providers/src/anthropic/anthropic-repair-fact-writer.js';
import {
  responsesLengthRegistration,
  planStoredResponsesRequest,
} from '../../../../../providers/src/openai-responses/journal-responses-length.js';
import {
  plainChatLengthRegistration,
  planStoredChatMessages,
  PLAIN_CHAT_FORMAT_REV,
} from '../../../../../providers/src/openai/journal-chat-length.js';

const plain: RowFormatSettings = {
  formatId: 'openai-chat:plain',
  formatRev: PLAIN_CHAT_FORMAT_REV,
  model: 'gpt-4o',
  endpoint: 'https://occupied.test/v1',
  isOAuth: false,
  toolNameTransform: 'none',
  supportsUrlImages: true,
  reasoningEnabled: false,
  reasoningFieldName: 'reasoning_content',
  mediaPdfEnabled: false,
  unsupportedMedia: 'notice',
  outputLimits: null,
};
const anthropic: RowFormatSettings = {
  ...plain,
  formatId: 'anthropic',
  formatRev: 1,
  model: 'claude-sonnet-4',
  reasoningEnabled: true,
  mediaPdfEnabled: true,
  anthropic: { cache: 'off', imageBudget: null },
};
const responses: RowFormatSettings = {
  ...plain,
  formatId: 'responses',
  formatRev: 1,
  mediaPdfEnabled: true,
};
async function otherPlans(pin: VersionSnapshot): Promise<readonly number[]> {
  return [
    (
      await planStoredAnthropicRequest(
        pin,
        anthropic,
        {},
        { model: anthropic.model, max_tokens: 1 },
      )
    ).messagesBytes,
    planStoredResponsesRequest(
      pin,
      responses,
      0,
      { model: responses.model, input: [], stream: true },
      1780000000123,
    ).inputBytes,
  ];
}

async function primaryWithoutMedia(
  history: HistoryService,
): Promise<JournalStore> {
  let primary: JournalStore | undefined;
  await history.registerMediaOwner({
    async bindNativeMedia(store): Promise<void> {
      primary = store;
    },
    prepareReplacement: () => ({ publish() {}, rollback() {} }),
    async prepareReferenceAddition(references) {
      for await (const reference of references)
        throw new Error(`Unexpected media ${reference.type}`);
      return { publish() {}, rollback() {} };
    },
    async prepareReferenceReplacement(references) {
      for await (const reference of references)
        throw new Error(`Unexpected media ${reference.type}`);
      return { publish() {}, rollback() {} };
    },
    async reconcile(): Promise<void> {},
    async releaseAll(): Promise<void> {},
    adopt() {},
  });
  if (primary === undefined) throw new Error('Missing primary journal');
  return primary;
}

export async function occupyMistralFormats(history: HistoryService): Promise<{
  verify(): Promise<void>;
  close(): Promise<void>;
}> {
  const store = await primaryWithoutMedia(history);
  await store.commit([
    { kind: 'format', registration: plainChatLengthRegistration(plain) },
  ]);
  await store.commit([
    { kind: 'factIndex', registration: anthropicRepairFactIndex(anthropic) },
  ]);
  await store.commit([
    { kind: 'format', registration: anthropicLengthRegistration(anthropic) },
  ]);
  await store.commit([
    { kind: 'format', registration: responsesLengthRegistration(responses) },
  ]);
  const old = await store.snapshot();
  const oldBytes = planStoredChatMessages(old, plain, 0, '').bytes;
  const otherBytes = await otherPlans(old);
  expect(otherBytes.every((bytes) => bytes > 2)).toBe(true);
  expect(
    old.version?.slots.formatSlots.map((slot) => slot.summaryKind),
  ).toStrictEqual(['chat', 'anthropic', 'responses']);
  const captured: Array<{ pin: VersionSnapshot; settings: RowFormatSettings }> =
    [];
  const create = JournalProviderRequestSnapshot.create;
  const observer = spyOn(
    JournalProviderRequestSnapshot,
    'create',
  ).mockImplementation(async (...args) => {
    const selected = await create(...args);
    const withFormat = selected.native.withFormat;
    selected.native.withFormat = <T>(
      registration: RowFormatRegistration,
      consume: (pin: VersionSnapshot) => T | Promise<T>,
    ): Promise<T> =>
      withFormat(registration, async (measured) => {
        if (registration.settings.chat?.toolFormat === 'mistral') {
          if (captured.length === 0) {
            expect(requestFormatSlot(measured, registration.settings)).toBe(0);
            expect(measured.version?.slots.formatSlots[0].gen).toBe(2);
            expect(await otherPlans(measured)).toStrictEqual(otherBytes);
          }
          captured.push({
            pin: measured.retain(),
            settings: registration.settings,
          });
        }
        return consume(measured);
      });
    return selected;
  });
  return {
    async verify(): Promise<void> {
      expect(captured.length).toBeGreaterThan(0);
      expect(
        captured.some(
          ({ settings }) => settings.chat?.estimatorKey !== undefined,
        ),
      ).toBe(true);
      expect(planStoredChatMessages(old, plain, 0, '').bytes).toBe(oldBytes);
      expect(await otherPlans(old)).toStrictEqual(otherBytes);
      const first = captured[0];
      expect(
        planStoredChatMessages(first.pin, first.settings, 0, '').generation,
      ).toBe(2);
      expect(await otherPlans(first.pin)).toStrictEqual(otherBytes);
      for (const { pin, settings } of captured)
        expect(
          planStoredChatMessages(pin, settings, 0, '').bytes,
        ).toBeGreaterThan(2);
    },
    async close(): Promise<void> {
      observer.mockRestore();
      for (const { pin } of captured) await pin.close();
      await old.close();
    },
  };
}
