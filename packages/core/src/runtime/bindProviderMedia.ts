/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RequestMediaResolutionService } from '../storage/request-media-resolver.js';

export function bindProviderMedia<T extends object>(
  provider: T,
  mediaResolver: RequestMediaResolutionService | undefined,
  mediaBudgetBytes: number | undefined,
): T {
  if (
    !('requestMediaResolver' in provider) &&
    !('wrapped' in provider) &&
    !('wrappedProvider' in provider)
  )
    return provider;
  const bindWrapped = (property: string): unknown => {
    const value: unknown = Reflect.get(provider, property);
    return typeof value === 'object' && value !== null
      ? bindProviderMedia(value, mediaResolver, mediaBudgetBytes)
      : value;
  };
  const wrapped = bindWrapped('wrapped');
  const wrappedProvider =
    Reflect.get(provider, 'wrappedProvider') ===
    Reflect.get(provider, 'wrapped')
      ? wrapped
      : bindWrapped('wrappedProvider');
  return new Proxy(provider, {
    get(target, property, receiver): unknown {
      if (property === 'requestMediaResolver') return mediaResolver;
      if (property === 'requestMediaBudgetBytes') return mediaBudgetBytes;
      if (property === 'wrapped') return wrapped;
      if (property === 'wrappedProvider') return wrappedProvider;
      return Reflect.get(target, property, receiver);
    },
  });
}
