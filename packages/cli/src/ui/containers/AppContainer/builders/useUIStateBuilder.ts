/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import { buildUIState, type UIStateParams } from './buildUIState.js';
import type { UIState } from '../../../contexts/UIStateContext.js';

/**
 * @hook useUIStateBuilder
 * @description Wraps buildUIState with useMemo for memoized UIState
 * @inputs All primitives from hooks via UIStateParams
 * @outputs Memoized UIState
 * @sideEffects useMemo
 * @strictMode Safe - useMemo deps are primitives
 */
export function useUIStateBuilder(params: UIStateParams): UIState {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => buildUIState(params), Object.values(params));
}
