/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CommandContext } from '../types.js';
import type { IContent } from '@vybestack/llxprt-code-core';
import { getProviderDumpMetadata } from '../../../runtime/providerInspection.js';
export function bindDumpManager(
  context: CommandContext,
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
