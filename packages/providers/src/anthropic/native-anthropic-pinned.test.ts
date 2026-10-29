/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { JournalProviderRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/journal-provider-request.js';
import { nativeRequestResources } from '@vybestack/llxprt-code-core/services/history/native-provider-format.js';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import {
  anthropicLengthRegistration,
  planStoredAnthropicRequest,
} from './journal-anthropic-length.js';

const settings: RowFormatSettings = {
  formatId: 'anthropic',
  formatRev: 1,
  model: 'claude-opus-5',
  endpoint: 'https://api.anthropic.com',
  isOAuth: false,
  toolNameTransform: 'none',
  supportsUrlImages: true,
  reasoningEnabled: false,
  reasoningFieldName: 'reasoning_content',
  mediaPdfEnabled: true,
  unsupportedMedia: 'notice',
  outputLimits: null,
  anthropic: { cache: 'off', imageBudget: null },
};

describe('native Anthropic detached request format fill', () => {
  const directory = useTempDir('native-anthropic-pinned-');
  it('fills repair facts and lengths on a held pin without replacing live history or creating files', async () => {
    const session = await JournalSession.create(`${directory()}/history.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    try {
      await session.append([
        { speaker: 'human', blocks: [{ type: 'text', text: 'snow 雪' }] },
      ]);
      const pin = await session.store.snapshot();
      const live = session.store.published;
      const request = await JournalProviderRequestSnapshot.create(
        pin,
        [],
        {},
        undefined,
        undefined,
        nativeRequestResources(session.store).prepareRequestFormat,
      );
      try {
        let bytes = 0;
        const created = await operationFileCreates(async () => {
          bytes = await request.native.withFormat(
            anthropicLengthRegistration(settings),
            async (snapshot) =>
              (
                await planStoredAnthropicRequest(
                  snapshot,
                  settings,
                  {},
                  { model: settings.model },
                )
              ).messagesBytes,
          );
        }, true);
        expect(created).toStrictEqual({ directories: [], files: [] });
        expect(bytes).toBe(
          Buffer.byteLength(
            JSON.stringify([{ role: 'user', content: 'snow 雪' }]),
          ),
        );
        expect(session.store.published?.roots.rowRoot).toBe(
          live?.roots.rowRoot,
        );
      } finally {
        await request.close();
      }
    } finally {
      await session.close();
    }
  });
});
