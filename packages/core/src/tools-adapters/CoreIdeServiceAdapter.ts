/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  DiffParams,
  DiffUpdateResult,
  IDEConnectionStatus,
  IIdeService,
  OpenDiffParams,
} from '@vybestack/llxprt-code-tools';
import type { WorkspaceIdePort } from '../services/workspace-ide-owner.js';
import { IDEConnectionStatus as CoreIDEConnectionStatus } from '@vybestack/llxprt-code-ide-integration';

export class CoreIdeServiceAdapter implements IIdeService {
  constructor(
    private readonly openWorkspaceDiff:
      | WorkspaceIdePort['openDiff']
      | undefined,
    private readonly readConnection:
      | WorkspaceIdePort['readConnection']
      | undefined,
  ) {}

  async applyDiff(params: DiffParams): Promise<DiffUpdateResult> {
    if (
      this.openWorkspaceDiff === undefined ||
      this.readConnection?.().available !== true
    ) {
      return { status: 'rejected', content: undefined };
    }
    return this.openWorkspaceDiff(params.filePath, params.diff);
  }

  getConnectionStatus(): IDEConnectionStatus {
    const status = this.readConnection?.().status;
    if (status === CoreIDEConnectionStatus.Connected) {
      return 'connected';
    }
    if (status === CoreIDEConnectionStatus.Connecting) {
      return 'connecting';
    }
    return 'disconnected';
  }

  async openDiff(params: OpenDiffParams): Promise<void> {
    if (
      this.openWorkspaceDiff === undefined ||
      this.readConnection?.().available !== true
    ) {
      throw new Error('IDE client is not available');
    }
    await this.openWorkspaceDiff(params.filePath, params.newContent);
  }
}
