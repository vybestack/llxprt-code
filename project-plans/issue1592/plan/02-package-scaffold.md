# Phase 02: Package Scaffold

## Phase ID

`PLAN-20260610-ISSUE1592.P02`

## Prerequisites

- P01a PASS.

## Requirements Implemented

### REQ-PKG-001: Package boundary
**Full Text**: New workspace package `packages/agents` named `@vybestack/llxprt-code-agents`, version aligned, built with `scripts/build_package.js`, vitest tests, lint/typecheck like siblings; workspaces entry ordered after core/providers, before cli; release/sandbox/prepare-package wiring mirrors providers.
**Behavior**:
- GIVEN: fresh `npm install` + `npm run build`
- WHEN: workspace builds
- THEN: `packages/agents/dist` produced; cli/a2a resolve `@vybestack/llxprt-code-agents`
**Why This Matters**: the move phase needs a fully wired target package so moves are mechanical.

## Implementation Tasks

1. `packages/agents/package.json` — copy providers structure: name `@vybestack/llxprt-code-agents`, same version as siblings (check current, e.g. 0.10.0), type module, main/types/exports for `.`, scripts (build via `node ../../scripts/build_package.js`, lint, format, test, test:ci, typecheck), files [dist].
   **Dependencies MUST be derived from a GENERATED import inventory, not guessed**: use the SAME extraction as the P03a workspace-leakage gate — covering static `from '...'` (single AND double quotes), `export ... from`, dynamic `import('...')`, `require('...')`, and `vi.mock('...')` path literals:
   ```bash
   grep -rhoE "(from|import\(|require\(|vi\.mock\()\s*['"][^.'"][^'"]*['"]" <move-set files> | grep -oE "['"][^'"]+['"]" | sort -u
   ```
   over every moved production file AND moved test file (preflight item 13 produces the file list). Known dynamic-import example the simple pattern would miss: `core/StreamProcessor.unbucketed-auth-failover.test.ts:12` dynamically imports `@vybestack/llxprt-code-auth`. OWNERSHIP: the P02 inventory is PROVISIONAL (it informs the scaffold's initial dependency list — at minimum core, plus externals/workspace deps the inventory already proves); **P03 task 12 owns the FINAL, authoritative dependency reconciliation** against the post-rewrite import set (moved tests that today import providers — chatSession.issue1729/runtime/thinking-toolcalls, per move-map §H — get rewritten to structural fakes in P03, so providers must NOT appear as a dependency). P03a re-verifies via the item 11b gate. Convert the inventory into an explicit dependency table in the phase completion notes: every external lib (zod, @google/genai, diff, fast-levenshtein, etc. — exact versions copied from core) and every workspace package directly imported (core certainly; settings/telemetry/mcp/auth ONLY if the inventory shows direct imports — e.g. task.ts imports SubagentManager which comes via core deep module, NOT a separate dep). Document why each workspace dependency is allowed. Relying on transitive/workspace-leaked deps is FORBIDDEN (precedent: providers/package.json lists everything it directly imports). devDependencies: vitest, typescript, eslint config consistent with providers, `@vybestack/llxprt-code-test-utils` if the moved tests need it.
   Verification: `npm pack --dry-run -w @vybestack/llxprt-code-agents` succeeds (full packed-artifact build check deferred to P03a when real code exists).
2. `packages/agents/tsconfig.json` mirroring providers (composite/references as siblings do).
3. `packages/agents/vitest.config.ts` mirroring providers.
4. Entry layout MUST mirror providers exactly (verified): a ROOT `packages/agents/index.ts` containing license header + `export * from './src/index.js';`, plus `packages/agents/src/index.ts` placeholder (`export {};` only initially). This matches `main: "dist/index.js"` / `types: "dist/index.d.ts"` (root index compiles to dist/index.js; src files compile to dist/src/* — which is why deep-export map entries use `./dist/src/...` paths, see providers/package.json). tsconfig `include` lists both `index.ts` and `src/**/*.ts`, and self-alias paths map `@vybestack/llxprt-code-agents` → `./index.ts`, `@vybestack/llxprt-code-agents/*` → `./src/*` (mirror providers/tsconfig.json:9-20). FORBIDDEN: fake/stub exports, placeholder classes, or any pre-created "API skeleton" — the real API arrives via git mv in P03. Nothing may import `@vybestack/llxprt-code-agents` until P03 completes.
5. Root `package.json`: workspaces entry `packages/agents` after `packages/providers`, before `packages/cli`. Verify `npm install` regenerates lockfile cleanly; run `node scripts/check-lockfile.js` if applicable.
6. `packages/cli/package.json` and `packages/a2a-server/package.json`: do NOT add the agents dependency here. The `"@vybestack/llxprt-code-agents": "file:../agents"` entries are added in atomic P03 together with the import flips that use them (avoids declared-but-unused dependencies in a phase that must end green).
7. Core `package.json` exports: add subpath entries for core deep modules the move set will import (per preflight item 13 enumeration). Do NOT remove existing entries yet.
8. CI/release wiring (mirror providers per preflight item 14):
   - `.github/workflows/release.yml`: publish step + pack steps + cleanup globs for agents.
   - `.github/workflows/build-sandbox.yml`: `npm pack -w @vybestack/llxprt-code-agents`.
   - `scripts/prepare-package.js`: currently prepares only core and cli (lines ~38-49; it has NO providers handling). Determine whether agents needs README/LICENSE/.npmrc copying for publish; if yes, add it explicitly (and consider whether providers has the same gap — note but don't fix providers here); if no, document why in the phase completion notes.
   - `scripts/build_sandbox.js` (REQUIRED — verified providers touchpoints at lines ~97, ~159-165, ~225-227: `providersPackageDir`, pack command, tgz cleanup/copy): mirror each for agents.
   - `scripts/version.js` (REQUIRED — providers listed at line ~50 in the bump list): add `@vybestack/llxprt-code-agents`.
   - `Dockerfile` (REQUIRED — verified providers touchpoints at lines ~58 and ~70: tgz COPY and install list): mirror for agents tgz.
   - `scripts/tests/release-process.test.js` (REQUIRED — verified providers assertions at lines ~70, ~109-137: workspace list + publish-order assertions): add agents to the expected workspace list and publish-order expectations (agents publishes after core, like providers; pick a deterministic order relative to providers and assert it).
   - Check `esbuild.config.js` and `.npmrc`/publish configs for providers references; mirror each found.
   - `scripts/check-settings-boundary.js`: standalone boundary script (not CI-wired) with hard-coded scan paths (`packages/core/src/agents`, `packages/core/src/core` at ~470-479; `packages/providers/src` at ~26/174/194/297/478/508/757). The PATH updates happen in P04 task 6 (after the move, when paths actually change) — P02 only AUDITS it and records in the completion notes which checks will need agents coverage, so P04 can't miss it.
   - Run `npm run test:scripts` in this phase — it executes release-process.test.js and will catch wiring gaps.
9. ESLint: ensure root lint covers packages/agents (check eslint config patterns; providers precedent).

## Verification Commands

```bash
npm install
# FULL BATTERY (authoritative definition in 00-overview.md — P02 is a code-changing phase, no subsets)
npm run format && git diff --exit-code && npm run typecheck && npm run build && npm run test && npm run lint
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"

grep -n "agents" package.json .github/workflows/release.yml .github/workflows/build-sandbox.yml scripts/build_sandbox.js scripts/version.js Dockerfile scripts/tests/release-process.test.js
# scripts/prepare-package.js: EITHER it contains agents handling, OR the P02 completion marker
# documents (with evidence) why no handling is needed — it currently prepares only core+cli.
npm run test:scripts     # exercises release-process.test.js — catches wiring gaps
npm pack --dry-run -w @vybestack/llxprt-code-agents   # publish/pack sanity on the scaffold

# Isolation guard: NO consumer may import agents until P03 (scaffold has no real code)
grep -rn "llxprt-code-agents" packages/cli packages/a2a-server packages/core --include="*.ts" && echo "FAIL: premature consumer import" || echo OK
```

## Success Criteria

Workspace installs/builds green with the empty agents package; all CI/release files updated consistently with providers pattern.

## Completion Marker

`.completed/P02.md`.
