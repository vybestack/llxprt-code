/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);
const CLI_ENTRY = join(REPO_ROOT, 'packages', 'cli', 'index.ts');

const AUTH_KEY_NAME = 'issue2916-ghost-key';
const PROMPT = 'issue-2916-trap-guard-prompt';
// Output the local trap would return if a regression ever contacted a
// provider. Distinct from PROMPT so its absence proves no model output.
const TRAP_MODEL_OUTPUT = 'ISSUE_2916_TRAP_MODEL_OUTPUT_SUCCESS';
// Deterministic lower-precedence credential inputs. None must ever be used:
// the unresolved named key must fail before provider invocation, proven by a
// trap request count of exactly zero.
const ENV_PROVIDER_KEY = 'issue2916-env-provider-secret';
const INLINE_AUTH_KEY = 'issue2916-inline-fallback-secret';
const KEYFILE_SECRET = 'issue2916-keyfile-fallback-secret';

/** Grace period allowed for a SIGTERM to land before escalating to SIGKILL. */
const SIGKILL_GRACE_MS = 5_000;

/**
 * Minimal runtime shapes of the `Bun` APIs this subprocess test uses. Defined
 * locally because the CLI TypeScript config loads `bun-types/test` (the
 * `bun:test` module) but NOT the global `Bun` namespace, so the bare global
 * `Bun.*` symbols are unavailable to the type-checker. We reach the real,
 * runtime `Bun` through `globalThis` — the same approach used by
 * `packages/cli/src/observation/jspBootstrapStartup.test.ts`.
 */
interface CliSubprocessLike {
  readonly pid: number;
  readonly stdout: ReadableStream<Uint8Array> | null;
  readonly stderr: ReadableStream<Uint8Array> | null;
  readonly exited: Promise<number>;
  kill(signal?: 'SIGKILL' | 'SIGTERM'): void;
}

interface CliTrapServerLike {
  readonly port: number;
  stop(): void;
}

interface CliBunRuntimeLike {
  spawn(options: {
    cmd: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
    stdout: 'pipe';
    stderr: 'pipe';
  }): CliSubprocessLike;
  sleep(ms: number): Promise<void>;
  serve(options: {
    port: number;
    hostname: string;
    fetch(request: Request): Response | Promise<Response>;
  }): CliTrapServerLike;
}

function getCliBunRuntime(): CliBunRuntimeLike {
  const bun = (globalThis as { Bun?: unknown }).Bun;
  if (bun === undefined) {
    throw new Error(
      'Bun global is unavailable; issue-2916 CLI tests must run under bun:test',
    );
  }
  return bun as CliBunRuntimeLike;
}

const bunRuntime = getCliBunRuntime();

// Essential executable/platform variables, copied individually (never spread
// from process.env) so no ambient keyring, proxy, provider credential,
// dotenv/config path, or unrelated LLXPRT_* variable leaks into the child.
const PLATFORM_ENV_KEYS = [
  'PATH',
  'USER',
  'SHELL',
  'LANG',
  'LC_ALL',
  'TMPDIR',
  'TERM',
] as const;

interface CliRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Runs the CLI as an isolated subprocess, draining stdout/stderr immediately
 * and racing process exit against a timeout. On timeout only the tracked
 * child PID is terminated (never a broad process-group kill); exit and both
 * stream drains are always awaited before returning.
 */
