/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ToolSelection } from '@vybestack/llxprt-code-tools';

export class ClientToolSelection {
  private selection: ToolSelection | undefined;

  readonly bindToolSelection = (selection: ToolSelection): void =>
    this.bind(selection);

  get tools(): ToolSelection {
    return this.read();
  }

  bind(selection: ToolSelection): void {
    if (this.selection !== undefined && this.selection !== selection)
      throw new Error('Session client tooling is already bound');
    this.selection = selection;
  }

  read(): ToolSelection {
    if (this.selection === undefined)
      throw new Error('Missing explicit session tool selection');
    return this.selection;
  }
}

import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderManager.js';

export function assertSessionClientProvider(
  expected: RuntimeProviderManager | undefined,
  supplied: RuntimeProviderManager,
): void {
  if (expected !== supplied)
    throw new Error('Session client belongs to a different ProviderManager');
}

export function assertSessionClientConfig(
  expected: Config,
  supplied: Config,
): void {
  if (expected !== supplied)
    throw new Error('Session client belongs to a different Config');
}

export function assertClientRuntimeState(state: {
  readonly provider?: string;
  readonly model?: string;
}): void {
  if (state.provider === undefined || state.provider === '')
    throw new Error('AgentRuntimeState must have a valid provider');
  if (state.model === undefined || state.model === '')
    throw new Error('AgentRuntimeState must have a valid model');
}
