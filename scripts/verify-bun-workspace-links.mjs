#!/usr/bin/env node

/**
 * Verifies that the active package manager linked every DECLARED local
 * workspace package into node_modules as a link back to its in-repo source.
 *
 * This is the executable form of the S1 acceptance criterion exercised by the
 * `bun_install_smoke` CI job. It is committed (rather than inlined in the
 * workflow) so the exact same check can be reproduced locally after an install:
 *
 *   bun install && node scripts/verify-bun-workspace-links.mjs
 *
 * It is intentionally package-manager agnostic: it only inspects the on-disk
 * node_modules layout, so it validates npm and Bun installs alike. Exits 0 on
 * success and 1 (with a precise diagnostic) on the first class of failure.
 *
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * Parses the root manifest once, runs every workspace-link check, and returns
 * both the failure list and the count of declared workspaces. Keeping the parse
 * in a single place lets the CLI report a success count without re-reading
 * package.json.
 *
 * @returns {{ failures: string[], workspaceCount: number }}
 */
function collectWorkspaceLinkResults() {
  // The authoritative set verified here is every workspace DECLARED in
  // package.json's `workspaces` array (an explicit list of paths, no globs).
  // Each declared workspace must be locally linked by the package manager.
  //
  // A malformed or unreadable root package.json must surface through this
  // function's failure-list contract (return diagnostics -> exit 1), not as an
  // unhandled SyntaxError/ENOENT that crashes with a raw stack trace.
  let root;
  try {
    root = JSON.parse(readFileSync('package.json', 'utf8'));
  } catch (err) {
    return {
      failures: [
        'Failed to read or parse package.json: ' +
          (err instanceof Error ? err.message : String(err)),
      ],
      workspaceCount: 0,
    };
  }
  const workspaces = root.workspaces ?? [];

  // Guard against a vacuous pass: if `workspaces` is missing, not an array, or
  // empty, the loop below would run zero iterations and the check would succeed
  // without verifying anything. Treat that as a hard failure — this monorepo
  // always declares a non-empty workspace list.
  if (!Array.isArray(workspaces) || workspaces.length === 0) {
    return {
      failures: [
        'package.json must declare a non-empty `workspaces` array; ' +
          `found ${JSON.stringify(workspaces)}. The workspace link check has ` +
          'nothing to verify, which would let it pass vacuously.',
      ],
      workspaceCount: 0,
    };
  }

  // This check assumes each workspace entry is a concrete directory path: it
  // joins `${ws}/package.json` and realpath-resolves `resolve(ws)`. A glob
  // pattern (e.g. `packages/*`) would silently misbehave —
  // `packages/*/package.json` does not exist, so the entry would be mislabeled
  // as "no package.json on disk" rather than the real cause. Fail fast with an
  // explicit, accurate message if a glob ever appears, so a future
  // workspace-layout change is caught here instead of producing a misleading
  // link-check error.
  const globbed = workspaces.filter((ws) =>
    typeof ws === 'string' ? /[*?[\]{}!()]/.test(ws) : true,
  );
  if (globbed.length > 0) {
    return {
      failures: [
        'package.json `workspaces` must list concrete directory paths, not ' +
          `glob patterns; found ${JSON.stringify(globbed)}. This workspace ` +
          'link check resolves each entry as a literal workspace directory ' +
          'and cannot expand globs.',
      ],
      workspaceCount: workspaces.length,
    };
  }

  const results = workspaces.map((ws) => classifyWorkspaceLink(ws));
  return summarizeLinkResults(results, workspaces.length);
}

/**
 * Classifies a single declared workspace entry against the on-disk
 * node_modules layout. Returns a result object describing the outcome category
 * (one of "linked", "missingPkgJson", "malformed", "missing", "notLinked") plus
 * a human-readable detail. Extracted from the verifier loop so each entry is
 * checked in isolation without multiple break/continue statements.
 *
 * @param {string} ws - A workspace directory path declared in package.json.
 * @returns {{ category: string, detail: string }}
 */
