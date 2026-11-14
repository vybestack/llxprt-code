/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CommandOwnerFixture } from '../../../__tests__/mockCommandContext.js';
import type { IProvider } from '@vybestack/llxprt-code-providers';
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
