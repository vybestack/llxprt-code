/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createContext,
  useContext,
  type PropsWithChildren,
  type JSX,
} from 'react';
import type { AgentSessionAuthentication } from '@vybestack/llxprt-code-agents';

export type OAuthControl = AgentSessionAuthentication;

const OAuthControlContext = createContext<OAuthControl | null>(null);

export function OAuthControlProvider({
  control,
  children,
}: PropsWithChildren<{ control: OAuthControl }>): JSX.Element {
  return (
    <OAuthControlContext.Provider value={control}>
      {children}
    </OAuthControlContext.Provider>
  );
}

export function useOAuthControl(): OAuthControl {
  const control = useContext(OAuthControlContext);
  if (!control)
    throw new Error('OAuthControlProvider is missing from the component tree.');
  return control;
}
