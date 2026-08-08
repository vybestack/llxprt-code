/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SandboxConfig } from '@vybestack/llxprt-code-core';
import type {
  Diagnostics,
  WorkspacePaths,
} from '@vybestack/llxprt-code-core/config/roles.js';
import { ConsolePatcher } from '../ui/utils/ConsolePatcher.js';
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

function createSandboxConsolePatcher(cliConfig?: Diagnostics): ConsolePatcher {
  return new ConsolePatcher({
    debugMode: cliConfig?.getDebugMode() ?? !!process.env.DEBUG,
    stderr: true,
  });
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * Runs the per-step credential/proxy cleanup and returns any non-idempotent
 * error, or undefined when cleanup succeeds. Used by start_sandbox so cleanup
 * errors are surfaced alongside the primary sandbox error via AggregateError.
 *
 * @plan project-plans/issue-1954-sandbox-hardening.md (AC10)
 */
function runSandboxCleanup(
  patcher: ConsolePatcher,
  portForwardingResult: PortForwardingResult | undefined,
  credentialProxyBridgeCleanup: (() => void) | undefined,
): Error | undefined {
  const errors: unknown[] = [];
  try {
    portForwardingResult?.cleanup?.();
  } catch (err) {
    errors.push(err);
  }
  try {
    credentialProxyBridgeCleanup?.();
  } catch (err) {
    errors.push(err);
  }
  try {
    patcher.cleanup();
  } catch (err) {
    errors.push(err);
  }
  if (errors.length === 1) return toError(errors[0]);
  if (errors.length > 1) {
    return new AggregateError(errors, 'Sandbox cleanup failed');
  }
  return undefined;
}

export async function start_sandbox(
  config: SandboxConfig,
  nodeArgs: string[] = [],
  cliConfig?: Diagnostics & WorkspacePaths,
  cliArgs: string[] = [],
): Promise<number> {
  let credentialProxyBridgeCleanup: (() => void) | undefined;
  let portForwardingResult: PortForwardingResult | undefined;

  const patcher = createSandboxConsolePatcher(cliConfig);
  patcher.patch();

  let primaryError: unknown;
  let exitCode: number | undefined;
  try {
    if (config.command === 'sandbox-exec') {
      exitCode = await runSeatbeltSandbox(config, nodeArgs, cliConfig, cliArgs);
    } else {
      const result = await runContainerSandbox(
        config,
        nodeArgs,
        cliConfig,
        cliArgs,
      );
      portForwardingResult = result.portForwardingResult;
      credentialProxyBridgeCleanup = result.credentialProxyBridgeCleanup;
      exitCode = result.exitCode;
    }
  } catch (error) {
    primaryError = error;
  }

  // AC10: attempt every cleanup step, then surface both the primary sandbox
  // error and any non-idempotent credential cleanup failure via AggregateError
  // so neither is swallowed.
  const cleanupFailure = runSandboxCleanup(
    patcher,
    portForwardingResult,
    credentialProxyBridgeCleanup,
  );
  if (primaryError !== undefined && cleanupFailure !== undefined) {
    throw new AggregateError(
      [toError(primaryError), cleanupFailure],
      'Sandbox failed and cleanup also failed',
    );
  }
  if (primaryError !== undefined) {
    throw primaryError;
  }
  if (cleanupFailure !== undefined) {
    throw cleanupFailure;
  }
  return exitCode as number;
}
