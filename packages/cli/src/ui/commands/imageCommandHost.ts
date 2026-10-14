/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Agent } from '@vybestack/llxprt-code-agents';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import type { ImageCommandOperations } from './imageCommand.js';

export function bindImageCommand(
  config: CliUiRuntime | null,
  agent: Agent | null,
  addItem: UseHistoryManagerReturn['addItem'],
): ImageCommandOperations {
  return {
    workspaceRoot: config?.getTargetDir(),
    runImageOperation:
      agent === null
        ? undefined
        : (request) => agent.sessionClient.runImageOperation(request),
    addItem,
  };
}
