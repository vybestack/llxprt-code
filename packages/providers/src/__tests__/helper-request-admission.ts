/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { normalizeRuntimeInputs as normalizeRequest } from '../runtimeNormalizer.js';
import { captureProviderInvocation } from '@vybestack/llxprt-code-core/runtime/providerRequestContext.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { GenerateChatOptions, IProvider } from '../IProvider.js';
export function normalizeRuntimeInputs(
  options: Omit<GenerateChatOptions, 'runtime'> & {
    runtime?: ProviderRuntimeContext;
  },
  deps: {
    getActiveProviderName(): string | undefined;
    getProvider(name: string): IProvider | undefined;
  },
  providerName?: string,
): GenerateChatOptions {
  return normalizeRequest(
    {
      ...options,
    },
    {
      ...deps,
      admitRequest: (input, name) => {
        const suppliedOwner = options.runtime;
        if (!suppliedOwner) throw new Error('Fixture owner is required');
        const owner = suppliedOwner;
        const invocation =
          input.invocation ?? captureProviderInvocation(owner, name);
        const scoped = owner.settingsService.getProviderSettings(name);
        const scopedAuth = scoped['auth-key'];
        const globalAuth = owner.settingsService.get('auth-key');
        let ownerToken: string | undefined;
        if (typeof scopedAuth === 'string') ownerToken = scopedAuth;
        else if (typeof globalAuth === 'string') ownerToken = globalAuth;
        return {
          ...input,
          invocation,
          userMemory: input.userMemory,
          resolved: {
            ...input.resolved,
            authToken: input.resolved?.authToken ?? ownerToken,
          },
        };
      },
    },
    providerName,
  );
}
