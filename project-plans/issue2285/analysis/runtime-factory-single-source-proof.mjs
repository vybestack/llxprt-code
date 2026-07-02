#!/usr/bin/env node
// Runtime factory single-source migration proof.
//
// POST-MIGRATION (P09 applied) verification path.
//
// The original (pre-P09) version of this script copied the entire working tree
// to a temp dir, applied the P09 migration to the COPY, and ran build +
// typecheck there. Now that the migration has landed in production source,
// that apply-to-copy logic is stale (it asserted the interface did NOT yet
// exist in core, which now fails immediately).
//
// This version verifies the POST-MIGRATION invariants directly against the
// real working tree WITHOUT modifying it:
//
//   1. AgentRuntimeFactoryBindings has a SINGLE structural declaration in
//      packages/core/src/core/clientContract.ts (the single source of truth).
//   2. Neither agents nor providers declare their own local
//      AgentRuntimeFactoryBindings interface (no duplicated structural
//      declarations).
//   3. Both agents and providers IMPORT AgentRuntimeFactoryBindings from the
//      core package root (@vybestack/llxprt-code-core), confirming they use
//      the single source of truth rather than a re-declared local type.
//   4. At least one consumer re-exports it from the core package root,
//      confirming the core root barrel surfaces the type.
//
// If all invariants hold, the script prints PASS and exits 0. The real
// working tree is never modified (read-only verification).

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..', '..');

const CORE_CONTRACT = 'packages/core/src/core/clientContract.ts';
const AGENTS_FACTORIES = 'packages/agents/src/api/runtimeFactories.ts';
const PROVIDERS_RUNTIME =
  'packages/providers/src/runtime/runtimeContextFactory.ts';

const CORE_INTERFACE_SOURCE =
  'export\\s+interface\\s+AgentRuntimeFactoryBindings\\b';
