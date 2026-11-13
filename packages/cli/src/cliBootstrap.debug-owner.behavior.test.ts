/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import {
  DebugLogger,
  ConfigurationManager,
} from '@vybestack/llxprt-code-telemetry';
import { configureCliDebugLogging } from './cliBootstrap.js';
import { createDebugCommand } from './ui/commands/debugCommands.js';
import { bindDebugCommand } from './ui/commands/debugCommandHost.js';
import { createMockCommandContext } from './__tests__/mockCommandContext.js';

const originalArgv = process.argv;

describe('CLI process debug configuration owner', () => {
  afterEach(async () => {
    process.argv = originalArgv;
    await DebugLogger.resetForTesting();
  });

  it('enables package loggers from --debug and updates them through /debug', async () => {
    process.argv = [
      ...process.argv.slice(0, 2),
      '--debug=llxprt:core:provider',
    ];
    configureCliDebugLogging();

    const providerLogger = new DebugLogger('llxprt:core:provider');
    expect(providerLogger.enabled).toBe(true);

    const command = createDebugCommand(
      bindDebugCommand(ConfigurationManager.getInstance()),
    );
    const enable = command.subCommands?.find(
      (entry) => entry.name === 'enable',
    )?.action;
    if (!enable) throw new Error('Missing debug enable action');
    await enable(createMockCommandContext(), 'llxprt:core:runtime');

    expect(new DebugLogger('llxprt:core:runtime').enabled).toBe(true);
  });
});
