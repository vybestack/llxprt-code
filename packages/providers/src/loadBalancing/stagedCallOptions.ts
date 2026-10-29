/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  GenerateChatOptions,
  ProviderChatOptions,
  ProviderToolset,
} from '../IProvider.js';
import { closeStagedRowsAfterFailure } from '../BaseProviderNormalization.js';
import { isAsyncIterableContents } from '../utils/collectContents.js';
import { providerRowsOf } from '../utils/providerRows.js';
import {
  acquireRequestRows,
  admitProviderContents,
} from '../utils/requestRowsLease.js';
import { normalizeLoadBalancerOptions } from './resolvedOptionsBuilder.js';
import { optionsWithRequestRows } from './preparedPromptOptions.js';

/** The options a load-balanced call is sent with, and the staging behind them. */
export interface StagedCallOptions {
  readonly options: GenerateChatOptions;
  /** Releases the staging this call created; a no-op for a caller's rows. */
  close(): Promise<void>;
}

/**
 * Gives a load-balanced call a repeatable, countable row selection. A call that
 * carries `requestRows` already has one and is used as is. Any other call has a
 * one-shot `contents` stream, which is staged on the request's scratch disk one
 * row at a time, so every attempt reopens the same rows and no history array is
 * built (issue #854).
 */
export async function stageCallOptions(
  optionsOrContent: ProviderChatOptions | AsyncIterable<IContent>,
  tools: ProviderToolset | undefined,
  signal: AbortSignal | undefined,
): Promise<StagedCallOptions> {
  if (
    !isAsyncIterableContents(optionsOrContent) &&
    optionsOrContent.requestRows !== undefined
  ) {
    return {
      options: admitProviderContents(optionsOrContent),
      close: async () => {},
    };
  }
  const scope = acquireRequestRows(
    isAsyncIterableContents(optionsOrContent)
      ? optionsOrContent
      : normalizeLoadBalancerOptions(admitProviderContents(optionsOrContent)),
    tools,
    signal,
  );
  try {
    const rows = await providerRowsOf(scope.options);
    return {
      options: optionsWithRequestRows(scope.options, {
        ...rows,
        // The staging owns the rows; no member closes the selection.
        close: () => undefined,
      }),
      close: () => scope.close(),
    };
  } catch (error) {
    return closeStagedRowsAfterFailure(scope, error);
  }
}

/**
 * Runs a load-balanced call over its staged options and releases the staging
 * afterwards. A failure of the call takes precedence over a failure to release
 * the staging, as for the delegate attempts (`cleanupDelegateAttempt`).
 */
export async function* runStagedCall<T>(
  staged: StagedCallOptions,
  run: (options: GenerateChatOptions) => AsyncIterable<T>,
): AsyncGenerator<T> {
  let failed = false;
  let failure: unknown;
  let closeFailure: unknown;
  try {
    yield* run(staged.options);
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    try {
      await staged.close();
    } catch (error) {
      closeFailure = error;
    }
  }
  if (failed) throw failure;
  if (closeFailure !== undefined) throw closeFailure;
}
