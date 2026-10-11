/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProviderFileBindingStore } from './providerRuntimeContext.js';

export function bindProviderFiles<T extends object>(
  provider: T,
  bindings: ProviderFileBindingStore | undefined,
  lifecycle: object | undefined,
  workspaceDirectory: string | undefined,
): T {
  if (
    !('requestProviderFileBindings' in provider) &&
    !('wrapped' in provider) &&
    !('wrappedProvider' in provider)
  )
    return provider;
  const bindWrapped = (property: string): unknown => {
    const value: unknown = Reflect.get(provider, property);
    return typeof value === 'object' && value !== null
      ? bindProviderFiles(value, bindings, lifecycle, workspaceDirectory)
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
      if (property === 'requestProviderFileBindings') return bindings;
      if (property === 'requestProviderFileLifecycle') return lifecycle;
      if (property === 'requestWorkspaceDirectory') return workspaceDirectory;
      if (property === 'wrapped') return wrapped;
      if (property === 'wrappedProvider') return wrappedProvider;
      return Reflect.get(target, property, receiver);
    },
  });
}
