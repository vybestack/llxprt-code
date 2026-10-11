/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createContext, useContext, type PropsWithChildren } from 'react';

export type ProviderAliasRefresh = () => Promise<void>;

const ProviderAliasRefreshContext = createContext<ProviderAliasRefresh | null>(
  null,
);

export function ProviderAliasRefreshProvider({
  refresh,
  children,
}: PropsWithChildren<{ refresh: ProviderAliasRefresh }>): React.ReactElement {
  return (
    <ProviderAliasRefreshContext.Provider value={refresh}>
      {children}
    </ProviderAliasRefreshContext.Provider>
  );
}

export function useProviderAliasRefresh(): ProviderAliasRefresh {
  const refresh = useContext(ProviderAliasRefreshContext);
  if (!refresh) throw new Error('ProviderAliasRefreshProvider is missing.');
  return refresh;
}
