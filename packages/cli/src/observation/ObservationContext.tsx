/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createContext, useContext } from 'react';
import type { ObservationCallbacks } from './jspWiring.js';

export const ObservationContext = createContext<ObservationCallbacks | null>(
  null,
);

export function useObservationCallbacks(): ObservationCallbacks {
  const callbacks = useContext(ObservationContext);
  if (callbacks === null)
    throw new Error('Observation callbacks require an owning CLI root');
  return callbacks;
}
