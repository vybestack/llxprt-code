/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CommandOwnerFixture } from '../../../__tests__/mockCommandContext.js';

import type { IContent } from '@vybestack/llxprt-code-core';
import { getProviderDumpMetadata } from '@vybestack/llxprt-code-agents';
export function bindDumpManager(
  context: CommandOwnerFixture,
  runtimeApi: () => Record<string, unknown>,
  manager: () =>
    | {
        getActiveProviderName(): string | undefined;
        getActiveProvider():
          | {
              getCurrentModel?: () => string | undefined;
              baseURL?: string;
              buildContextDumpBody?: (
                history: IContent[],
                model?: string,
                config?: unknown,
              ) => Record<string, unknown>;
            }
          | undefined;
      }
    | undefined,
): void {
  Object.defineProperty(context, 'runtimeApi', {
    configurable: true,
    get: () => ({
      ...runtimeApi(),
      getProviderDumpMetadata: () => getProviderDumpMetadata(manager()),
    }),
  });
}
