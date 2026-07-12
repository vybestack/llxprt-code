/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type * as acp from '@agentclientprotocol/sdk';
import type { Todo } from '@vybestack/llxprt-code-core';

export function buildZedPlanUpdate(todos: readonly Todo[]): acp.SessionUpdate {
  return {
    sessionUpdate: 'plan',
    entries: todos.map((todo) => ({
      content: todo.content,
      status: todo.status,
      priority: 'medium',
    })),
  };
}
