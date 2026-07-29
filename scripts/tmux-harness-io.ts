/**
 * tmux I/O primitives extracted from scripts/tmux-harness.ts.
 *
 * These functions wrap the low-level tmux command invocations (run/try tmux),
 * screen/scrollback capture, pane-dead polling, and the higher-level
 * waitFor/waitForNot pollers. They depend only on node:child_process, node:fs,
 * node:path, and the pure helpers in tmux-harness-helpers.ts.
 *
 * scripts/tmux-harness.ts imports and re-exports these to preserve its public
 * API.
 *
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  spawnSync,
  type SpawnSyncReturns,
  type StdioOptions,
  type SpawnSyncOptions,
} from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  matchText,
  formatMatcher,
  sanitizeLabel,
  type CompiledMatcher,
} from './tmux-harness-helpers.ts';

/**
 * Tmux client environment variables that, when inherited, can cause harness
 * tmux commands to attach to and mutate an outer tmux server that llxprt is
 * running inside. These must always be scrubbed from the subprocess env.
 */
export const TMUX_ENV_KEYS = ['TMUX', 'TMUX_PANE', 'TMUX_TMPDIR'];

/**
 * Lazily-created private tmux socket path. Using -S with a socket inside a
 * unique temp directory guarantees concurrent harness runs each get their own
 * tmux server and can never collide with or attach to an outer server.
 *
 * The temp directory and socket path are created on first access rather than
 * at module load so that importing this module has no filesystem side effect
 * and cannot crash on import. The created directory can later be cleaned up
 * via {@link cleanupTmuxSocketDir}.
 */
let tmuxSocketPath: string | null = null;
let tmuxSocketDir: fsSync.PathLike | null = null;

export function getTmuxSocketPath(): string {
  if (tmuxSocketPath === null) {
    tmuxSocketDir = fsSync.mkdtempSync(
      path.join(os.tmpdir(), 'llxprt-tmux-harness-'),
    );
    tmuxSocketPath = path.join(tmuxSocketDir, 'tmux.sock');
  }
  return tmuxSocketPath;
}

function killedOrMissingTmuxServer(
  result: SpawnSyncReturns<string | Buffer>,
): boolean {
  if (result.status === 0) {
    return true;
  }
  if (result.status === null) {
    return false;
  }
  const stderr = (result.stderr ?? '').toString();
  return stderr.includes('no server running');
}

/**
 * Remove the lazily-created tmux socket temp directory, if one was created.
 * After successful cleanup, subsequent calls are no-ops. Ambiguous kill-server
 * failures preserve the socket directory and cached paths so callers can retry
 * cleanup without orphaning a live server by deleting its only socket.
 * Callers that intentionally keep the tmux session/server alive
 * (e.g. --keep-session) must NOT call this, as the socket path is required to
 * access the kept server.
 */
export function cleanupTmuxSocketDir(): void {
  if (tmuxSocketDir === null) {
    return;
  }
  if (tmuxSocketPath !== null) {
    try {
      const killResult = spawnSync(
        'tmux',
        ['-S', tmuxSocketPath, 'kill-server'],
        buildTmuxOptions(),
      );
      if (killResult.error || !killedOrMissingTmuxServer(killResult)) {
        return;
      }
    } catch {
      return;
    }
  }
  try {
    fsSync.rmSync(tmuxSocketDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup; keep cached paths so callers can retry later.
    return;
  }
  tmuxSocketDir = null;
  tmuxSocketPath = null;
}

/**
 * Build the tmux argument vector with the dedicated private socket flag
 * prepended. Does not mutate the input, but may lazily create the private
 * socket directory on first call.
 *
 * @param {string[]} args - caller-supplied tmux arguments
 * @returns {string[]} full argument vector beginning with the socket flag
 */
export function buildTmuxSocketArgs(args: string[]): string[] {
  return ['-S', getTmuxSocketPath(), ...args];
}

interface TmuxSpawnOptions {
  env?: Record<string, string | undefined>;
  encoding?: string;
  stdio?: StdioOptions;
  cwd?: string;
  timeout?: number;
}

/**
 * Build the spawn options for tmux, scrubbing inherited tmux client env vars
 * so commands cannot attach to an outer tmux server. Caller-provided env
 * entries (other than tmux keys) and other spawn options are preserved.
 * Encoding is always forced to utf8 because downstream screen and matcher logic
 * expects string output.
 */
function buildTmuxOptions(options: TmuxSpawnOptions = {}): SpawnSyncOptions {
  const { env: callerEnv, encoding: _ignoredEncoding, ...rest } = options;
  const env = { ...process.env, ...(callerEnv ?? {}) };
  for (const key of TMUX_ENV_KEYS) {
    delete env[key];
  }
  // Force utf8 so callers cannot accidentally switch to Buffer output, which
  // would break all downstream string-based screen/matcher logic.
  return { ...rest, encoding: 'utf8', env };
}

export function runTmux(
  args: string[],
  options: TmuxSpawnOptions = {},
): string {
  const fullArgs = buildTmuxSocketArgs(args);
  const spawnOptions = buildTmuxOptions(options);
  const result = spawnSync('tmux', fullArgs, spawnOptions);

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').toString().trim();
    const message = stderr.length > 0 ? stderr : 'tmux command failed';
    const err = Object.assign(
      new Error(`${message}: tmux ${fullArgs.join(' ')}`),
      { code: result.status ?? 1 },
    );
    throw err;
  }

  return (result.stdout ?? '').toString();
}

export function tryTmux(args: string[]): string | null {
  try {
    return runTmux(args);
  } catch {
    return null;
  }
}

