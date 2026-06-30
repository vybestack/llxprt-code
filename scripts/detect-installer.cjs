#!/usr/bin/env node

/**
 * Shared installer detection for lifecycle scripts (preinstall/postinstall).
 *
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env node */

/**
 * Detects which package manager invoked the current lifecycle script.
 *
 * Lifecycle scripts run under `node`, so `process.versions.bun` is not set even
 * when Bun drives the install. The reliable signal is `npm_config_user_agent`,
 * which Bun sets to `bun/<version> ...` and npm sets to `npm/<version> ...`.
 *
 * The default is `'npm'` for npm and any other/unknown manager (e.g. pnpm,
 * Yarn) so the pre-existing npm lifecycle behavior is preserved unchanged. S1
 * only special-cases Bun.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env] Environment to read the user
 *   agent from. Injectable so the behavior can be unit-tested without mutating
 *   the real process environment.
 * @returns {'bun' | 'npm'} The detected installer.
 */
function detectInstaller(env = process.env) {
  const userAgent = env.npm_config_user_agent || '';
  // Bun emits a lowercase `bun/<version>` prefix with no leading whitespace, so
  // a strict `startsWith('bun/')` already matches every real Bun install. Trim
  // leading whitespace and lower-case before the prefix check purely as
  // defensive hardening: it tolerates an incidentally re-cased or space-padded
  // user agent (e.g. from a wrapper) without widening detection to any other
  // manager — npm/pnpm/Yarn all use distinct, non-`bun` prefixes, so they still
  // fall through to the npm default below.
  if (userAgent.trimStart().toLowerCase().startsWith('bun/')) {
    return 'bun';
  }
  return 'npm';
}

module.exports = { detectInstaller };
