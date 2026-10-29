/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type * as acp from '@agentclientprotocol/sdk';
import {
  type DebugLogger,
  resolveAcquisitionBudgetFromSetting,
} from '@vybestack/llxprt-code-core';
import { TerminalManager } from './zed-terminal-manager.js';

export function createZedTerminalTransport(
  sessionId: string,
  connection: acp.AgentSideConnection,
  targetDir: string,
  logger: DebugLogger,
  retentionSetting: unknown,
): TerminalManager {
  return new TerminalManager(
    sessionId,
    connection,
    targetDir,
    (update) => connection.sessionUpdate({ sessionId, update }),
    logger,
    resolveAcquisitionBudgetFromSetting(retentionSetting),
  );
}
