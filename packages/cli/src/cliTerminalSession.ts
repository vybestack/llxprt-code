/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { writeFileSync } from 'node:fs';
import {
  type Config,
  type MessageBus,
  OutputFormat,
  uiTelemetryService,
  debugLogger,
} from '@vybestack/llxprt-code-core';
import { ConsolePatcher } from './ui/utils/ConsolePatcher.js';
import { setupTerminalAndTheme } from './utils/terminalTheme.js';
import { drainStdinBuffer } from './ui/utils/terminalContract.js';
import { StdinRawModeManager } from './utils/stdinSafety.js';
import { registerCleanup, runExitCleanup } from './utils/cleanup.js';
import { appEvents, AppEvent } from './utils/events.js';
import type { LoadedSettings } from './config/settings.js';
import type { ParsedCliArgs } from './cliBootstrap.js';
import { registerDynamicToolSettings } from './cliBootstrap.js';

/**
 * Initialize Config, showing an MCP initialization spinner when interactive and
 * MCP servers are configured. Registers dynamic tool settings afterwards.
 */
async function renderInitializingSpinner(initialTotal: number): Promise<
  | {
      clear(): void;
      unmount(): void;
    }
  | undefined
> {
  try {
    const [reactModule, inkModule, spinnerModule, colorsModule] =
      await Promise.all([
        import('react'),
        import('ink'),
        import('ink-spinner'),
        import('./ui/colors.js'),
      ]);
    const React = reactModule.default;
    const { Box, Text, render } = inkModule;
    const Spinner = spinnerModule.default;
    const { theme } = colorsModule;

    const InitializingComponent = () => {
      const [total, setTotal] = React.useState(initialTotal);
      const [connected, setConnected] = React.useState(0);

      React.useEffect(() => {
        const onStart = ({ count }: { count: number }) => setTotal(count);
        const onChange = () => {
          setConnected((val) => val + 1);
        };

        appEvents.on(AppEvent.McpServersDiscoveryStart, onStart);
        appEvents.on(AppEvent.McpServerConnected, onChange);
        appEvents.on(AppEvent.McpServerError, onChange);

        return () => {
          appEvents.off(AppEvent.McpServersDiscoveryStart, onStart);
          appEvents.off(AppEvent.McpServerConnected, onChange);
          appEvents.off(AppEvent.McpServerError, onChange);
        };
      }, []);

      const message = `Connecting to MCP servers... (${connected}/${total})`;

      return React.createElement(
        Box,
        null,
        React.createElement(
          Text,
          { color: theme.text.primary },
          React.createElement(Spinner),
          ' ',
          message,
        ),
      );
    };

    return render(React.createElement(InitializingComponent));
  } catch (error) {
    debugLogger.warn('MCP initialization spinner unavailable', error);
    return undefined;
  }
}

export async function initializeConfigWithSpinner(
  config: Config,
  sessionMessageBus: MessageBus,
): Promise<void> {
  const mcpServers = config.getMcpServers();
  const mcpServersCount = mcpServers ? Object.keys(mcpServers).length : 0;

  const showSpinner =
    typeof config.isInteractive === 'function' &&
    config.isInteractive() &&
    mcpServersCount > 0;
  const spinnerInstance = showSpinner
    ? await renderInitializingSpinner(mcpServersCount)
    : undefined;

  try {
    await (
      config as typeof config & {
        initialize(dependencies?: { messageBus?: MessageBus }): Promise<void>;
      }
    ).initialize({ messageBus: sessionMessageBus });
  } finally {
    if (spinnerInstance) {
      await new Promise((f) => setTimeout(f, 100));
      spinnerInstance.clear();
      spinnerInstance.unmount();
    }
  }

  registerDynamicToolSettings(config);
}

/** Register a cleanup hook that writes session metrics to --session-summary. */
function registerSessionSummaryWriter(argv: ParsedCliArgs): void {
  const summaryPath = argv.sessionSummary;
  if (!summaryPath) {
    return;
  }
  registerCleanup(() => {
    const metrics = uiTelemetryService.getMetrics();
    writeFileSync(
      summaryPath,
      JSON.stringify({ sessionMetrics: metrics }, null, 2),
    );
  });
}

/** Install the console patcher for this run and register its cleanup. */
function patchConsoleForRun(config: Config): void {
  const isJsonNonInteractive =
    config.getOutputFormat() === OutputFormat.JSON && !config.isInteractive();
  const consolePatcher = new ConsolePatcher({
    stderr: !isJsonNonInteractive,
    debugMode: isJsonNonInteractive ? false : config.getDebugMode(),
  });
  consolePatcher.patch();
  registerCleanup(consolePatcher.cleanup);
}

/**
 * Prepare the interactive terminal session: enable raw mode when needed, set up
 * the terminal title/theme, register the session-summary writer, and patch the
 * console for the run.
 */
export async function prepareTerminalSession(
  config: Config,
  settings: LoadedSettings,
  argv: ParsedCliArgs,
): Promise<void> {
  const wasRaw = process.stdin.isRaw;
  const stdinManager = new StdinRawModeManager({
    debug: config.getDebugMode(),
  });
  await enableInteractiveRawModeIfNeeded(config, stdinManager, wasRaw);

  await setupTerminalAndTheme(config, settings);

  registerSessionSummaryWriter(argv);
  patchConsoleForRun(config);
}

export async function enableInteractiveRawModeIfNeeded(
  config: Config,
  stdinManager: StdinRawModeManager,
  wasRaw: boolean,
): Promise<void> {
  if (!(config.isInteractive() && !wasRaw && process.stdin.isTTY)) {
    return;
  }
  await drainStdinBuffer(process.stdin, 50);

  stdinManager.enable();

  process.on('SIGTERM', () => {
    stdinManager.disable(true);
    void (async () => {
      await runExitCleanup();
      process.exit(0);
    })();
  });
  process.on('SIGINT', () => {
    stdinManager.disable(true);
    void (async () => {
      await runExitCleanup();
      process.exit(130);
    })();
  });

  registerCleanup(() => {
    stdinManager.disable(true);
  });
}
