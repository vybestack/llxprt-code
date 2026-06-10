/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  DiffParams,
  DiffUpdateResult,
  IDEConnectionStatus,
  IIdeService,
  OpenDiffParams,
} from '@vybestack/llxprt-code-tools';
import type { Config } from '../config/config.js';
import { IDEConnectionStatus as CoreIDEConnectionStatus } from '../ide/ide-client.js';

export class CoreIdeServiceAdapter implements IIdeService {
  constructor(private readonly config: Config) {}

  async applyDiff(params: DiffParams): Promise<DiffUpdateResult> {
    const ideClient = this.config.getIdeClient();
    if (ideClient === undefined) {
      return { status: 'rejected', content: undefined };
    }
    return ideClient.openDiff(params.filePath, params.diff);
  }

  getConnectionStatus(): IDEConnectionStatus {
    const status = this.config.getIdeClient()?.getConnectionStatus().status;
    if (status === CoreIDEConnectionStatus.Connected) {
      return 'connected';
    }
    if (status === CoreIDEConnectionStatus.Connecting) {
      return 'connecting';
    }
    return 'disconnected';
  }

  async openDiff(params: OpenDiffParams): Promise<void> {
    await this.config
      .getIdeClient()
      ?.openDiff(params.filePath, params.newContent);
  }
}
