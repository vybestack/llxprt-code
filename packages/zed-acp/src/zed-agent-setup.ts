/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import type { Config } from '@vybestack/llxprt-code-core';
import type { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import type * as acp from '@agentclientprotocol/sdk';
import { AcpFileSystemService } from './fileSystemService.js';
import {
  createSessionScopedConfig,
  resolveSessionTargetDir,
} from './zed-session-config.js';
import { buildZedTerminalSetup } from './zed-terminal-setup.js';
import type { TerminalManager } from './zed-terminal-manager.js';
import type { ClientCapabilitiesWithSession } from './acp-types.js';

export async function buildZedSessionAgent(
  config: Config,
  connection: acp.AgentSideConnection,
  logger: DebugLogger,
  capabilities: ClientCapabilitiesWithSession | undefined,
  sessionId: string,
  cwd: string | undefined,
): Promise<{
  agent: Agent;
  config: Config;
  terminals: TerminalManager | null;
}> {
  const baseFileSystemService = config.getFileSystemService();
  const sessionFileSystemService = capabilities?.fs
    ? new AcpFileSystemService(
        connection,
        sessionId,
        capabilities.fs,
        baseFileSystemService,
      )
    : baseFileSystemService;
  let terminalSetup: ReturnType<typeof buildZedTerminalSetup> | undefined;
  let sessionRegistry: ToolRegistry | undefined;
  const sessionConfig = createSessionScopedConfig(
    config,
    sessionFileSystemService,
    resolveSessionTargetDir(config, cwd),
    () => sessionRegistry,
  );
  let agent: Agent | undefined;
  try {
    agent = await fromConfig({ config: sessionConfig, sessionId });
    if (capabilities?.terminal === true) {
      terminalSetup = buildZedTerminalSetup(
        sessionId,
        sessionConfig,
        agent.getToolRegistry(),
        connection,
        logger,
        agent.getMessageBus(),
        agent.tasks.shellJobs(),
      );
      const terminalShell = terminalSetup.registry.getTool('run_shell_command');
      if (terminalShell !== undefined) {
        agent.getToolRegistry().unregisterTool(terminalShell.name);
        agent.getToolRegistry().registerTool(terminalShell);
      }
    }
    sessionRegistry = agent.getToolRegistry();
  } catch (error) {
    await agent?.dispose().catch(() => undefined);
    await terminalSetup?.terminals.settleAll().catch(() => undefined);
    throw error;
  }
  return {
    agent,
    config: sessionConfig,
    terminals: terminalSetup?.terminals ?? null,
  };
}

export async function enableZedSessionRecording(
  agent: Agent,
  onFailure: (error: unknown) => void,
): Promise<void> {
  try {
    await agent.session.setRecording({ enabled: true });
  } catch (error) {
    try {
      onFailure(error);
    } catch {
      // Recording remains best-effort even when failure notification fails.
    }
  }
}

export async function buildZedSession<T>(
  agent: Agent,
  build: () => T | Promise<T>,
  onDisposeFailure: (error: unknown) => void,
): Promise<T> {
  try {
    return await build();
  } catch (error) {
    try {
      await agent.dispose();
    } catch (disposeError) {
      try {
        onDisposeFailure(disposeError);
      } catch {
        // Preserve the original session build failure.
      }
    }
    throw error;
  }
}
