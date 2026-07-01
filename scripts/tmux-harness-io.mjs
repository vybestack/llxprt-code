/**
 * tmux I/O primitives extracted from scripts/tmux-harness.js.
 *
 * These functions wrap the low-level tmux command invocations (run/try tmux),
 * screen/scrollback capture, pane-dead polling, and the higher-level
 * waitFor/waitForNot pollers. They depend only on node:child_process, node:fs,
 * node:path, and the pure helpers in tmux-harness-helpers.mjs.
 *
 * scripts/tmux-harness.js imports and re-exports these to preserve its public
 * API.
 *
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  matchText,
  formatMatcher,
  sanitizeLabel,
} from './tmux-harness-helpers.mjs';

export function runTmux(args, options = {}) {
  const result = spawnSync('tmux', args, {
    encoding: 'utf8',
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').toString().trim();
    const message = stderr.length > 0 ? stderr : 'tmux command failed';
    const err = new Error(`${message}: tmux ${args.join(' ')}`);
    err.code = result.status;
    throw err;
  }

  return (result.stdout ?? '').toString();
}

export function tryTmux(args) {
  try {
    return runTmux(args);
  } catch {
    return null;
  }
}

export async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function isPrimaryPaneDead(sessionName) {
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

export async function waitForPaneDead(sessionName, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isPrimaryPaneDead(sessionName)) {
      return true;
    }
    await sleep(200);
  }
  return false;
}

export function getHistorySize(sessionName) {
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

export function captureScreen(sessionName) {
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

export function captureScrollback(sessionName, scrollbackLines) {
  return runTmux([
    'capture-pane',
    '-p',
    '-t',
    sessionName,
    '-S',
    `-${scrollbackLines}`,
  ]);
}

export function readPaneOutputFallback(outDir) {
  if (typeof outDir !== 'string' || outDir.length === 0) {
    return '';
  }

  const paneOutputPath = path.join(outDir, 'pane-output.log');
  try {
    return fsSync.readFileSync(paneOutputPath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

export function captureScreenWithFallback(sessionName, outDir) {
  const screen = captureScreen(sessionName);
  if (screen.trim().length > 0) {
    return screen;
  }

  const paneOutput = readPaneOutputFallback(outDir);
  return paneOutput.trim().length > 0 ? paneOutput : screen;
}

export function resolveCapturedText({
  sessionName,
  scope,
  scrollbackLines,
  outDir,
  allowPaneOutputFallback = true,
}) {
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

export async function captureArtifacts({
  sessionName,
  outDir,
  label,
  scrollbackLines,
}) {
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

export async function waitFor({
  sessionName,
  scope,
  matcher,
  timeoutMs,
  pollMs,
  scrollbackLines,
  description,
  outDir,
}) {
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
}) {
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

export function isShellModeActive(sessionName) {
  const screen = captureScreen(sessionName);
  return screen.includes('shell mode enabled');
}

export function resolveScopeAndScrollback(step, defaults) {
  const scope = step.scope === 'scrollback' ? 'scrollback' : 'screen';
  const scrollbackLines = Number(
    step.scrollbackLines ?? defaults.scrollbackLines,
  );
  return { scope, scrollbackLines };
}