export async function sleep(ms: number | undefined): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function isPrimaryPaneDead(sessionName: string): boolean {
  try {
    const out = runTmux([
      'list-panes',
      '-t',
      `${sessionName}:0`,
      '-F',
      '#{pane_dead}',
    ]).trim();
    const first = out.split('\n')[0]?.trim();
    return first === '1';
  } catch {
    return false;
  }
}

export async function waitForPaneDead(sessionName: string, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isPrimaryPaneDead(sessionName)) {
      return true;
    }
    await sleep(200);
  }
  return false;
}

export function getHistorySize(sessionName: string): number {
  const out = runTmux([
    'display-message',
    '-p',
    '-t',
    `${sessionName}:0.0`,
    '#{history_size}',
  ]).trim();
  const n = Number(out);
  return Number.isFinite(n) ? n : 0;
}

export function captureScreen(sessionName: string): string {
  const screen = runTmux(['capture-pane', '-p', '-t', sessionName]);
  if (screen.trim().length > 0) {
    return screen;
  }

  try {
    const alternateScreen = runTmux([
      'capture-pane',
      '-a',
      '-p',
      '-t',
      sessionName,
    ]);
    return alternateScreen.trim().length > 0 ? alternateScreen : screen;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('no alternate screen')) {
      throw error;
    }
    return screen;
  }
}

export function captureScrollback(
  sessionName: string,
  scrollbackLines: number,
): string {
  return runTmux([
    'capture-pane',
    '-p',
    '-t',
    sessionName,
    '-S',
    `-${scrollbackLines}`,
  ]);
}

export function readPaneOutputFallback(outDir: string | undefined): string {
  if (typeof outDir !== 'string' || outDir.length === 0) {
    return '';
  }

  const paneOutputPath = path.join(outDir, 'pane-output.log');
  try {
    return fsSync.readFileSync(paneOutputPath, 'utf8');
  } catch (error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return '';
    }
    throw error;
  }
}

export function captureScreenWithFallback(
  sessionName: string,
  outDir: string | undefined,
): string {
  const screen = captureScreen(sessionName);
  if (screen.trim().length > 0) {
    return screen;
  }

  const paneOutput = readPaneOutputFallback(outDir);
  return paneOutput.trim().length > 0 ? paneOutput : screen;
}

interface ResolveCapturedTextParams {
  sessionName: string;
  scope: string;
  scrollbackLines: number;
  outDir?: string;
  allowPaneOutputFallback?: boolean;
}

export function resolveCapturedText({
  sessionName,
  scope,
  scrollbackLines,
  outDir,
  allowPaneOutputFallback = true,
}: ResolveCapturedTextParams): string {
  if (scope === 'scrollback') {
    const scrollback = captureScrollback(sessionName, scrollbackLines);
    if (!allowPaneOutputFallback || scrollback.trim().length > 0) {
      return scrollback;
    }

    const paneOutput = readPaneOutputFallback(outDir);
    return paneOutput.trim().length > 0 ? paneOutput : scrollback;
  }

  return allowPaneOutputFallback
    ? captureScreenWithFallback(sessionName, outDir)
    : captureScreen(sessionName);
}

interface CaptureArtifactsParams {
  sessionName: string;
  outDir: string;
  label: string;
  scrollbackLines: number;
}

export async function captureArtifacts({
  sessionName,
  outDir,
  label,
  scrollbackLines,
}: CaptureArtifactsParams): Promise<void> {
  const safe = sanitizeLabel(label);
  const screen = captureScreen(sessionName);
  const scrollback = captureScrollback(sessionName, scrollbackLines);
  await fs.writeFile(path.join(outDir, `${safe}-screen.txt`), screen, 'utf8');
  await fs.writeFile(
    path.join(outDir, `${safe}-scrollback.txt`),
    scrollback,
    'utf8',
  );
}

interface WaitForParams {
  sessionName: string;
  scope: string;
  matcher: CompiledMatcher;
  timeoutMs: number;
  pollMs: number;
  scrollbackLines: number;
  description?: string;
  outDir?: string;
}

export async function waitFor({
  sessionName,
  scope,
  matcher,
  timeoutMs,
  pollMs,
  scrollbackLines,
  description,
  outDir,
}: WaitForParams): Promise<void> {
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    const text = resolveCapturedText({
      sessionName,
      scope,
      scrollbackLines,
      outDir,
    });
    if (matchText(text, matcher)) {
      return;
    }
    await sleep(pollMs);
  }
  throw new Error(
    `Timed out waiting for ${description ?? formatMatcher(matcher)} in ${scope} after ${timeoutMs}ms`,
  );
}

export async function waitForNot({
  sessionName,
  scope,
  matcher,
  timeoutMs,
  pollMs,
  scrollbackLines,
  description,
  outDir,
}: WaitForParams): Promise<void> {
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    const text = resolveCapturedText({
      sessionName,
      scope,
      scrollbackLines,
      outDir,
      allowPaneOutputFallback: false,
    });
    if (!matchText(text, matcher)) {
      return;
    }
    await sleep(pollMs);
  }
  throw new Error(
    `Timed out waiting for absence of ${description ?? formatMatcher(matcher)} in ${scope} after ${timeoutMs}ms`,
  );
}

export function isShellModeActive(sessionName: string): boolean {
  const screen = captureScreen(sessionName);
  return screen.includes('shell mode enabled');
}

interface StepDefaults {
  scrollbackLines: number;
}

export function resolveScopeAndScrollback(
  step: { scope?: string; scrollbackLines?: number },
  defaults: StepDefaults,
): { scope: string; scrollbackLines: number } {
  const scope = step.scope === 'scrollback' ? 'scrollback' : 'screen';
  const scrollbackLines = Number(
    step.scrollbackLines ?? defaults.scrollbackLines,
  );
  return { scope, scrollbackLines };
}
