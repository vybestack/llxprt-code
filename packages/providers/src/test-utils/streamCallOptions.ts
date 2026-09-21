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
} from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import { replayableContents } from '../utils/collectContents.js';

export function streamCallOptions(init: ProviderCallOptionsInit): Omit<
  ReturnType<typeof createProviderCallOptions>,
  'contents'
> & {
  contents: AsyncIterable<IContent>;
} {
  const options = createProviderCallOptions(init);
  const rows = Array.isArray(init.contents) ? init.contents : [];
  return { ...options, contents: replayableContents(rows) };
}
