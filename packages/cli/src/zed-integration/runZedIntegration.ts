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

async function cleanupAgents(
  agents: readonly ZedAgent[],
  logger: DebugLogger,
): Promise<void> {
  const disposalResults = await Promise.allSettled(
    agents.map((agent) => agent.disposeAll()),
  );
  const rejected = disposalResults.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  for (const result of rejected) {
    logger.warn(() => `Zed agent cleanup failed: ${String(result.reason)}`);
  }
  try {
    await runExitCleanup();
  } catch (cleanupError) {
    logger.debug(() => `Exit cleanup failed: ${String(cleanupError)}`);
  }
}

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
  const agents: ZedAgent[] = [];
  try {
    const stream = acp.ndJsonStream(stdout, stdin);
    const connection = new acp.AgentSideConnection((conn) => {
      const agent = new ZedAgent(config, settings, conn);
      agents.push(agent);
      return agent;
    }, stream);
    try {
      await connection.closed;
    } finally {
      await cleanupAgents(agents, logger);
    }
  } catch (error) {
    logger.warn(() => `Zed agent connection error: ${error}`);
    await cleanupAgents(agents, logger);
    throw error;
  }
}
