#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Config boundary guard (issue #2615, P04).
 *
 * Enforces the eventual rule "no production file outside packages/core imports
 * the Config type" (REQ-001) and "no service-locator accessor appears on a role
 * interface" (REQ-004) using the TypeScript compiler API WITH a type checker —
 * not text/regex. Receivers are resolved by type, so deps-property forwarding
 * (`this.deps.config.x`), unannotated locals, aliased imports and
 * optional-chaining accesses are all caught without the three failure modes of
 * the older syntactic tools (scripts/config-contract.ts et al.).
 *
 * Wired into `npm run lint` in REPORT-ONLY mode: it always prints findings and
 * exits 0 so the migration phases can watch the count fall without breaking the
 * build. The `--enforce` flag flips violations to exit 1 (used only once the
 * migration completes, in a later phase).
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runBoundary } from './config-boundary/run.js';
import { formatReport } from './config-boundary/report.js';
import {
  EXIT_OK,
  EXIT_ENFORCE,
  EXIT_FAIL_CLOSED,
} from './config-boundary/types.js';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(SCRIPT_DIR, '..');

interface ParsedArgs {
  readonly root: string;
  readonly enforce: boolean;
}

/** Parses CLI arguments. Supports --root <dir> and --enforce. */
function parseArgs(argv: readonly string[]): ParsedArgs {
  let root = DEFAULT_ROOT;
  let enforce = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--enforce') {
      enforce = true;
    } else if (arg === '--root') {
      const next = argv[i + 1];
      if (typeof next === 'string') {
        root = next;
        i++;
      }
    } else if (arg?.startsWith('--root=')) {
      root = arg.slice('--root='.length);
    }
  }
  return { root, enforce };
}

/** Maps a result to the process exit code. */
function exitCodeFor(result: {
  readonly parseErrors: readonly unknown[];
  readonly enforce: boolean;
  readonly findings: readonly unknown[];
  readonly roleViolations: readonly unknown[];
}): number {
  if (result.parseErrors.length > 0) return EXIT_FAIL_CLOSED;
  if (!result.enforce) return EXIT_OK;
  if (result.findings.length > 0 || result.roleViolations.length > 0) {
    return EXIT_ENFORCE;
  }
  return EXIT_OK;
}

function main(): void {
  const { root, enforce } = parseArgs(process.argv.slice(2));
  const result = runBoundary(root, enforce);
  const output = formatReport(result);
  console.log(output);
  process.exit(exitCodeFor(result));
}

main();
