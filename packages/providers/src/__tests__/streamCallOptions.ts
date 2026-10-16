/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260917-ISSUE854.P05b3
 *
 * Test-side adapter for the streaming history contract (issue #854):
 * `createProviderCallOptions` preserves the eager rows tests assemble, while
 * the provider-facing `GenerateChatOptions.contents` is
 * `AsyncIterable<IContent>`. Tests that hand options straight to
 * `generateChatCompletion` re-open the eager rows as a replayable stream
 * here, keeping call sites one-liners.
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  createProviderCallOptions,
  type ProviderCallOptionsInit,
} from '@vybestack/llxprt-code-test-utils/core/providerCallOptions.js';
import { replayableContents } from '../utils/collectContents.js';

export function streamCallOptions(init: ProviderCallOptionsInit): Omit<
  ReturnType<typeof createProviderCallOptions>,
  'contents'
> & {
  contents: AsyncIterable<IContent>;
} {
  const options = createProviderCallOptions(init);
  return {
    ...options,
    contents:
      Symbol.asyncIterator in options.contents
        ? options.contents
        : replayableContents(options.contents),
  };
}
