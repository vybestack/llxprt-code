/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #3839, plan test 6: `--list-sessions` / `--delete-session` stop main()
 * after the Config is built (the one source of the recordings' location) and
 * before terminal setup, provider configuration/activation, the unconfigured
 * provider guard, the sandbox hop, agent construction or recording start. The
 * steps main() would otherwise run next are replaced by sentinels that record
 * being reached; the real argument parser, settings loader, Config bootstrap
 * and session listing run against a real temp project.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  vi,
} from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// In-process main() imports the whole CLI and builds a real Config.
const MAIN_TIMEOUT_MS = 30_000;

// Captured before any mock.module call so the real bootstrap is what the
// recording sentinel spreads over.
const actualSessionBootstrap = await import('./cliSessionBootstrap.js');

const reachedSteps: string[] = [];

function registerDownstreamSentinels(): void {
  void mock.module('./cliProviderInit.js', () => ({
    activateConfiguredProvider: async () => {
      reachedSteps.push('provider-activation');
      return { authFailed: false, token: undefined, intent: undefined };
    },
    configureProvidersAndServices: async () => {
      reachedSteps.push('provider-configuration');
      return {};
    },
    connectIdeClientIfEnabled: async () => {
      reachedSteps.push('ide-connect');
    },
    ensureAcpProviderActivated: () => {
      reachedSteps.push('acp-activation');
    },
  }));
  void mock.module('./cliTerminalSession.js', () => ({
    constructAgentWithSpinner: async () => {
      reachedSteps.push('agent-construction');
      return {};
    },
    prepareTerminalSession: async () => {
      reachedSteps.push('terminal-session');
    },
  }));
  void mock.module('./cliSandbox.js', () => ({
    maybeHopIntoSandbox: async () => {
      reachedSteps.push('sandbox-hop');
    },
  }));
  void mock.module('./unconfiguredProviderGuard.js', () => ({
    guardUnconfiguredProvider: async () => {
      reachedSteps.push('unconfigured-provider-guard');
    },
    UNCONFIGURED_PROVIDER_MESSAGE: '',
  }));
  // Config bootstrap stays real: the handler needs the Config. Only the
  // recording step, which must stay unreached, is replaced.
  void mock.module('./cliSessionBootstrap.js', () => ({
    ...actualSessionBootstrap,
    setupSessionRecording: async () => {
      reachedSteps.push('recording-start');
    },
  }));
  void mock.module('./session/nonInteractiveSession.js', () => ({
    dispatchInteractiveOrNonInteractive: async () => {
      reachedSteps.push('dispatch');
    },
  }));
}

describe('main() with --list-sessions / --delete-session (issue #3839)', () => {
  let projectDir: string;
  let originalCwd: string;
  let originalArgv: string[];
  let originalIsTTY: boolean | undefined;

  beforeEach(async () => {
    reachedSteps.length = 0;
    originalCwd = process.cwd();
    originalArgv = process.argv;
    originalIsTTY = process.stdin.isTTY;
    projectDir = await realpath(
      await mkdtemp(join(tmpdir(), 'cli-main-list-sessions-3839-')),
    );
    process.chdir(projectDir);
    // The reported scenario: no TTY, nothing piped, no prompt.
    Object.defineProperty(process.stdin, 'isTTY', {
      value: false,
      writable: true,
      configurable: true,
    });
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    registerDownstreamSentinels();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.argv = originalArgv;
    process.chdir(originalCwd);
    Object.defineProperty(process.stdin, 'isTTY', {
      value: originalIsTTY,
      writable: true,
      configurable: true,
    });
    await rm(projectDir, { recursive: true, force: true });
  });

  async function runMain(...cliArgs: string[]): Promise<unknown> {
    process.argv = ['bun', 'llxprt', ...cliArgs];
    const { main } = await import('./cli.js');
    return main().then(
      () => 'returned',
      (error: unknown) => (error instanceof Error ? error.message : error),
    );
  }

  it(
    '--list-sessions exits 0 before terminal setup, provider configuration or activation, sandbox hop, agent construction or recording (plan test 6)',
    async () => {
      const outcome = await runMain('--list-sessions');

      expect({ outcome, reachedSteps }).toStrictEqual({
        outcome: 'process.exit(0)',
        reachedSteps: [],
      });
    },
    MAIN_TIMEOUT_MS,
  );

  it(
    '--delete-session with an unknown reference exits 1 before any of those steps even when a prompt is supplied (plan test 6)',
    async () => {
      const outcome = await runMain(
        '--delete-session',
        'no-such-session',
        '--prompt',
        'ignored',
      );

      expect({ outcome, reachedSteps }).toStrictEqual({
        outcome: 'process.exit(1)',
        reachedSteps: [],
      });
    },
    MAIN_TIMEOUT_MS,
  );
});
