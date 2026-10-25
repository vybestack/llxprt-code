/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SubAgentScope,
  type SubAgentLaunchInput,
  type SubAgentOperationPorts,
  type SubAgentRuntimeInput,
} from '../../subagent.js';

export type SubAgentLaunchTestInput = Omit<
  SubAgentLaunchInput,
  'parentSignal'
> & { readonly parentSignal?: AbortSignal };

export function createSubagentScope(
  launch: SubAgentLaunchTestInput,
  runtime: SubAgentRuntimeInput,
  operations: SubAgentOperationPorts,
): Promise<SubAgentScope> {
  return SubAgentScope.create(
    { parentSignal: undefined, ...launch },
    runtime,
    operations,
  );
}