async function runCli(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  timeoutMs: number,
): Promise<CliRunResult> {
  const proc = bunRuntime.spawn({
    cmd: [process.execPath, CLI_ENTRY, ...args],
    cwd,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  // Drain both streams immediately so a full pipe buffer cannot deadlock the
  // child before it exits.
  const stdoutDone = new Response(proc.stdout).text();
  const stderrDone = new Response(proc.stderr).text();

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<boolean>((resolveTimeout) => {
    timeoutHandle = setTimeout(() => resolveTimeout(true), timeoutMs);
  });

  let exitCode: number | null = null;
  let timedOut = false;
  let unreapable = false;
  try {
    const outcome = await Promise.race([
      proc.exited.then<number | null>((code) => code),
      timeoutPromise.then<number | null>(() => null),
    ]);
    if (outcome === null) {
      timedOut = true;
    } else {
      exitCode = outcome;
    }
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
    if (timedOut) {
      try {
        proc.kill();
      } catch {
        // The child exited between the timeout firing and termination.
      }
      // A child that ignores SIGTERM would leave `proc.exited` pending
      // forever, and awaiting it here outlives the enclosing test timeout —
      // the run would hang rather than fail. Escalate to SIGKILL, which
      // cannot be caught, after a short grace period.
      const reaped = await Promise.race([
        proc.exited.then(() => true),
        bunRuntime.sleep(SIGKILL_GRACE_MS).then(() => false),
      ]);
      if (!reaped) {
        try {
          proc.kill('SIGKILL');
        } catch {
          // The child exited during the grace period.
        }
        // Bound this wait too. SIGKILL cannot be caught, but a process stuck
        // in an uninterruptible wait still will not be reaped, and an
        // unbounded await here would hang the runner rather than fail it.
        const killed = await Promise.race([
          proc.exited.then(() => true),
          bunRuntime.sleep(SIGKILL_GRACE_MS).then(() => false),
        ]);
        // Recorded rather than thrown here: a throw inside finally would
        // discard whatever exception was already propagating.
        unreapable = !killed;
      }
    }
  }

  if (unreapable) {
    throw new Error(
      `CLI subprocess (pid ${proc.pid}) survived SIGKILL and could not be reaped.`,
    );
  }

  const [stdout, stderr] = await Promise.all([stdoutDone, stderrDone]);
  return { exitCode, stdout, stderr, timedOut };
}

describe('issue #2916 CLI subprocess: unresolved auth-key-name fails fast', () => {
  let tempRoot: string | null = null;
  let trapServer: CliTrapServerLike | null = null;

  afterEach(() => {
    if (trapServer !== null) {
      trapServer.stop();
      trapServer = null;
    }
    if (tempRoot !== null) {
      rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('exits non-zero with an actionable named-key error and never contacts a provider', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'llxprt-cli-2916-'));
    const configHome = join(tempRoot, 'config');
    const dataHome = join(tempRoot, 'data');
    const cacheHome = join(tempRoot, 'cache');
    const logHome = join(tempRoot, 'log');
    const fakeHome = join(tempRoot, 'home');
    const workspaceCwd = join(tempRoot, 'workspace');
    for (const dir of [
      configHome,
      dataHome,
      cacheHome,
      logHome,
      fakeHome,
      workspaceCwd,
    ]) {
      mkdirSync(dir, { recursive: true });
    }

    // A unique, request-counting local HTTP trap configured as the profile
    // base-url. If profile application ever fell through to provider
    // invocation (a regression), the provider would POST here and increment
    // the counter. The assertion that the count is exactly zero proves the
    // unresolved named key fails before any provider call — and that no
    // external OpenAI endpoint is ever contacted.
    const trap = { requestCount: 0 };
    trapServer = bunRuntime.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch() {
        trap.requestCount += 1;
        return new Response(
          JSON.stringify({
            id: 'chatcmpl-issue2916-trap',
            object: 'chat.completion',
            created: 1,
            model: 'issue2916-trap-model',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: TRAP_MODEL_OUTPUT },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
              total_tokens: 2,
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      },
    });
    const trapBaseUrl = `http://127.0.0.1:${trapServer.port}/v1`;

    const keyfilePath = join(tempRoot, 'lower-precedence.key');
    writeFileSync(keyfilePath, `${KEYFILE_SECRET}\n`);

    mkdirSync(join(configHome, 'profiles'), { recursive: true });
    writeFileSync(
      join(configHome, 'profiles', 'issue2916.json'),
      JSON.stringify(
        {
          version: 1,
          provider: 'openai',
          model: 'gpt-4o-mini',
          modelParams: {},
          ephemeralSettings: {
            'auth-key-name': AUTH_KEY_NAME,
            'base-url': trapBaseUrl,
            'auth-key': INLINE_AUTH_KEY,
            'auth-keyfile': keyfilePath,
          },
        },
        null,
        2,
      ),
    );

    const env: NodeJS.ProcessEnv = {};
    for (const key of PLATFORM_ENV_KEYS) {
      const value = process.env[key];
      if (value !== undefined) {
        env[key] = value;
      }
    }
    env.HOME = fakeHome;
    env.LLXPRT_CONFIG_HOME = configHome;
    env.LLXPRT_DATA_HOME = dataHome;
    env.LLXPRT_CACHE_HOME = cacheHome;
    env.LLXPRT_LOG_HOME = logHome;
    env.LLXPRT_TEST_DISABLE_OS_KEYRING = '1';
    // Point system settings/defaults at controlled nonexistent paths so the
    // child never reads developer system configuration.
    env.LLXPRT_SYSTEM_SETTINGS_PATH = join(
      tempRoot,
      'nonexistent-system-settings.json',
    );
    env.LLXPRT_SYSTEM_DEFAULTS_PATH = join(
      tempRoot,
      'nonexistent-system-defaults.json',
    );
    env.CI = 'true';
    env.NO_BROWSER = 'true';
    env.LLXPRT_NO_BROWSER_AUTH = 'true';
    // Deterministic lower-precedence environment credential input. Proven
    // unused by the trap request count of zero below.
    env.OPENAI_API_KEY = ENV_PROVIDER_KEY;

    const { exitCode, stdout, stderr, timedOut } = await runCli(
      [
        '--profile-load',
        'issue2916',
        '--prompt',
        PROMPT,
        '--yolo',
        '--ide-mode',
        'disable',
      ],
      env,
      workspaceCwd,
      45_000,
    );

    expect(timedOut).toBe(false);
    const combined = `${stdout}\n${stderr}`;

    expect(exitCode).not.toBe(0);
    expect(exitCode).not.toBeNull();
    expect(combined).toContain(AUTH_KEY_NAME);
    expect(combined).toContain('/key save');
    // The trap was never contacted: the provider was never invoked.
    expect(trap.requestCount).toBe(0);
    // No model output reached the caller.
    expect(combined).not.toContain(TRAP_MODEL_OUTPUT);
    // No lower-precedence credential leaked into the error output.
    expect(combined).not.toContain(ENV_PROVIDER_KEY);
    expect(combined).not.toContain(INLINE_AUTH_KEY);
    expect(combined).not.toContain(KEYFILE_SECRET);
  }, 90_000);
});
