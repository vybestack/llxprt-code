/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import type { UseInputHistoryStoreReturn } from '../../../hooks/useInputHistoryStore.js';
import type { Logger } from '@vybestack/llxprt-code-core';

type InputHistoryStoreLike = Pick<
  UseInputHistoryStoreReturn,
  'initializeFromLogger'
>;

interface UseInputHistoryBootstrapParams {
  inputHistoryStore: InputHistoryStoreLike;
  logger: Logger | null;
}

/**
 * @hook useInputHistoryBootstrap
 * @description Initializes input history store from persisted logger history
 * @inputs inputHistoryStore, logger
 * @outputs void
 */
export function useInputHistoryBootstrap({
  inputHistoryStore,
  logger,
}: UseInputHistoryBootstrapParams): void {
  useEffect(() => {
    void inputHistoryStore.initializeFromLogger(logger);
  }, [inputHistoryStore, logger]);
}
