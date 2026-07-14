/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Config, createInkStdio } from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import * as acp from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';
import { setCliRuntimeContext } from '@vybestack/llxprt-code-providers/runtime.js';
import type { LoadedSettings } from '../config/settings.js';
import { runExitCleanup } from '../utils/cleanup.js';
import { ZedAgent } from './zedIntegration.js';

export async function runZedIntegration(
  config: Config,
  settings: LoadedSettings,
): Promise<void> {
  const logger = new DebugLogger('llxprt:zed-integration');
  logger.debug(() => 'Starting Zed integration');
  const { stdout: workingStdout } = createInkStdio();
  const stdout = Writable.toWeb(workingStdout) as WritableStream;
  const stdin = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
  setCliRuntimeContext(config.getSettingsService(), config, {
    runtimeId: 'cli.runtime.zed',
    metadata: { source: 'zed-integration', stage: 'bootstrap' },
    allowDefaultHandoff: true,
  });
  let zedAgent: ZedAgent | undefined;
  try {
    const stream = acp.ndJsonStream(stdout, stdin);
    const connection = new acp.AgentSideConnection((conn) => {
      zedAgent = new ZedAgent(config, settings, conn);
      return zedAgent;
    }, stream);
    try {
      await connection.closed;
    } finally {
      await zedAgent?.disposeAll();
      await runExitCleanup();
    }
  } catch (error) {
    logger.debug(() => `ERROR: Failed to create AgentSideConnection: ${error}`);
    throw error;
  }
}
