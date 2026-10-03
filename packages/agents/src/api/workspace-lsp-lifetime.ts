/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  LspConfig,
  LspServiceClient,
} from '@vybestack/llxprt-code-ide-integration';
import {
  initializeLsp,
  shutdownLsp,
  type LspHost,
  type LspState,
  type WorkspaceLspPort,
} from '@vybestack/llxprt-code-core/config/lspIntegration.js';

export class WorkspaceLspLifetime implements WorkspaceLspPort {
  private readonly state: LspState;
  private startup: Promise<void> | undefined;
  private disposal: Promise<void> | undefined;

  constructor(
    config: LspConfig | undefined,
    private readonly host: LspHost,
  ) {
    this.state = { lspConfig: config };
  }

  async start(): Promise<void> {
    if (this.startup !== undefined || this.disposal !== undefined) {
      throw new Error(
        'Workspace LSP lifetime cannot start twice or after disposal',
      );
    }
    this.startup = initializeLsp(this.state, this.host);
    await this.startup;
  }

  config(): LspConfig | undefined {
    return this.state.lspConfig;
  }

  client(): LspServiceClient | undefined {
    return this.state.lspServiceClient;
  }

  dispose(): Promise<void> {
    this.disposal ??= (async () => {
      if (this.startup === undefined) return;
      await this.startup;
      await shutdownLsp(this.state, this.host.getToolRegistry());
    })();
    return this.disposal;
  }
}
