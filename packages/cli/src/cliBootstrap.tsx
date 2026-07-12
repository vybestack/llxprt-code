/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { parseArguments } from './config/cliArgParser.js';
import { parseBootstrapArgs } from './config/profileBootstrap.js';
import { coerceDebugFlag } from './config/yargsOptions.js';
import {
  dynamicSettingsRegistry,
  generateDynamicToolSettings,
} from './utils/dynamicSettings.js';
import type { SettingDefinition } from './config/settingsSchema.js';
import { readStdin } from './utils/readStdin.js';
import { shouldRelaunchForMemory, isDebugMode } from './utils/bootstrap.js';
import { relaunchAppInChildProcess } from './utils/relaunch.js';
import type { DnsResolutionOrder, LoadedSettings } from './config/settings.js';
import {
  FatalConfigError,
  ExitCodes,
  writeToStderr,
  writeToStdout,
  type Config,
} from '@vybestack/llxprt-code-core';
import {
  debugLogger,
  ConfigurationManager,
  DebugLogger,
} from '@vybestack/llxprt-code-telemetry';
import { runExitCleanup } from './utils/cleanup.js';
import { getCliVersion } from './utils/version.js';

export function validateDnsResolutionOrder(
  order: string | undefined,
): DnsResolutionOrder {
  const defaultValue: DnsResolutionOrder = 'ipv4first';
  if (order === undefined) {
    return defaultValue;
  }
  if (order === 'ipv4first' || order === 'verbatim') {
    return order;
  }
  debugLogger.warn(
    `Invalid value for dnsResolutionOrder in settings: "${order}". Using default "${defaultValue}".`,
  );
  return defaultValue;
}

export function configureEarlyDebugLogging(): void {
  const bootstrapParsed = parseBootstrapArgs();
  const debugArg = coerceDebugFlag(
    bootstrapParsed.bootstrapArgs.debug ?? undefined,
  );
  const isDebugEnabled = debugArg === true || typeof debugArg === 'string';
  if (!isDebugEnabled) {
    return;
  }
  const namespaces = typeof debugArg === 'string' ? debugArg : 'llxprt:*';
  ConfigurationManager.getInstance().setCliConfig({
    enabled: true,
    namespaces: namespaces
      .split(',')
      .map((ns) => ns.trim())
      .filter((ns) => ns.length > 0),
  });
}

export async function handleVersionAndHelpFlags(
  rawArgs: string[],
): Promise<void> {
  if (rawArgs.includes('--version') || rawArgs.includes('-v')) {
    writeToStdout(`${await getCliVersion()}
`);
    process.exit(0);
  }
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    await parseArguments({});
    process.exit(0);
  }
}

export type ParsedCliArgs = Awaited<ReturnType<typeof parseArguments>>;

/** Throw a FatalConfigError if any settings files failed to load/parse. */
export function throwIfSettingsErrors(settings: LoadedSettings): void {
  if (settings.errors.length === 0) {
    return;
  }
  const errorMessages = settings.errors.map(
    (error) => `Error in ${error.path}: ${error.message}`,
  );
  throw new FatalConfigError(
    `${errorMessages.join('\n')}\nPlease fix the configuration file(s) and try again.`,
  );
}

export function redirectConsoleForAcp(argv: ParsedCliArgs): void {
  if (argv.experimentalAcp === true) {
    globalThis.console.log = globalThis.console.error;
    globalThis.console.info = globalThis.console.error;
    globalThis.console.debug = globalThis.console.error;
  }
}

export async function maybeRelaunchForMemory(
  settings: LoadedSettings,
): Promise<void> {
  if (
    settings.merged.ui.autoConfigureMaxOldSpaceSize !== true ||
    process.env.SANDBOX
  ) {
    return;
  }
  const debugMode = isDebugMode();
  const maxHeapSizeMB = settings.merged.ui.maxHeapSizeMB;
  const memoryArgs = shouldRelaunchForMemory(debugMode, maxHeapSizeMB);
  if (memoryArgs.length > 0) {
    const exitCode = await relaunchAppInChildProcess(memoryArgs);
    process.exit(exitCode);
  }
}

/** Register per-tool dynamic settings once Config is fully initialized. */
export function registerDynamicToolSettings(config: Config): void {
  try {
    const dynamicToolSettings = generateDynamicToolSettings(config);
    const fullDynamicSettings: Record<string, SettingDefinition> = {};
    for (const [toolName, definition] of Object.entries(dynamicToolSettings)) {
      fullDynamicSettings[`coreToolSettings.${toolName}`] = definition;
    }
    dynamicSettingsRegistry.register(fullDynamicSettings);
    const logger = new DebugLogger('llxprt:gemini');
    logger.log(
      `Registered ${Object.keys(fullDynamicSettings).length} dynamic settings`,
    );
  } catch (error) {
    debugLogger.error('[gemini] Failed to register dynamic settings:', error);
  }
}

export async function rejectPromptInteractiveWithPipedStdin(
  argv: ParsedCliArgs,
): Promise<void> {
  if (argv.promptInteractive && !process.stdin.isTTY) {
    writeToStderr(
      'Error: The --prompt-interactive flag cannot be used when input is piped from stdin.\n',
    );
    await runExitCleanup();
    process.exit(ExitCodes.FATAL_INPUT_ERROR);
  }
}

export function createMemoizedStdinReader(): () => Promise<string> {
  let cachedStdinData: string | null = null;
  let stdinWasRead = false;
  return async () => {
    if (!stdinWasRead) {
      stdinWasRead = true;
      cachedStdinData = await readStdin();
    }
    return cachedStdinData ?? '';
  };
}

export async function ensureStdinOrPromptProvided(
  hasPipedInput: boolean,
  readStdinData: () => Promise<string>,
  questionFromArgs: string,
): Promise<void> {
  if (!hasPipedInput) {
    return;
  }
  const stdinSnapshot = await readStdinData();
  if (!stdinSnapshot && !questionFromArgs) {
    writeToStderr(
      `No input provided via stdin. Input can be provided by piping data into llxprt or using the --prompt option.
`,
    );
    process.exit(1);
  }
}
