#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * check-gemini-containment.ts — permanent structural Gemini-containment gate
 * (issue #2628, lands after #2763).
 *
 * Since #2763 the Gemini provider implementation lives exclusively in the
 * non-workspace runtime plugin `plugins/google-gemini`, which alone declares
 * the Google generation SDK. This gate pins that containment structurally and
 * with a zero-allowlist policy: no baseline file, no per-site exemptions, no
 * ratchet. Any violation fails the gate.
 *
 * Layers:
 *
 *   L1-manifest  Exactly one declaration of the Google generation SDK across
 *                every package.json dependency section repo-wide, in
 *                plugins/google-gemini/package.json "dependencies" (and only
 *                that section). npm aliases whose target resolves to the SDK
 *                are rejected in every manifest, including the plugin's
 *                (disguised-declaration rule carried over from the
 *                genai-enclave manifest enforcement, finding F1 vocabulary).
 *                plugins/google-mcp-auth must declare none — it does, by not
 *                being the sanctioned manifest. Root package.json,
 *                plugins/google-gemini/package.json, root bun.lock and root
 *                package-lock.json are REQUIRED to exist and parse
 *                (fail-closed, old-gate F4 vocabulary).
 *
 *   L1-lockfile  Root bun.lock carries no resolution/dependency entry for the
 *                SDK; root package-lock.json carries no resolved or
 *                workspace-declared SDK entry. The plugin-local bun.lock is a
 *                separate install context and IS allowed to carry the SDK.
 *
 *   L2-import    No import-shaped specifier resolving to the SDK outside
 *                plugins/<name>/src/** and plugins/<name>/dist/** (built
 *                artifacts). Scans production AND test sources repo-wide
 *                across the packages/, scripts/, evals/, integration-tests/
 *                and test-scripts/ lanes plus root-level source files. The
 *                matcher is structural (statement shapes reported by Bun's
 *                transpiler — static, side-effect and re-export forms,
 *                dynamic import(), require() — plus narrow text matchers for
 *                type-only statements and mock.module / vi.mock / jest.mock
 *                specifier arguments) rather than a bare substring search, so
 *                a non-import mention of the SDK string (e.g. models.dev
 *                metadata recording which npm package implements a provider)
 *                is not a violation.
 *
 *   L3-residency File-residency naming scan in the spirit of the old
 *                agents scanner: packages/providers/src/** must contain no
 *                file whose basename starts with "gemini" (either case). The
 *                Gemini provider tree lives only under
 *                plugins/google-gemini/src/**. Compat files outside the
 *                provider workspace (e.g. core llm-types geminiContent) and
 *                preserved ecosystem filenames (gemini-extension.json etc.)
 *                are outside this layer's scope by design.
 *
 *   envelope     Exact-set rule (issue #2628 enforcement policy): the set of
 *                provider ids + built-in aliases contributed by plugin
 *                manifests must exactly equal the plugin-owned capability set
 *                the base hints at in PLUGIN_PROVIDED_PROVIDER_HINTS
 *                (packages/providers/src/composition/runtimePlugins/
 *                pluginProvidedProviders.ts). Every alias-carrying
 *                contribution must be hinted at exactly that plugin's package;
 *                every hinted id must be contributed — alias-carrying — by the
 *                plugin the hint names. Alias-less contributions are the
 *                reserved-stub shape the manifest v1 schema requires
 *                (#2759, e.g. google-mcp-auth): they are not alias-construction
 *                capabilities, so they are exempt from the exact-set but must
 *                not be pointed at by a hint.
 *
 *   A2A carve-out (preserved semantics): agent-to-agent envelope identifiers
 *   that legitimately reference gemini remain legitimate. Per the issue's
 *   envelope rule, A2A protocol shapes carrying the `kind` / `messageId` /
 *   `taskId` discriminators stay legitimate A2A messages even when their
 *   metadata or identifiers reference the gemini provider id. This gate
 *   preserves that carve-out structurally: it flags only import-shaped SDK
 *   references (L2), plugin-tree file residency in the provider workspace
 *   (L3), manifest/lockfile declarations (L1) and plugin-manifest capability
 *   parity (envelope) — never protocol-shape identifiers in host code.
 *
 * Module map: the scanning internals live in scripts/lib/ —
 * gemini-containment-shared.ts (walks, L1 manifest/lockfile layers, shared
 * primitives), gemini-containment-source.ts (L2 imports, L3 residency, scan
 * orchestration) and gemini-containment-envelope.ts (envelope: plugin-manifest
 * ↔ base-hint exact-set parity). This entry file owns the CLI, gate-root
 * resolution, and the public re-exports the test suite consumes.
 *
 * CLI:
 *   bun scripts/check-gemini-containment.ts           — fail mode (exit 1 on
 *                 any violation or operational error; fail-closed).
 *   bun scripts/check-gemini-containment.ts --report  — prints the same
 *                 findings table but always exits 0 (artifact generation).
 *
 * For test fixtures, set LLXPRT_GATE_ROOT=<dir> to scan a different root
 * tree. The override is fail-closed: a nonexistent directory is an error,
 * never a silent pass.
 *
 * The gate never imports plugin or workspace package code; the hints table
 * and plugin manifest contributions are read by structural source scans of
 * the literals (balanced, string/comment-aware extraction), keeping the
 * scripts lane dependency-free.
 */

import { statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runContainmentScan } from './lib/gemini-containment-source.ts';
import type { GateViolation } from './lib/gemini-containment-shared.ts';

export * from './lib/gemini-containment-shared.ts';
export * from './lib/gemini-containment-source.ts';
export * from './lib/gemini-containment-envelope.ts';

function relTo(root: string, absPath: string): string {
  return relative(root, absPath).replaceAll('\\', '/');
}

/**
 * Resolve the scan root. `override` (LLXPRT_GATE_ROOT) must point at an
 * existing directory — fail-closed: a bad override errors out instead of
 * silently passing.
 */
export function resolveGateRoot(override: string | undefined): string {
  const fallback = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const root = resolve(override ?? fallback);
  let isDir = false;
  try {
    isDir = statSync(root).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    throw new Error(
      `LLXPRT_GATE_ROOT '${override}' does not point to an existing ` +
        'directory — failing closed rather than scanning nothing.',
    );
  }
  return root;
}

function formatViolation(v: GateViolation): string {
  return `  ${v.file}:${v.line} [${v.layer}] ${v.message}`;
}

function main(): void {
  const reportMode = process.argv.slice(2).includes('--report');
  let root: string;
  try {
    root = resolveGateRoot(process.env['LLXPRT_GATE_ROOT']);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
  const result = runContainmentScan(root);
  console.log(
    `gemini-containment gate: scanning under ${relTo(process.cwd(), root) || '.'} ` +
      `(${result.scannedSourceFiles} source files)...`,
  );
  for (const violation of result.violations) {
    console.log(formatViolation(violation));
  }
  for (const error of result.errors) {
    console.log(`  operational error: ${error}`);
  }
  const failed =
    result.violations.length > 0 ||
    result.errors.length > 0 ||
    result.scannedSourceFiles === 0;
  if (failed) {
    console.log(
      `\ngemini-containment gate FAILED: ${result.violations.length} ` +
        `violation(s), ${result.errors.length} operational error(s).`,
    );
  } else {
    console.log(
      `\ngemini-containment gate PASSED: zero violations, zero errors ` +
        '(zero-allowlist, no baseline).',
    );
  }
  if (reportMode) {
    console.log('(report mode: exiting 0 regardless of findings.)');
    process.exit(0);
  }
  process.exit(failed ? 1 : 0);
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
