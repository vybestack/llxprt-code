/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config, SandboxConfig } from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-core';
import { ConsolePatcher } from '../ui/utils/ConsolePatcher.js';
import { stopProxy } from '@vybestack/llxprt-code-providers/auth.js';
import type { PortForwardingResult } from './sandbox-ssh.js';
import {
  buildSandboxEnvArgs,
  getPassthroughEnvVars,
  mountGitConfigFiles,
  isSandboxDebugModeEnabled,
  shouldAllocateSandboxTty,
} from './sandbox-env.js';
import { runSeatbeltSandbox } from './sandbox-seatbelt.js';
import { runContainerSandbox } from './sandbox-exec.js';

export {
  buildSandboxEnvArgs,
  getPassthroughEnvVars,
  mountGitConfigFiles,
  isSandboxDebugModeEnabled,
  shouldAllocateSandboxTty,
};
export {
  setupCredentialProxyPodmanMacOS,
  setupPortForwardingPodmanMacOS,
  setupSshAgentPodmanMacOS,
} from './sandbox-podman.js';
export {
  type CredentialProxyBridgeResult,
  type PortForwardingResult,
  type SshAgentResult,
  createTcpToUdsBridge,
  getPodmanMachineConnection,
  setupCredentialProxyDockerMacOS,
  setupSshAgentDockerLinux,
  setupSshAgentDockerMacOS,
  setupSshAgentForwarding,
  setupSshAgentLinux,
} from './sandbox-ssh.js';

function createSandboxConsolePatcher(cliConfig?: Config): ConsolePatcher {
  return new ConsolePatcher({
    debugMode: cliConfig?.getDebugMode() ?? !!process.env.DEBUG,
    stderr: true,
  });
}

async function handleSandboxStartError(error: unknown): Promise<never> {
  await stopProxy();
  debugLogger.error('Sandbox error:', error);
  throw error;
}

function cleanupSandboxStart(
  patcher: ConsolePatcher,
  portForwardingResult: PortForwardingResult | undefined,
  credentialProxyBridgeCleanup: (() => void) | undefined,
): void {
  portForwardingResult?.cleanup?.();
  credentialProxyBridgeCleanup?.();
  patcher.cleanup();
}

export async function start_sandbox(
  config: SandboxConfig,
  nodeArgs: string[] = [],
  cliConfig?: Config,
  cliArgs: string[] = [],
): Promise<number> {
  let credentialProxyBridgeCleanup: (() => void) | undefined;
  let portForwardingResult: PortForwardingResult | undefined;

  const patcher = createSandboxConsolePatcher(cliConfig);
  patcher.patch();

  try {
    if (config.command === 'sandbox-exec') {
      const exitCode = await runSeatbeltSandbox(
        config,
        nodeArgs,
        cliConfig,
        cliArgs,
      );
      return exitCode;
    }

    const result = await runContainerSandbox(
      config,
      nodeArgs,
      cliConfig,
      cliArgs,
    );
    portForwardingResult = result.portForwardingResult;
    credentialProxyBridgeCleanup = result.credentialProxyBridgeCleanup;
    return result.exitCode;
  } catch (error) {
    return await handleSandboxStartError(error);
  } finally {
    cleanupSandboxStart(
      patcher,
      portForwardingResult,
      credentialProxyBridgeCleanup,
    );
  }
}
