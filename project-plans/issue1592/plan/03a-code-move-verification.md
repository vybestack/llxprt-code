# Phase 03a: Code Move Verification

## Phase ID

`PLAN-20260610-ISSUE1592.P03A`

## Checks

1. Full battery per the authoritative definition in 00-overview.md (format+diff-check FIRST, then typecheck/build/test/lint/smoke) — paste outputs.
2. Move-map compliance: diff the move map against `git diff --stat main` — every MOVE row executed, every STAYS row untouched (except specified edits). List any discrepancy.
3. **Behavior preservation audit**: pick 5 moved files at random plus these mandatory ones — `client.ts`, `coreToolScheduler.ts`, `subagent.ts`, `chatSession.ts`, `StreamProcessor.ts` — and verify with `git diff -M --follow`-style comparison that changes are import-path-only (plus the contract `implements` clause). ANY logic delta = FAIL.
4. Dependency scans (from 03 doc) + anti-shim scan + deferred-implementation scan over new/modified files.
5. Core export surface: `packages/core/src/index.ts` exports no moved implementation; contracts/types still exported; `npm pack --dry-run -w @vybestack/llxprt-code-core` sanity.
6. agents public API: every symbol required by CLI/a2a (per reverse-dep map §5) is exported from `@vybestack/llxprt-code-agents`.
7. Test accounting: moved test files count vs deleted — zero net coverage loss; relocated tests run green in agents (`npm run test -w @vybestack/llxprt-code-agents`).
8. Provider-test migration verified: `packages/providers/src/openai/OpenAIStreamProcessor.stopReason.test.ts` no longer references ChatSession (or has been relocated); equivalent assertions exist and pass in agents; the three moved chatSession tests no longer import providers and their behavioral assertions are intact (diff the assertion bodies against main).
9. Hard scan: no `../index.js`-style imports survive in `packages/agents/src` pointing at core's barrel, and no `from '@vybestack/llxprt-code-core'` root-barrel imports (subpaths only) — paste scan output.
10. Hard scan: core tests must not import `@vybestack/llxprt-code-agents` nor any moved core path. The scan covers ALL reference forms — static imports (single AND double quotes), `export ... from`, dynamic `import()`, `require()`, and `vi.mock()` string literals:
   ```bash
   grep -rnE "(llxprt-code-agents|core/client\.js|core/chatSession\.js|core/coreToolScheduler\.js|core/subagent\.js|tools/task\.js)" packages/core/src --include="*.test.ts" --include="*.spec.ts"
   ```
   — paste output, expect EMPTY. Contract-only imports use the distinct staying paths `core/clientContract.js` / `core/toolSchedulerContract.js` (per P03 task 6), so any surviving `core/client.js`/`core/coreToolScheduler.js` reference is unambiguously a violation.
11. Dependency completeness: paste the generated import inventory reconciliation (P03 task 12) and `npm pack --dry-run -w @vybestack/llxprt-code-agents` output; where practical, build from packed artifact to prove no workspace leakage.
11b. Workspace-leakage gate (generated, not string-specific): extract every package specifier used anywhere under `packages/agents` (src + tests + config files) covering ALL import forms — static `from '...'`, `export ... from '...'`, dynamic `import('...')`, `require('...')`, and vi.mock('...') path literals:
   ```bash
   grep -rhoE "(from|import\(|require\(|vi\.mock\()\s*['\"][^.'\"][^'\"]*['\"]" packages/agents --include="*.ts" --include="*.tsx" | grep -oE "['\"][^'\"]+['\"]" | sort -u
   ```
   Plus ALL dependency sections of `packages/agents/package.json` (dependencies, devDependencies, peerDependencies, optionalDependencies), plus tsconfig paths and vitest config aliases. Allowed workspace packages (per REQ-DEP-001): core, plus auth/settings/telemetry/mcp WHEN the generated import inventory proves a direct import (known proven: settings — task.ts:27, subagentOrchestrator.ts:16; auth — StreamProcessor.ts:27); test-utils dev-only. HARD-FAIL on: `@vybestack/llxprt-code-providers`, `@vybestack/llxprt-code` (root cli package), or any workspace package present in package.json without a matching entry in the import inventory.
12. ToolRecord parity test exists and passes: `allPotentialTools` entries for TaskTool identical before/after inversion in all four scenarios (registered, missing-manager, coreTools allow-list, excludeTools).

## Holistic Assessment + Verdict

Written assessment (trace one full chat turn and one subagent task execution through the new package boundary). PASS/FAIL in `.completed/P03A.md`.