function classifyWorkspaceLink(ws) {
  const wpkgPath = `${ws}/package.json`;
  if (!existsSync(wpkgPath)) {
    return { category: 'missingPkgJson', detail: ws };
  }
  // Parsing a workspace package.json, and realpath-resolving the node_modules
  // entry/workspace directory, can throw (corrupt JSON, broken symlink,
  // ELOOP). Funnel those into the diagnostic list so the verifier keeps its
  // "collect failures -> exit 1" contract instead of throwing mid-loop.
  let wpkg;
  try {
    wpkg = JSON.parse(readFileSync(wpkgPath, 'utf8'));
  } catch (err) {
    return {
      category: 'malformed',
      detail: `${ws}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const entry = `node_modules/${wpkg.name}`;
  if (!existsSync(entry)) {
    return { category: 'missing', detail: `${ws} (${wpkg.name})` };
  }
  let actual;
  let expected;
  try {
    actual = realpathSync(entry);
    expected = realpathSync(resolve(ws));
  } catch (err) {
    return {
      category: 'notLinked',
      detail:
        `${ws} (${wpkg.name}): could not resolve the node_modules link ` +
        `(${err instanceof Error ? err.message : String(err)})`,
    };
  }
  if (actual !== expected) {
    return {
      category: 'notLinked',
      detail:
        `${ws} (${wpkg.name}): node_modules entry resolves to ${actual}, ` +
        `expected the local workspace at ${expected}`,
    };
  }
  return { category: 'linked', detail: ws };
}

/**
 * Aggregates per-workspace classification results into the final failure list.
 * Returns the combined diagnostics plus the workspace count, applying the
 * defence-in-depth linked-count check.
 *
 * @param {{ category: string, detail: string }[]} results
 * @param {number} workspaceCount
 * @returns {{ failures: string[], workspaceCount: number }}
 */
function summarizeLinkResults(results, workspaceCount) {
  const grouped = {
    missingPkgJson: [],
    missing: [],
    notLinkedLocally: [],
    malformed: [],
  };
  let linked = 0;
  for (const result of results) {
    switch (result.category) {
      case 'linked':
        linked++;
        break;
      case 'missingPkgJson':
        grouped.missingPkgJson.push(result.detail);
        break;
      case 'missing':
        grouped.missing.push(result.detail);
        break;
      case 'notLinked':
        grouped.notLinkedLocally.push(result.detail);
        break;
      case 'malformed':
        grouped.malformed.push(result.detail);
        break;
    }
  }

  const failures = [];
  if (grouped.missingPkgJson.length > 0) {
    failures.push(
      'Declared workspace(s) have no package.json on disk: ' +
        grouped.missingPkgJson.join(', '),
    );
  }
  if (grouped.missing.length > 0) {
    failures.push(
      'Package manager produced no node_modules entry for workspace(s): ' +
        grouped.missing.join(', '),
    );
  }
  if (grouped.notLinkedLocally.length > 0) {
    failures.push(
      'Package manager did not link the LOCAL workspace for:\n  - ' +
        grouped.notLinkedLocally.join('\n  - '),
    );
  }
  if (grouped.malformed.length > 0) {
    failures.push(
      'Could not parse package.json for declared workspace(s):\n  - ' +
        grouped.malformed.join('\n  - '),
    );
  }
  // Defence in depth: even if no per-workspace failure was recorded, the count
  // of locally-linked workspaces must equal the number declared. This catches
  // any silent gap between iteration and verification.
  if (failures.length === 0 && linked !== workspaceCount) {
    failures.push(
      `Linked ${linked} workspace(s) but ${workspaceCount} are declared; ` +
        'counts must match.',
    );
  }

  return { failures, workspaceCount };
}

/**
 * Runs the workspace-link verification against the repository rooted at the
 * current working directory.
 *
 * @returns {string[]} A list of human-readable failure messages. Empty when
 *   every declared workspace is locally linked.
 */
export function verifyBunWorkspaceLinks() {
  return collectWorkspaceLinkResults().failures;
}

/**
 * CLI entry point: runs the verification, prints a precise diagnostic, and sets
 * the process exit code. Kept separate from {@link verifyBunWorkspaceLinks} so
 * the pure check can be unit-tested without spawning a process.
 */
function main() {
  const { failures, workspaceCount } = collectWorkspaceLinkResults();
  if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
    return;
  }

  console.log(
    `Verified all ${workspaceCount} declared workspace package(s) link to ` +
      'their in-repo source.',
  );
}

// Only run as a CLI when invoked directly (e.g. `node scripts/verify-bun-
// workspace-links.mjs`), so importing `verifyBunWorkspaceLinks` for unit tests
// does not trigger a filesystem check or set the process exit code.
if (argv[1] && resolve(argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
