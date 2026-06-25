/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { buildUIActions, type UIActionsParams } from './buildUIActions.js';
import { useShallowMemo } from '../../../hooks/useShallowMemo.js';
import type { UIActions } from '../../../contexts/UIActionsContext.js';

/**
 * @hook useUIActionsBuilder
 * @description Wraps buildUIActions with shallow-value memoization for UIActions
 * @inputs All action callbacks via UIActionsParams
 * @outputs Memoized UIActions
 * @sideEffects useRef-based memoization
 * @strictMode Safe - recomputes only when a param value changes
 */
export function useUIActionsBuilder(params: UIActionsParams): UIActions {
  return useShallowMemo(() => buildUIActions(params), params);
}
