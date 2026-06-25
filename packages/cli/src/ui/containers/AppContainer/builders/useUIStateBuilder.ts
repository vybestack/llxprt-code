/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { buildUIState, type UIStateParams } from './buildUIState.js';
import { useShallowMemo } from '../../../hooks/useShallowMemo.js';
import type { UIState } from '../../../contexts/UIStateContext.js';

/**
 * @hook useUIStateBuilder
 * @description Wraps buildUIState with shallow-value memoization for UIState
 * @inputs All primitives from hooks via UIStateParams
 * @outputs Memoized UIState
 * @sideEffects useRef-based memoization
 * @strictMode Safe - recomputes only when a param value changes
 */
export function useUIStateBuilder(params: UIStateParams): UIState {
  return useShallowMemo(() => buildUIState(params), params);
}
