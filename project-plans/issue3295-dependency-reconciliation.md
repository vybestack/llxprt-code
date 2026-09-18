# Plan: Reconcile package dependency declarations after dead-source cleanup

Plan ID: PLAN-20260917-ISSUE3295-DEPS
Issue: #3295 (Reconcile package dependency declarations after dead-source cleanup)
Parent: #2232
Inventory: `project-plans/issue2232-dead-code-inventory.md`
Generated: 2026-09-17
Deliverable type: Dependency-declaration validation and reconciliation. Removals
happen only where fresh validation finds a still-stale declaration. Retained
declarations get a written ownership reason so later audits do not rediscover
them.

## Status

Complete (documentation and validation outcome). The inventory (dated
2026-08-24) predates three merged removal slices, so several #3295 rows were
already executed by sibling PRs (#3674 / commit 0cfb65fc5 for #2235, commit
f9f2b9763 for #2236, commit 61214722a for #2234). This slice re-verified every
#3295 row against the current head (main @ 6a2d23d0d, branch `issue3295`),
found no still-stale declaration, made no manifest or lockfile changes,
recorded final outcomes in both plan documents, and ran the full verification
cycle. Evidence is in the execution record below. Where the sibling slices
overlap, removals are attributed to the commit that actually landed the
change on mainline (the later overlapping slice's removals no-op'd at its
merge).

## Accepted behavior

1. Every inventory row assigned to #3295 is rechecked against current source
   per the inventory disposition workflow step 2 (source, dynamic, script,
   export-map, build, bundle, metadata) before any manifest edit.
2. A declaration is removed only after the issue boundary proof: absence from
   production and test source, dynamic imports, command strings, scripts,
   export/build configuration, generated assets, and bundle external
   ownership.
3. CLI bundle-owned native and grammar dependencies are protected: the
   `scripts/bun-build.config.ts` externals model and the packed-layout
   resolution rule from issue #3055 (root manifest as resolution owner for the
   published package) are ownership evidence, not staleness evidence.
4. The VS Code watch-script mismatch is settled as a decision with evidence
   (declaration matches the invoked binary and the watch entry point works),
   not a blind removal.
5. If validation finds no stale declaration, no manifest or lockfile changes
   are made; the PR is validation evidence plus documentation of final
   outcomes.
6. The full repository verification cycle and the `zai-glm-flash` CLI smoke
   pass. The issue text names `stepfun-37`; that profile is retired (StepFun
   subscription cancelled 2026-09-13), and `.llxprt/LLXPRT.md` names
   `zai-glm-flash` as the current smoke profile.

## Candidate matrix (pre-branch survey, main @ 6a2d23d0d)

