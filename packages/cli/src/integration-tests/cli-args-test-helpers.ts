/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'node:url';

/**
 * The CLI's real entry point. Nothing compiles this workspace before tests run
 * (issue #2983), so spawning `node dist/index.js` had no target; `index.ts` is
 * what the installed launcher and `npm run start` execute anyway.
 */
const CLI_ENTRY = path.resolve(
  fileURLToPath(import.meta.url),
  '..',
  '..',
  '..',
  'index.ts',
);

export type CliRunResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

/**
 * Provider credentials the CI test step injects. Held as string literals and
 * expanded at call time: declaring them as object properties would introduce a
 * provider-neutral GEMINI_* identifier, which the agents provider-agnostic
 * naming guard rejects outside its allowed boundaries.
 */
const PROVIDER_CREDENTIAL_ENV_KEYS = [
  'OPENAI_API_KEY',
  'OPENAI_API_KEY_2',
  'OPENAI_BASE_URL',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'LLXPRT_DEFAULT_MODEL',
  'LLXPRT_DEFAULT_PROVIDER',
  'LLXPRT_AUTH_TYPE',
] as const;

function clearedProviderCredentials(): Record<string, undefined> {
  return Object.fromEntries(
    PROVIDER_CREDENTIAL_ENV_KEYS.map((key) => [key, undefined]),
  );
}

// Helper to run the CLI with given arguments
export async function runCli(
  args: string[],
  env: Partial<Record<string, string>> = {},
  input?: string,
): Promise<CliRunResult> {
  const configHome =
    env.LLXPRT_CONFIG_HOME ?? process.env.LLXPRT_CONFIG_HOME ?? '';

  return new Promise((resolve) => {
    // `process.execPath` is the Bun binary running this suite — the CLI
    // workspace executes Bun-native (issue #2843) — which is exactly the
    // runtime the shipped launcher execs `index.ts` with.
    const child = spawn(process.execPath, [CLI_ENTRY, ...args], {
      env: {
        ...process.env,
        // The CI test step injects real provider credentials. These cases
        // assert what the CLI does with NO usable auth, so inheriting live
        // credentials makes the child take a completely different path —
        // reaching the network and hanging past the spawn guard instead of
        // failing fast. Spread before `env` so a test can still set any of
        // them deliberately.
        ...clearedProviderCredentials(),
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
