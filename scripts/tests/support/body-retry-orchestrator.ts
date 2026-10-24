/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '../../../packages/core/src/services/history/IContent.js';
import type {
  GenerateChatOptions,
  ProviderToolset,
} from '../../../packages/providers/src/IProvider.js';
import { RetryOrchestrator } from '../../../packages/providers/src/RetryOrchestrator.js';
import { bodyRequestRows } from './body-request-rows.js';

/** Marks independently assembled byte-oracle inputs as owned by the fixture. */
export class BodyRetryOrchestrator extends RetryOrchestrator {
  override async *generateChatCompletion(
    input: GenerateChatOptions | AsyncIterable<IContent>,
    tools?: ProviderToolset,
    signal?: AbortSignal,
  ): AsyncIterableIterator<IContent> {
    if (!('contents' in input))
      throw new Error('Expected summary call options');
    const rows = input.requestRows;
    if (rows?.native !== undefined) {
      yield* super.generateChatCompletion(input, tools, signal);
      return;
    }
    const selection =
      rows === undefined
        ? await bodyRequestRows(input.contents)
        : { ...rows, callerOwned: true };
    yield* super.generateChatCompletion(
      {
        ...input,
        requestRows: { ...selection, callerOwned: true },
        contentCount: selection.count,
      },
      tools,
      signal,
    );
  }
}