| # | Candidate | Current state on main | Expected final disposition |
|---|---|---|---|
| C1 | `gradient-string` in root and `packages/cli` manifests | Absent from both manifests (both removed on mainline via #2235, commit 0cfb65fc5). Lockfile entries are transitive dependencies of `ink-gradient`, which remains live | Already reconciled; validate absence proofs and lockfile transitivity |
| C2 | Root CLI-family `@xterm/headless` | Declared in root; removed by #2235 then restored by 92cd92e1a ("required by packed CLI consumer resolution"). `packages/core` declares its own copy and imports it | Retain; re-prove the packed-layout resolution reason and record it |
| C3 | Core migration-residue family (20 names) | All absent from `packages/core/package.json` except `tree-sitter-bash` and `tree-sitter-pwsh`, which `src/utils/shell-parser.ts` reaches at runtime via `require.resolve('tree-sitter-bash/tree-sitter-bash.wasm')` and `require.resolve('tree-sitter-pwsh/tree-sitter-powershell.wasm')` | Removed names: validate. Grammar names: retain with the require.resolve ownership reason |
| C4 | Providers `@ai-sdk/provider-utils` | Already in `devDependencies`; imported only by `src/openai-vercel/messageConversion.test.ts`, which remains | Retain placement; validate the test-only importer still exists |
| C5 | Tools `html-to-text` | `src/tools/direct-web-fetch.ts` imports `htmlToText` from `html-to-text` (added by web-fetch-native work after the inventory was written); `@types/html-to-text` ownership moved to tools by #2236 | Superseded by a production importer; retain and document |
| C6 | `fast-check` in auth, ide-integration, policy | Absent from all three manifests (removed via #2234/#2235) | Already reconciled; validate no source or test reference remains |
| C7 | test-utils `@vybestack/llxprt-code-storage` | Absent from the manifest (removed via #2235) | Already reconciled; validate |
| C8 | VS Code `npm-run-all` vs `npm-run-all2` | Manifest declares `npm-run-all2@^8.0.4` matching the `watch` script; `npm-run-all` is gone from manifests; lockfile `npm-run-all` strings are bin aliases inside the `npm-run-all2` package | Decision settled by #2235; validate declaration/script agreement and binary resolution |

## Phases

### Phase 0.5: Preflight

- Branch `issue3295` off latest main (done).
- Baseline gates on the clean branch: `npm run check:lockfile` passes
  (confirmed pre-branch), `npm run lint:runtime-deps` passes. Record output.

### Phase 1: Per-candidate ownership re-verification

For every row C1 to C8, run the boundary checklist on the current head:

1. Word-boundary and import-path greps across `packages/*`, `scripts/`,
   `integration-tests/`, `evals/`, and workflow files for the candidate name.
2. Dynamic-import and `require.resolve` command-string search (this is what
   keeps C3 grammars and C5 alive).
3. Script and export/build configuration search: package `scripts`,
   `files`, `exports`, `scripts/bun-build.config.ts` externals,
   esbuild configs, generate scripts.
4. Generated-asset search for the candidate name.
5. Lockfile role check: direct declaration versus transitive entry.

Update the matrix above with fresh evidence lines (command plus finding) in
this document. Rows whose fresh evidence contradicts the expected disposition
escalate to Phase 2 with the contradicting evidence recorded.

### Phase 2: Residue remediation (conditional)

Only if Phase 1 finds a still-stale declaration:

1. Remove it from the owning manifest.
2. Regenerate lockfiles: `npm install` (npm 11.6.2) updates
   `package-lock.json`; plain `bun install` updates `bun.lock`. Never
   `bun install --frozen-lockfile` (structurally unusable in this repo).
3. `npm run check:lockfile` passes.
4. Build the affected package and inspect its output for the removed name.
5. Exercise one consumer of the affected package (a live test or the smoke).

If Phase 1 confirms the matrix (no residue), record that finding and skip
manifest and lockfile edits entirely.

### Phase 3: Documentation

1. Record final outcomes in this document (Phase 1 evidence plus Phase 2
   actions, if any).
2. Update the #3295 rows in `project-plans/issue2232-dead-code-inventory.md`
   so each disposition cell reflects the executed outcome (removed by which
   commit, superseded by which importer, or retained with which ownership
   reason). The ten-column table contract and classification values stay
   intact; this updates the disposition text only. Add a short "Final outcomes
   (#3295)" note under the table pointing at this plan.
3. No edits to `dev-docs/` (doc-placement rule).

### Phase 4: Verification cycle

Run in order, fixing anything that fails:

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
npm run check:lockfile
bun scripts/start.ts --profile-load zai-glm-flash "write me a haiku and nothing else"
```

`npm run format` must leave no unrelated changes. The smoke exercises CLI
startup, which covers packed-layout source resolution for the retained
declarations (C2, C3).

## Behavioral evidence

This slice expects no production behavior change. The dependency gates carry the evidence: `check:lockfile`, `lint:runtime-deps`, the
`issue-3055-cli-externals-ownership` test, the core shell-parser bash and
PowerShell tests that exercise real grammar loading through the retained
`tree-sitter-*` declarations, and the CLI smoke. If Phase 2 removes a
declaration, the affected package build plus one consumer exercise becomes the
additional required evidence per the inventory's later-behavior-evidence rule
5.

## Execution record

Branch `issue3295` off main @ 6a2d23d0d. Working tree started clean except
this plan document (untracked).

### Phase 0.5 results

- `npm run check:lockfile`: passed ("Lockfile check passed.", exit 0). Log:
  `tmp/issue3295/preflight-check-lockfile.log`. The checker parses
  `package-lock.json` only and does not need `node_modules`.
- `npm run lint:runtime-deps`: first run failed with a Bun ENOENT resolving
  `typescript` because this fresh checkout had no `node_modules`. After the
  repo-standard plain `bun install` (Bun 1.3.14, matches `.bun-version`;
  1061 packages, 17s), it passed: "PASS: 1991 production source file(s)
  import only declared packages." (exit 0). Log:
  `tmp/issue3295/preflight-lint-runtime-deps.log`.
- `bun install` side effects: it added 68 lines of workspace-nested resolution
  entries to `bun.lock` and rewrote `packages/vscode-ide-companion/NOTICES.txt`
  line endings (content identical). Both files were restored with
  `git checkout --` because this slice makes no lockfile edits and the
  completion criteria require no unrelated changes. `node_modules` stays
  materialized; no gate reads `bun.lock` after install.

### Phase 1 evidence (fresh, current head)

Each entry lists the command shape and the finding.

- C1 `gradient-string` (root + cli). Absence proofs:
  `grep -n '"gradient-string"' package.json packages/cli/package.json` found
  nothing. Word-boundary and import-path search across `packages/`,
  `scripts/`, `integration-tests/`, `evals/`, `.github/` (ts, tsx, js, cjs,
  mjs, json, yml, yaml; `from`/`import()`/`require()` forms) found nothing.
  Repo-wide `grep -rlw gradient-string` (excluding `node_modules`, `.git`)
  hits only the two lockfiles and `project-plans/` documents. Lockfile role:
  a `node -e` walk of `package-lock.json` shows the only entry declaring
  `gradient-string` is `node_modules/ink-gradient` (dependencies `^2.0.2`);
  `bun.lock` mirrors that (ink-gradient@3.0.0 depends on gradient-string
  ^2.0.2).   Removal history: root and cli declarations were
  both removed on mainline by 0cfb65fc5 (#2235, PR #3674); the identical cli
  removal in f9f2b9763 (#2236) was a no-op at its later merge because that
  branch predated the #3674 merge. Final: already reconciled;
  lockfile entries are transitive via `ink-gradient`, which remains live.
- C2 root `@xterm/headless`. Root `package.json` line 307 declares
  `"@xterm/headless": "5.5.0"` in `dependencies`. `packages/core/package.json`
  line 600 declares its own `5.5.0` copy; core production source imports it
  (`terminalSerializer.ts`, `shellPtyState.ts`, `shellPtyHelpers.ts`,
  `shellPtyLifecycle.ts`) plus tests. `packages/cli/package.json` does not
  declare it and `packages/cli/src` has zero references. Packed-layout proof:
  root `package.json` `files` ships `packages/core/src/` (raw TypeScript)
  inside the published `@vybestack/llxprt-code` tarball, so in a consumer
  install core's import resolves through the root (published package)
  dependency declaration, per the issue #3055 resolution-owner rule. Commit
  92cd92e1a ("Restore root @xterm/headless required by packed CLI consumer
  resolution") documents the restore with PR #3674 Node Consumer Smoke CI
  evidence; `.github/workflows/ci.yml` runs the `node_consumer_smoke` job
  (line 815) as a required gate. Final: retained; ownership reason re-proven.
- C3 core migration-residue family (20 names). Manifest check over all 20
  names in `packages/core/package.json`: 18 absent; `tree-sitter-bash`
  (^0.25.0, line 617) and `tree-sitter-pwsh` (^0.38.1, line 618) present.
  Residue check for the 18 removed names (import-from, double-quote, dynamic
  `import()`, `require()` forms across `packages/core/src` and core package
  files): zero matches. Core `scripts`/`files`/`exports` mention none of the
  18 (checked by JSON walk; `bin` is null). Grammar ownership: `packages/core/src/utils/shell-parser.ts`
  line 180 `require.resolve('tree-sitter-bash/tree-sitter-bash.wasm')` and
  line 198 `require.resolve('tree-sitter-pwsh/tree-sitter-powershell.wasm')`
  load the WASM grammars by command string, which static import scans cannot
  see. Root also declares both grammars (lines 362-363) under the same packed
  layout rule as C2, and `trustedDependencies` lists `tree-sitter-bash`.
  Live consumers: `shell-parser-pwsh.test.ts`, `shell-utils.powershell.test.ts`
  exercise real grammar loading. Removal history: 12 of the 18 landed on
  mainline via 61214722a (#2234, PR #3673; the identical f9f2b9763 (#2236)
  removals were no-ops at its later merge); the other 6 were removed by
  earlier unrelated commits (`@ai-sdk/openai`, `ai` by b553d5818 #2761;
  `cheerio`, `node-fetch` by 757b65451 #2760; `@anthropic-ai/sdk`, `openai`
  by bb8a19571 #3221). One comment still mentions `ajv-formats`
  (`src/utils/schemaValidator.ts` line 222); it is not an import.
  Final: removed names validated clean; grammar names
  retained with the `require.resolve` ownership reason.
- C4 providers `@ai-sdk/provider-utils`. JSON walk of
  `packages/providers/package.json`: declared once, in `devDependencies`
  (^5.0.32). Repo-wide reference search finds exactly one source importer,
  `packages/providers/src/openai-vercel/messageConversion.test.ts` line 32 (a
  test file, present, 25 KB); `scripts/tests/plugins-topology.test.ts`
  references the name only inside a topology assertion, not an import. Final:
  retained in devDependencies; test-only importer verified live.
- C5 tools `html-to-text`. JSON walk of `packages/tools/package.json`:
  `html-to-text` ^9.0.5 in `dependencies`; `@types/html-to-text` ^9.0.4 in
  `devDependencies`. Production importer verified:
  `packages/tools/src/tools/direct-web-fetch.ts` line 23
  `import { htmlToText } from 'html-to-text'`, used at line 319. The importer
  was added by 757b65451 (#2760, native fetch in web tools), after the
  inventory was written. Root `package.json` also declares `html-to-text`
  ^9.0.5 (dependencies), consistent with the packed layout shipping
  `packages/tools/src`. Final: superseded by a production importer; retained
  and documented.
- C6 `fast-check` (auth, ide-integration, policy). Manifest grep across all
  workspace manifests: absent from the three candidate manifests; still
  declared in agents, core, mcp, providers, telemetry, and root (not
  candidates; telemetry consumer spot-checked: `DebugLogger.test.ts`).
  Full-package word-boundary sweep of `packages/auth`, `packages/ide-integration`,
  `packages/policy` (all files, excluding `node_modules`, `dist`): zero
  references. Removal history: auth removed by 61214722a (#2234),
  ide-integration by 0cfb65fc5 (#2235), policy by 61214722a (#2234). Final:
  already reconciled; no source or test reference remains.
- C7 test-utils `@vybestack/llxprt-code-storage`. Manifest grep: absent.
  Full-package sweep of `packages/test-utils` for `llxprt-code-storage`:
  zero references. Removal history: removed by 0cfb65fc5 (#2235). Final:
  already reconciled.
- C8 VS Code `npm-run-all` vs `npm-run-all2`. Manifest grep across root,
  `packages/*`, `plugins/*`: no bare `"npm-run-all"` declaration anywhere.
  `packages/vscode-ide-companion/package.json` declares `npm-run-all2`
  ^8.0.4 in `devDependencies` (line 145) and its `watch` script invokes
  `npm-run-all2 -p watch:*` (line 127) with two real targets
  (`watch:esbuild`, `watch:tsc`). Lockfile strings: the `npm-run-all`
  occurrences in `package-lock.json` (line 17735) and `bun.lock` (line 2251)
  are `bin` alias entries inside the `npm-run-all2` package itself
  (`"npm-run-all": "bin/npm-run-all/index.js"`). No standalone `npm-run-all`
  package exists on disk (checked root and vscode `node_modules`). Binary
  resolution: `node_modules/.bin/npm-run-all2 --version` prints `v8.0.4`.
  Removal history: settled by 0cfb65fc5 (#2235), which replaced the
  declaration. Final: decision validated; declaration matches the invoked
  binary and the binary resolves.

No candidate's fresh evidence contradicted its expected disposition.

### Phase 2 result

No still-stale declaration exists. No manifest edit, no lockfile
regeneration, no package build inspection beyond the standard Phase 4 cycle.
The preflight `bun install` churn on `bun.lock` and vscode `NOTICES.txt` was
reverted and is not a Phase 2 action.

### Phase 3 result

This document finalized (status, execution record, completion criteria) and
the nine #3295 rows in `project-plans/issue2232-dead-code-inventory.md`
updated to executed dispositions (disposition text only; ten-column contract
and six classification values intact), plus a "Final outcomes (#3295)" note
under the table pointing here. No edits under `dev-docs/`.

### Phase 4 results

Run on branch `issue3295` (markdown-only diff: this file plus the #2232
inventory row updates), with logs under gitignored `tmp/issue3295/`.

- `npm run test` (all 17 workspaces): every suite passed except 12 cases in
  two CLI files (`src/integration-tests/cli-args.profile-flag.integration.test.ts`,
  `src/integration-tests/cli-args.integration.test.ts`), all failing with
  `Could not activate explicitly-configured provider 'gemini': Provider
  'gemini' not found`. Root cause was checkout setup, not code: the merged
  #3702/#2763 Gemini-to-plugin migration means those suites need the
  checkout plugin's own dependencies, and CI's test job creates them with a
  per-plugin `bun install --omit=peer` (ci.yml "Install dependencies for
  testing", pinned bun 1.4.2). This checkout had no
  `plugins/google-gemini/node_modules`, so `discoverRuntimePlugins` correctly
  skipped the checkout plugin (a checkout plugin without its own
  node_modules is not loadable, by design). After replicating the CI plugin
  install, both files pass 31/31 (`tmp/issue3295/retest-profile2.log`).
  No other file failed.
- `npm run lint`: first run failed with 170 type-aware errors
  (`strict-boolean-expressions` "Unexpected any value in conditional") in
  stable files. Root cause was again checkout setup: three workspace
  tsconfigs map cross-workspace imports to `dist/*.d.ts`, and CI's
  lint job runs `npm run build:types` before lint for exactly this reason
  (ci.yml "Build declarations for type-aware lint"). This checkout had no
  dist. After `npm run build`, a full lint run passes all 18 targets with
  zero errors (`tmp/issue3295/lint2.log`).
- `npm run typecheck`: 0 errors.
- `npm run format`: exit 0; `git status` shows only the two project-plans
  documents (CI's format gate excludes `project-plans/`).
- `npm run build`: exit 0, no npm errors.
- `npm run check:lockfile`: passed (also passed in Phase 0.5 preflight).
- Smoke: `bun scripts/start.ts --profile-load zai-glm-flash "write me a
  haiku and nothing else"` completed and returned a three-line haiku with
  the profile banner `[zai-glm-flash:glm-5.3-flash]` (`tmp/issue3295/smoke.log`).

Environment note for reviewers: a fresh checkout needs (a) `npm run build`
before lint, and (b) the per-plugin `bun install --omit=peer` loop from
ci.yml before CLI integration suites can activate the Gemini runtime plugin.
Both are CI-standard steps this local checkout had not run; neither is a
repository defect, and neither was fixed in code by this slice.

## Completion criteria

- [x] Every row C1 to C8 has fresh evidence recorded in this document.
- [x] Any residue found is removed with manifest, lockfile, build, and
      consumer evidence; or the no-residue finding is recorded.
- [x] Inventory #3295 rows carry executed dispositions; retained suspicious
      declarations have written reasons.
- [x] The full verification cycle and the `zai-glm-flash` smoke pass.

## Review results

One review round (read-only subagent review of the full diff against the
repository, including first-parent merge-order walks). Verdict: PASS with
corrections required. All current-state claims C1-C8, boundary compliance,
the ten-column inventory contract, and scope discipline were independently
confirmed. Three findings, all remediated in this document and the
inventory:

- MEDIUM: cli `gradient-string` removal was attributed to f9f2b9763
  (#2236); the mainline removal is 0cfb65fc5 (#2235, PR #3674) because the
  #2236 branch predated that merge (first-parent order a1c466f4a, 09da79cb2,
  8db0031ed). Fixed in the C1 evidence, the candidate matrix, and the
  inventory row.
- MEDIUM: the core 18-name removal was attributed wholesale to f9f2b9763
  (#2236); 12 names landed via 61214722a (#2234) and the other 6 via
  earlier unrelated commits (#2760, #2761, #3221). Fixed in the C3 evidence
  and the inventory row. The C6/C7 matrix summaries were also re-attributed
  after direct `git log -S` verification (fast-check via #2234/#2235,
  storage via #2235).
- LOW: "no core source residue" wording glossed over a comment mention of
  `ajv-formats` at `packages/core/src/utils/schemaValidator.ts` line 222;
  the inventory row now states the precise claim (zero
  import/require/dynamic-import matches; one comment mention).

OCR was not run: open-code-review is disabled until re-enabled by the
maintainer.
- [x] No unrelated files changed.
