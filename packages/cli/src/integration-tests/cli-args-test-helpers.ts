/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'child_process';
import * as path from 'path';

export type CliRunResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

// Helper to run the CLI with given arguments
export async function runCli(
  args: string[],
  env: Partial<Record<string, string>> = {},
  input?: string,
): Promise<CliRunResult> {
  const configHome =
    env.LLXPRT_CONFIG_HOME ?? process.env.LLXPRT_CONFIG_HOME ?? '';

  return new Promise((resolve) => {
    // Use the compiled CLI entry point
    const cliPath = path.join(process.cwd(), 'dist', 'index.js');

    const child = spawn('node', [cliPath, ...args], {
      env: {
        ...process.env,
        // The CI test step injects real provider credentials (OPENAI_API_KEY,
        // OPENAI_BASE_URL, LLXPRT_DEFAULT_* ...). These cases assert what the
        // CLI does with NO usable auth, so inheriting live credentials makes
        // the child take a completely different path — reaching the network
        // and hanging past the spawn guard instead of failing fast. Cleared
        // before `env` so a test can still set any of them deliberately.
        OPENAI_API_KEY: undefined,
        OPENAI_API_KEY_2: undefined,
        OPENAI_BASE_URL: undefined,
        ANTHROPIC_API_KEY: undefined,
        GEMINI_API_KEY: undefined,
        GOOGLE_API_KEY: undefined,
        LLXPRT_DEFAULT_MODEL: undefined,
        LLXPRT_DEFAULT_PROVIDER: undefined,
        LLXPRT_AUTH_TYPE: undefined,
        ...env,
        // The developer's own llxprt session exports this, pointing at a
        // session-scoped bootstrap file. The child inherits it, fails to read
        // it, and dies with "JSP bootstrap file could not be read" — which
        // looks exactly like a product failure. Spawned CLIs must not pick up
        // the host session's observation wiring.
        LLXPRT_JSP_BOOTSTRAP_FILE: undefined,
        // Disable telemetry and other features that might interfere
        LLXPRT_TELEMETRY: 'false',
        LLXPRT_CLI_NO_RELAUNCH: 'true',
        // Set HOME to temp directory to isolate profile loading
        HOME: env.HOME ?? process.env.HOME ?? '',
        // Storage resolves LLXPRT_CONFIG_HOME ahead of HOME. The child
        // inherits the parent's isolated root so profiles saved here through
        // ProfileManager are visible to the spawned CLI. Passing an empty
        // string would resolve to a bogus root and the CLI would die before
        // printing anything, so the variable is omitted when there is none.
        ...(configHome ? { LLXPRT_CONFIG_HOME: configHome } : {}),
        // Ensure providers are registered in test environment
        NODE_ENV: 'production',
        // Disable browser-based authentication for CI environments
        LLXPRT_NO_BROWSER_AUTH: 'true',
        CI: 'true',
      },
      cwd: process.cwd(),
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    if (input) {
      child.stdin.write(input);
      child.stdin.end();
    }

    // Hang guard, not an assertion. The child boots the whole CLI from
    // TypeScript source, which is slow on a cold, loaded CI runner. The
    // A 5s budget killed the child before it could produce output, and 20s
    // still expired on CI: every spawned-CLI assertion then saw exit code -1. Kept well under the
    // runner's per-file budget for integration tests so a genuine hang is
    // still reported against this timeout rather than the outer one.
    const timeout = setTimeout(() => {
      child.kill();
      resolve({
        stdout,
        stderr,
        exitCode: -1,
      });
    }, 60_000);

    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 0,
      });
    });
  });
}
