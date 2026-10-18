/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IdeClient,
  IdeContext,
} from '@vybestack/llxprt-code-ide-integration';
import type { WorkspaceIdeConnection } from '@vybestack/llxprt-code-core/services/workspace-ide-owner.js';
import type { IdeInfo, IdeStatus, Unsubscribe } from './agent.js';

export interface AgentIdeControl {
  readConnection(): WorkspaceIdeConnection;
  readContext(): IdeContext | undefined;
  subscribeContext(
    listener: (context: IdeContext | undefined) => void,
  ): Unsubscribe;
  readWorkspaceTrust(): boolean | undefined;
  subscribeWorkspaceTrust(
    listener: (trusted: boolean | undefined) => void,
  ): Unsubscribe;
  subscribeConnection(
    listener: (connection: WorkspaceIdeConnection) => void,
  ): Unsubscribe;
  resolveDiff(
    filePath: string,
    outcome: 'accepted' | 'rejected',
  ): Promise<void>;
  isTrustedFolder(): boolean;
  getIdeTrust(): boolean | undefined;
  setTrustedFolderLive(trusted: boolean): Promise<void>;
  whenTrustTransitionSettled(): Promise<void>;
  getIdeClient(): IdeClient | undefined;
  getIdeMode(): boolean;
  setIdeMode(enabled: boolean): void;
  setIdeClientConnected(): Promise<void>;
  setIdeClientDisconnected(): Promise<void>;
  current(): IdeInfo | null;
  detected(): readonly IdeInfo[];
  trust(name: string): Promise<void>;
  status(): IdeStatus;
  openEditor(): Promise<void>;
  closeEditor(): Promise<void>;
}
