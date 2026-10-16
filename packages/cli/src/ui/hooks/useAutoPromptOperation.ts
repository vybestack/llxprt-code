/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useMemo } from 'react';
import { bindAutoPromptOperation } from '../commands/subagentCommandHost.js';

export function useAutoPromptOperation(
  readProvider: Parameters<typeof bindAutoPromptOperation>[0],
  readClient: Parameters<typeof bindAutoPromptOperation>[1],
  createDetached: Parameters<typeof bindAutoPromptOperation>[2],
  readConfig: Parameters<typeof bindAutoPromptOperation>[3],
): ReturnType<typeof bindAutoPromptOperation> {
  return useMemo(
    () =>
      bindAutoPromptOperation(
        readProvider,
        readClient,
        createDetached,
        readConfig,
      ),
    [readProvider, readClient, createDetached, readConfig],
  );
}
