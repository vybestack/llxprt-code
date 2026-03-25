/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import { buildUIActions, type UIActionsParams } from './buildUIActions.js';
import type { UIActions } from '../../../contexts/UIActionsContext.js';

/**
 * @hook useUIActionsBuilder
 * @description Wraps buildUIActions with useMemo for memoized UIActions
 * @inputs All action callbacks via UIActionsParams
 * @outputs Memoized UIActions
 * @sideEffects useMemo
 * @strictMode Safe - useMemo deps are stable callbacks
 */
export function useUIActionsBuilder(params: UIActionsParams): UIActions {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => buildUIActions(params), Object.values(params));
}
