/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type { ToolFormat } from '@vybestack/llxprt-code-tools/IToolFormatter.js';
import type { NativeRowIds } from '../openai/native-row-ids.js';
import { nativeKimiRowIds } from '../openai/native-kimi-row.js';
import { mistralRowIds } from '../openai/native-mistral-row.js';
import {
  plainChatLengthRegistration,
  PLAIN_CHAT_FORMAT_REV,
} from '../openai/journal-chat-length.js';
import { requestFormatSlot } from '@vybestack/llxprt-code-core/services/history/native-provider-format.js';
import { parseOutputLimits } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import {
  createInMemoryToolIdStore,
  getToolIdStrategy,
} from '@vybestack/llxprt-code-tools/ToolIdStrategy.js';
import { getRequestSignal } from '../utils/abortSignal.js';

export async function transportToolIds(
  options: NormalizedGenerateChatOptions,
  format: ToolFormat,
): Promise<{ rowIds?: NativeRowIds; release: () => void | Promise<void> }> {
  if (format !== 'kimi' && format !== 'mistral') return { release() {} };
  const rows = options.requestRows;
  const native = rows?.native;
  if (native === undefined) {
    if (rows?.callerOwned !== true)
      throw new Error(
        'Vercel tool-id mapping requires an indexed or caller-owned request selection',
      );
    const mapper = getToolIdStrategy(format).createStreamingMapper(
      createInMemoryToolIdStore(),
    );
    const signal = getRequestSignal(options);
    for (let index = 0; index < rows.count; index++)
      mapper.observe(await rows.readAt(index, signal));
    return { rowIds: async () => () => mapper, release() {} };
  }
  if (format === 'kimi')
    return native.withKimi(async (snapshot) => {
      const rowIds = nativeKimiRowIds(
        await native.indexed.kimiForSnapshot(snapshot),
      );
      return { rowIds, release: snapshot.hold() };
    });
  const registration = plainChatLengthRegistration({
    formatId: 'openai-chat:mistral',
    formatRev: PLAIN_CHAT_FORMAT_REV,
    model: options.resolved.model,
    endpoint: options.resolved.baseURL ?? '',
    isOAuth: false,
    toolNameTransform: 'none',
    supportsUrlImages: true,
    reasoningEnabled: false,
    reasoningFieldName: 'reasoning_content',
    mediaPdfEnabled: false,
    unsupportedMedia: 'notice',
    outputLimits: parseOutputLimits(options.invocation.ephemerals),
    chat: {
      toolFormat: 'mistral',
      mistralRevision: 'sha256-base62-salt-v1-normalizer-v1',
      includeInContext: false,
    },
  });
  return native.withFormat(registration, async (snapshot) => {
    const rowIds = mistralRowIds(
      await native.indexed.mistralForSnapshot(
        snapshot,
        requestFormatSlot(snapshot, registration.settings),
      ),
    );
    return { rowIds, release: snapshot.hold() };
  });
}
