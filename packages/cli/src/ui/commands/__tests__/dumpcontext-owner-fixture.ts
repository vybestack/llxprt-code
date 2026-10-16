/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CommandContext } from '../types.js';
import type { IProvider } from '@vybestack/llxprt-code-providers';
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
              contextDumpVersion?: number;
              buildContextDumpBody?: IProvider['buildContextDumpBody'];
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