const CORE_INTERFACE_RE = new RegExp(CORE_INTERFACE_SOURCE);
const CORE_INTERFACE_GLOBAL_RE = new RegExp(CORE_INTERFACE_SOURCE, 'g');
const CORE_TYPE_EXPORT_RE =
  /export\s+(?:type\s+)?\{[^}]*\bAgentRuntimeFactoryBindings\b[^}]*\}\s*from\s*['"]@vybestack\/llxprt-code-core['"]/;
const LOCAL_INTERFACE_RE =
  /export\s+interface\s+AgentRuntimeFactoryBindings\s*\{/;
const CORE_IMPORT_RE =
  /import\s+(?:type\s+)?\{[^}]*\bAgentRuntimeFactoryBindings\b[^}]*\}\s*from\s*['"]@vybestack\/llxprt-code-core['"]/;
const CORE_BARREL_RE =
  /export\s+\*\s+from\s+['"]\.\/core\/clientContract(?:\.js)?['"]/;

const failures = [];

function fail(message) {
  failures.push(message);
}

function read(relPath) {
  const abs = join(REPO_ROOT, relPath);
  if (!existsSync(abs)) {
    fail(`${relPath} not found at ${abs}`);
    return null;
  }
  return readFileSync(abs, 'utf8');
}

function stripComments(src) {
  // This structural proof targets TypeScript contract/factory files, not
  // arbitrary source: comment-like sequences inside string literals could be
  // stripped by this lightweight scan. If those files start containing such
  // literals, replace this with a tokenizer-backed implementation.
  return src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

// ── Invariant 1: single structural declaration in core ──────────────────
const coreContract = read(CORE_CONTRACT);
const coreContractStructural = coreContract ? stripComments(coreContract) : null;
if (coreContractStructural && !CORE_INTERFACE_RE.test(coreContractStructural)) {
  fail(
    `${CORE_CONTRACT} does not declare the AgentRuntimeFactoryBindings interface ` +
      '(the single source of truth is missing from core)',
  );
} else if (coreContractStructural) {
  const declarations = coreContractStructural.match(CORE_INTERFACE_GLOBAL_RE);
  if (declarations && declarations.length > 1) {
    fail(
      `${CORE_CONTRACT} declares AgentRuntimeFactoryBindings ${declarations.length} times ` +
        '(expected exactly one declaration)',
    );
  }
}

// ── Invariant 2: no duplicated local declarations in consumers ──────────
const agentsFactories = read(AGENTS_FACTORIES);
const providersRuntime = read(PROVIDERS_RUNTIME);
const agentsFactoriesStructural = agentsFactories
  ? stripComments(agentsFactories)
  : null;
const providersRuntimeStructural = providersRuntime
  ? stripComments(providersRuntime)
  : null;
if (
  agentsFactoriesStructural &&
  LOCAL_INTERFACE_RE.test(agentsFactoriesStructural)
) {
  fail(
    `${AGENTS_FACTORIES} still declares a local AgentRuntimeFactoryBindings interface ` +
      '(should be removed — core is the single source of truth)',
  );
}
if (
  providersRuntimeStructural &&
  LOCAL_INTERFACE_RE.test(providersRuntimeStructural)
) {
  fail(
    `${PROVIDERS_RUNTIME} still declares a local AgentRuntimeFactoryBindings interface ` +
      '(should be removed — core is the single source of truth)',
  );
}

// ── Invariant 3: both consumers import the type from core ───────────────
if (agentsFactoriesStructural && !CORE_IMPORT_RE.test(agentsFactoriesStructural)) {
  fail(
    `${AGENTS_FACTORIES} does not import AgentRuntimeFactoryBindings from ` +
      '@vybestack/llxprt-code-core (must consume the single source of truth)',
  );
}
if (providersRuntimeStructural && !CORE_IMPORT_RE.test(providersRuntimeStructural)) {
  fail(
    `${PROVIDERS_RUNTIME} does not import AgentRuntimeFactoryBindings from ` +
      '@vybestack/llxprt-code-core (must consume the single source of truth)',
  );
}

// ── Invariant 4: core barrel re-exports the type ───────────────────────
// Verify the core root barrel (packages/core/src/index.ts) re-exports the
// interface so consumers can import it via the bare package root.
const CORE_BARREL = 'packages/core/src/index.ts';
const coreBarrel = read(CORE_BARREL);
const coreBarrelStructural = coreBarrel ? stripComments(coreBarrel) : null;
if (coreBarrelStructural && !CORE_BARREL_RE.test(coreBarrelStructural)) {
  fail(
    `${CORE_BARREL} does not re-export from clientContract — ` +
      'AgentRuntimeFactoryBindings may not be reachable via the package root',
  );
}

// ── Invariant 5: at least one consumer re-exports it from core ──────────
// Confirms that consumers surface the type from the core package root. At
// least one of agents or providers must re-export it. Coerce to boolean so
// the reExporters array and downstream checks see true/false rather than the
// null produced when a file does not exist (the && short-circuit yields null
// in that case); the truthiness semantics are unchanged but the type is
// unambiguous.
const agentsReExports = !!(
  agentsFactoriesStructural && CORE_TYPE_EXPORT_RE.test(agentsFactoriesStructural)
);
const providersReExports = !!(
  providersRuntimeStructural && CORE_TYPE_EXPORT_RE.test(providersRuntimeStructural)
);
if (!agentsReExports && !providersReExports) {
  fail(
    'Neither agents nor providers re-export AgentRuntimeFactoryBindings from ' +
      '@vybestack/llxprt-code-core (at least one consumer must re-export from core)',
  );
}
// ── Report ──────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(
    `FAIL: ${failures.length} single-source invariant violation(s) detected:`,
  );
  for (const msg of failures) {
    console.error(`  - ${msg}`);
  }
  process.exit(1);
}

const reExporters = [];
if (agentsReExports) reExporters.push('agents');
if (providersReExports) reExporters.push('providers');

console.log(
  'PASS: AgentRuntimeFactoryBindings single-source migration invariants hold.',
);
console.log('  - Single structural declaration in packages/core/src/core/clientContract.ts');
console.log('  - No duplicated local declarations in agents or providers');
console.log('  - Both agents and providers import from @vybestack/llxprt-code-core');
console.log('  - Core root barrel (packages/core/src/index.ts) re-exports from clientContract');
console.log(
  `  - Consumer re-export confirmed (${reExporters.join(' and ')} re-export${
    reExporters.length === 1 ? 's' : ''
  } from core)`,
);
console.log('  - Real working tree unchanged (read-only verification)');
process.exit(0);
