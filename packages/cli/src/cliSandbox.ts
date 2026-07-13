/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Config, ExitCodes } from '@vybestack/llxprt-code-core';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { loadCliConfig } from './config/config.js';
import { start_sandbox } from './utils/sandbox.js';
import {
  computeSandboxMemoryArgs,
  parseDockerMemoryToMB,
} from './utils/bootstrap.js';
import { runExitCleanup } from './utils/cleanup.js';
import { sessionId } from '@vybestack/llxprt-code-telemetry';
import { ExtensionStorage } from './config/extension.js';
import { ExtensionEnablementManager } from './config/extensions/extensionEnablement.js';
import type { LoadedSettings } from './config/settings.js';
import type { ParsedCliArgs } from './cliBootstrap.js';

/**
 * Resolve the container memory (in MB) requested via sandbox-related env vars.
 * Preserves the historical empty-string-is-absent behavior.
 */
export function resolveContainerMemoryMB(): number | undefined {
  const containerMemoryStr =
    process.env.LLXPRT_SANDBOX_MEMORY ?? process.env.SANDBOX_MEMORY;
  if (typeof containerMemoryStr === 'string' && containerMemoryStr.length > 0) {
    return parseDockerMemoryToMB(containerMemoryStr);
  }
  const sandboxFlags = process.env.SANDBOX_FLAGS;
  if (typeof sandboxFlags === 'string' && sandboxFlags.length > 0) {
    const eqMatch = sandboxFlags.match(/(?:^|\s)--memory=(\S+)/);
    const spMatch = sandboxFlags.match(/(?:^|\s)--memory\s+(\S+)/);
    const memoryValue = eqMatch?.[1] ?? spMatch?.[1];
    if (memoryValue !== undefined) {
      return parseDockerMemoryToMB(memoryValue);
    }
  }
  return undefined;
}

/**
 * Compute the memory args to pass when relaunching into the sandbox.
 * Always returns args (the sandbox starts fresh with Node's default heap),
 * unlike the host-relaunch heuristic at the top of main().
 */
export function computeSandboxMemoryArgsFromEnv(
  config: Config,
  settings: LoadedSettings,
): string[] {
  if (settings.merged.ui.autoConfigureMaxOldSpaceSize !== true) {
    return [];
  }
  return computeSandboxMemoryArgs(
    config.getDebugMode(),
    resolveContainerMemoryMB(),
    settings.merged.ui.maxHeapSizeMB,
  );
}

/**
 * Locate the first positional argument (one not consumed as a flag value),
 * scanning from index 2 (after `node` and the script path). Returns -1 when
 * there are no positional arguments.
 */
export function findFirstPositionalArgIndex(args: string[]): number {
  let i = 2;
  while (i < args.length) {
    const arg = args[i];
    if (!arg.startsWith('-')) {
      return i;
    }
    // This heuristic assumes any token starting with '-' is a flag, not a
    // value. It works for the current CLI flag set but would need updating
    // if flags accepting dash-prefixed values (e.g. negative numbers) are
    // added.
    const consumesNextValue =
      !arg.includes('=') &&
      Boolean(args[i + 1]) &&
      !args[i + 1].startsWith('-');
    i += consumesNextValue ? 2 : 1;
  }
  return -1;
}

/**
 * Inject stdin data into args for the sandbox by prepending it to the existing
 * prompt (positional or --prompt flag). Avoids the "Cannot use both positional
 * and --prompt" conflict.
 */
export function injectStdinIntoArgs(
  args: string[],
  stdinData?: string,
): string[] {
  if (!stdinData) {
    return [...args];
  }

  const finalArgs = [...args];

  const promptFlagIndex = finalArgs.findIndex(
    (arg) => arg === '--prompt' || arg === '-p',
  );
  if (promptFlagIndex > -1 && finalArgs.length > promptFlagIndex + 1) {
    finalArgs[promptFlagIndex + 1] = `${stdinData}

${finalArgs[promptFlagIndex + 1]}`;
    return finalArgs;
  }

  const positionalStartIndex = findFirstPositionalArgIndex(finalArgs);
  if (positionalStartIndex > -1) {
    finalArgs[positionalStartIndex] = `${stdinData}

${finalArgs[positionalStartIndex]}`;
    return finalArgs;
  }

  finalArgs.push(stdinData);
  return finalArgs;
}

export interface SandboxHopOptions {
  config: Config;
  settings: LoadedSettings;
  argv: ParsedCliArgs;
  workspaceRoot: string;
  runtimeSettingsService: SettingsService;
  initialAuthFailed: boolean;
  readStdin: () => Promise<string>;
  hasPipedInput: boolean;
}

/**
 * When running outside the sandbox and sandboxing is configured, relaunch the
 * CLI inside the sandbox (forwarding stdin/prompt). Exits the current process
 * when a hop occurs; returns otherwise so startup can continue in-process.
 */
export async function maybeHopIntoSandbox(
  options: SandboxHopOptions,
): Promise<void> {
  const {
    config,
    settings,
    argv,
    workspaceRoot,
    runtimeSettingsService,
    initialAuthFailed,
    readStdin: readStdinData,
    hasPipedInput,
  } = options;

  if (process.env.SANDBOX) {
    return;
  }
  const sandboxConfig = config.getSandbox();
  if (!sandboxConfig) {
    return;
  }
  if (initialAuthFailed) {
    await runExitCleanup();
    process.exit(ExitCodes.FATAL_AUTHENTICATION_ERROR);
  }

  const sandboxMemoryArgs = computeSandboxMemoryArgsFromEnv(config, settings);
  const partialConfig = await loadCliConfig(
    settings.merged,
    [],
    new ExtensionEnablementManager(ExtensionStorage.getUserExtensionsDir()),
    sessionId,
    argv,
    workspaceRoot,
    { settingsService: runtimeSettingsService },
  );

  const stdinData = hasPipedInput ? await readStdinData() : '';
  const sandboxArgs = injectStdinIntoArgs(process.argv, stdinData);

  const exitCode = await start_sandbox(
    sandboxConfig,
    sandboxMemoryArgs,
    partialConfig,
    sandboxArgs,
  );
  process.exit(exitCode);
}
