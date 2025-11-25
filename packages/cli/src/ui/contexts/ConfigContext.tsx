/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext } from 'react';
import type { Config } from '@vybestack/llxprt-code-core';

const ConfigContext = createContext<Config | undefined>(undefined);

export const ConfigProvider: React.FC<{
  config: Config;
  children: React.ReactNode;
}> = ({ config, children }) => (
  <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>
);

export function useConfig(): Config {
  const context = useContext(ConfigContext);
  if (!context) {
    throw new Error('useConfig must be used within a ConfigProvider');
  }
  return context;
}
