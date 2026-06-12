# P02A Package Scaffold Review

## Summary

Fresh review of `PLAN-20260610-ISSUE1592.P02/P02A` against HEAD `9c448f4b7b75c1e9fed4af47fb1d79f4586cd921` finds the P02 agents package scaffold and release/sandbox wiring coherent and safe as a preparatory scaffold for the P03 atomic move.

The new `packages/agents` package follows the sibling package shape: root `index.ts`, `src/index.ts` placeholder only, `dist/index.js` package entry, build/typecheck/test scripts via the shared package build conventions, and a root-only export map. I found no fake API skeletons, placeholder classes, forwarding shims, or premature source imports of `@vybestack/llxprt-code-agents` from core/CLI/a2a/providers.

Release, sandbox, version, Docker, workspace, lockfile, and release-process test wiring all include agents consistently with the providers precedent. Dependency direction is preserved for P02: agents does not depend on providers or CLI; core/providers/CLI/a2a do not depend on agents in package metadata; and the only references from existing source are explanatory comments in P01 contract/default-registration files, not imports.

## Checks Performed

- Read and compared the governing docs:
  - `project-plans/issue1592/plan/02-package-scaffold.md`
  - `project-plans/issue1592/plan/02a-package-scaffold-verification.md`
  - `project-plans/issue1592/specification.md`
  - `project-plans/issue1592/.completed/P02.md`
  - relevant preflight notes for export-map/release touchpoints.
- Inspected HEAD and commit scope:
  - `git status --short`
  - `git rev-parse HEAD`
  - `git show --stat --oneline --decorate --no-renames HEAD`
  - `git diff 9c448f4b7^ 9c448f4b7 -- ...` for package/workflow/script surfaces.
- Inspected agents package files directly:
  - `packages/agents/package.json`
  - `packages/agents/index.ts`
  - `packages/agents/src/index.ts`
  - `packages/agents/tsconfig.json`
  - `packages/agents/vitest.config.ts`
- Compared providers precedent:
  - `packages/providers/package.json`
  - `packages/providers/tsconfig.json`
  - `packages/providers/vitest.config.ts`
  - provider references in release/sandbox/Docker/version/release-process tests.
- Ran targeted dependency/import scans:
  - `git grep -n "@vybestack/llxprt-code-agents" -- packages/cli packages/a2a-server packages/core packages/providers packages/agents ':!packages/agents/package.json' ':!packages/agents/tsconfig.json' ':!packages/agents/vitest.config.ts'`
  - `git grep -n "llxprt-code-agents" package.json package-lock.json packages/*/package.json .github/workflows/release.yml .github/workflows/build-sandbox.yml scripts/build_sandbox.js scripts/version.js Dockerfile scripts/tests/release-process.test.js`
  - same grep for `llxprt-code-providers` as a providers checklist comparison.
- Parsed package manifests to verify workspace dependency direction across agents/core/CLI/a2a/providers.
- Verified package/lock/release-script behavior:
  - `node scripts/check-lockfile.js` — PASS.
  - `npx vitest run --config ./scripts/tests/vitest.config.ts scripts/tests/release-process.test.js` — PASS, 15 tests.
  - `npm run typecheck -w @vybestack/llxprt-code-agents` — PASS.
  - `npm run build -w @vybestack/llxprt-code-agents` — PASS.
  - `npm pack --dry-run -w @vybestack/llxprt-code-agents` — PASS; tarball contains only `dist/.last_build`, `dist/index.*`, `dist/src/index.*`, and `package.json`.
- Ran the broader P02A script test command:
  - `node scripts/check-lockfile.js && npm run test:scripts` — lockfile PASS; `test:scripts` failed only in `scripts/tests/ui-image-harness.test.js` because `packages/ui/scripts/image-harness.ts` is missing. The P02-relevant `scripts/tests/release-process.test.js` passed in that same run, and passed again when run directly.

## Findings (blocker/major/minor)

### Blocker

None.

### Major

None.

### Minor

1. **P02 completion notes do not include a full explicit dependency inventory table.**
   - `plan/02-package-scaffold.md` asks for the provisional generated import inventory to be converted into an explicit dependency table in the phase completion notes.
   - `.completed/P02.md` records important package decisions and verification, but does not paste a full dependency-by-dependency inventory table.
   - I am not treating this as a blocking implementation issue because the package manifest itself is coherent for a scaffold, forbidden dependencies are absent, and P03/P03A explicitly own final dependency reconciliation after import rewrites. It would still be useful to add the table if strict phase-document completeness is required.

2. **Full `npm run test:scripts` remains affected by an unrelated local image harness failure.**
   - The failure is `Module not found "packages/ui/scripts/image-harness.ts"` in `scripts/tests/ui-image-harness.test.js`.
   - The release-process tests that exercise the P02 release/sandbox wiring pass directly and also passed before the unrelated failure in the full script-test run.
   - This does not indicate a P02 agents scaffold regression, but it is evidence that the unfiltered `npm run test:scripts` command is not currently green in this checkout without the existing skip path described in the P02 completion notes.

## Dependency Boundary Assessment

- `packages/agents/package.json` dependencies are limited to allowed workspace directions plus direct external dependencies:
  - workspace production deps: `@vybestack/llxprt-code-auth`, `@vybestack/llxprt-code-core`, `@vybestack/llxprt-code-settings`.
  - workspace dev dep: `@vybestack/llxprt-code-test-utils`.
  - no `@vybestack/llxprt-code-providers` dependency.
  - no `@vybestack/llxprt-code` / CLI dependency.
- `packages/core/package.json` has no dependency or devDependency on `@vybestack/llxprt-code-agents`.
- `packages/providers/package.json` has no dependency or devDependency on `@vybestack/llxprt-code-agents`.
- `packages/cli/package.json` and `packages/a2a-server/package.json` do not yet depend on agents, which matches P02's requirement to defer consumer dependencies until the atomic P03 import flips.
- Source scan for `@vybestack/llxprt-code-agents` under `packages/cli`, `packages/a2a-server`, `packages/core`, `packages/providers`, and `packages/agents` found no import statements. The only non-scaffold hits outside agents metadata/config are explanatory comments in core contract/default-registration files.
- `packages/agents/src/index.ts` contains only `export {};`; no fake public API, placeholder class, stub implementation, or compatibility shim was introduced.
- The agents package currently has no source-level imports, so there is no package-level cycle introduced in P02. P03/P03A still must perform the authoritative post-move import inventory and package dependency reconciliation.

## Verification Recommendation

Proceed to P03 after recording P02A as passed. For P03, keep the dependency-reconciliation gate strict: regenerate the multi-form import inventory after real import rewrites, compare every agents package dependency/devDependency/path alias/vitest alias against that inventory, and reject any providers or CLI dependency. Also preserve the current no-shim state: CLI/a2a package dependencies on agents should land only in the same atomic change set that introduces their imports.

If the team wants phase documentation to be fully literal, add the missing provisional dependency table to `.completed/P02.md`; this is documentation hygiene rather than a source/blocking scaffold defect.

## Verdict

APPROVE
