## Verdict: FAIL

The plan is substantially improved and addresses many hard constraints (no invented packages/storage, no-shim policy, issue1584 precedent, package metadata, consumer import inventories, CLI god-object deferral). However, there are still material executability and verification problems. Several tests/verification gates would either not exercise the real production path, fail for the wrong reason, or pass while forbidden matches remain.

## Material issues

1. P04b does not actually test the production configConstructor integration path it claims to test.
   - References: project-plans/issue1588/plan/04b-vertical-slice-integration-tdd.md:68-82,109-111; project-plans/issue1588/plan/03b-minimal-adapter-wiring.md:276-280.
   - The plan repeatedly says the vertical slice verifies configConstructor → activateSettingsRuntimeContext → registerSettingsService, but then explicitly says the P04b test imports and calls activateSettingsRuntimeContext directly because configConstructor.ts is not wired until P06. That is not a vertical slice through the production consumer path. It can pass even if configConstructor never calls the adapter.
   - Required change: either wire configConstructor minimally in P03b so P04b can test configConstructor as the production entrypoint and fail on the adapter stub, or reclassify P04b as an adapter contract test and add a real pre-implementation production-path integration test.

2. Expected-failing TDD verification commands are listed as normal verification commands.
   - References: project-plans/issue1588/plan/04b-vertical-slice-integration-tdd.md:134-140; project-plans/issue1588/plan/07-consumer-migration-tdd.md:115-124.
   - P04b and P07 intentionally create red tests, but the verification blocks first run failing tests as plain commands. In shell/agent execution this can abort the phase before failure analysis.
   - Required change: replace plain failing test runs with explicit capture-and-assert logic: capture exit code, assert nonzero, assert no module-resolution errors, assert behavioral/stub failure patterns, and exit 0 only if the red phase is valid.

3. Multiple must-be-zero scans are still non-enforcing or fail when clean.
   - References: project-plans/issue1588/plan/04-settings-package-tdd.md:81-85; plan/04b-vertical-slice-integration-tdd.md:139-142; plan/05-settings-package-impl.md:69; plan/07-consumer-migration-tdd.md:126-129; plan/08-consumer-migration-impl.md:62-68; plan/09a-cleanup-no-shims-verification.md:44-46.
   - Bare rg commands return exit code 1 when clean, and rg ... || echo OK can pass despite forbidden stale exports.
   - Required change: every expected-zero scan must use capture-and-check-empty with explicit exit 1 on non-empty output.

4. P03 export-map source verification maps the root export to the wrong source file.
   - Reference: project-plans/issue1588/plan/03-decoupling-stub.md.
   - The source verification maps ./dist/index.js to ./src/index.ts, but the package root dist/index.js should come from packages/settings/index.ts, while packages/settings/src/index.ts is the public API barrel.
   - Required change: special-case exports["."].import === ./dist/index.js to verify packages/settings/index.ts, and separately verify packages/settings/src/index.ts. Subpath exports under ./dist/src/... should map to packages/settings/src/....

5. P04b/P07 test-quality gates still permit weak/static-only integration coverage.
   - References: project-plans/issue1588/plan/07-consumer-migration-tdd.md:56-79,136-144.
   - The CLI vertical-slice fallback can degrade to static import guards. Static guards are useful but not behavioral integration tests and do not prove profile/startup behavior remains reachable.
   - Required change: require at least one behavioral CLI-owned test or executable/root entrypoint test after import migration. Static guards should be supplemental, not a substitute.

6. Settings package metadata does not fully match existing package conventions for Node typings.
   - References: project-plans/issue1588/plan/03-decoupling-stub.md; packages/providers/package.json; packages/core/package.json; packages/core/src/config/storage.ts; packages/core/src/config/profileManager.ts.
   - Settings will contain Node-heavy code using fs, fs/promises, os, path, and crypto, but P03 only calls out vitest and typescript devDependencies. Existing core/providers packages include @types/node.
   - Required change: add @types/node to packages/settings devDependencies and verify it.

7. P03b package/dependency changes require lockfile verification but do not explicitly require npm install in that phase.
   - References: project-plans/issue1588/plan/03b-minimal-adapter-wiring.md:173-185,216-218,265-266.
   - P03b adds settings dependencies to core/providers/CLI package.json files but lacks a concrete npm install command and focused package-lock diff gate.
   - Required change: add explicit npm install, no pnpm-lock.yaml verification, package-lock focused diff/stat verification, and record evidence.

8. P08 duplicates P06 responsibility for configConstructor wiring, creating phase ambiguity.
   - References: project-plans/issue1588/plan/06-core-integration-stub.md:49; project-plans/issue1588/plan/08-consumer-migration-impl.md:48.
   - Required change: assign configConstructor adapter wiring to exactly one phase. P06 should own it because P06a pass gates depend on it; P08 should only verify it remains correct.

## Pedantic improvements

1. Rename plan/06-core-integration-stub.md or remove “stub” from all references. The header clarifies it is not a stub, but the filename remains confusing.
2. Prefer a reusable checked-in boundary verification script such as scripts/check-settings-boundary.js instead of repeated inline shell snippets.
3. Tighten root-barrel moved-symbol scans so every phase uses the same canonical symbol blocklist from anti-shim-policy.md.
4. Clarify root vs subpath import preference in tests. The plan prefers root imports, while P07 examples use subpath imports for Storage/ProfileManager.
5. Add schema/docs script verification after P03b alias/package metadata changes to catch path-resolution regressions earlier.
6. Repeat file-level-only @plan marker guidance in P05 itself to prevent noisy tagging of copied legacy methods.

## Evidence: key source/plan files inspected

- project-plans/issue1588/specification.md
- project-plans/issue1588/plan/00-overview.md
- project-plans/issue1588/plan/00a-preflight-verification.md
- project-plans/issue1588/plan/03-decoupling-stub.md
- project-plans/issue1588/plan/03b-minimal-adapter-wiring.md
- project-plans/issue1588/plan/04-settings-package-tdd.md
- project-plans/issue1588/plan/04b-vertical-slice-integration-tdd.md
- project-plans/issue1588/plan/05-settings-package-impl.md
- project-plans/issue1588/plan/06-core-integration-stub.md
- project-plans/issue1588/plan/07-consumer-migration-tdd.md
- project-plans/issue1588/plan/08-consumer-migration-impl.md
- project-plans/issue1588/plan/09-cleanup-no-shims.md
- project-plans/issue1588/plan/09a-cleanup-no-shims-verification.md
- project-plans/issue1588/plan/10-full-verification.md
- project-plans/issue1588/analysis/dependency-audit.md
- project-plans/issue1588/analysis/settings-move-map.md
- project-plans/issue1588/analysis/consumer-import-matrix.md
- project-plans/issue1588/analysis/anti-shim-policy.md
- project-plans/issue1588/analysis/behavioral-regression-matrix.md
- project-plans/issue1588/analysis/package-metadata-constraints.md
- project-plans/issue1584/analysis/package-metadata-constraints.md
- project-plans/issue1584/analysis/anti-shim-policy.md
- project-plans/issue1584/analysis/final-architecture.md
- dev-docs/PLAN.md
- dev-docs/PLAN-TEMPLATE.md
- dev-docs/RULES.md
- package.json
- packages/core/package.json
- packages/core/tsconfig.json
- packages/core/src/settings/settingsRegistry.ts
- packages/core/src/config/storage.ts
- packages/core/src/config/profileManager.ts
- packages/core/src/types/modelParams.ts
- packages/providers/package.json
- packages/providers/tsconfig.json
- packages/providers/vitest.config.ts
- packages/cli/package.json
- packages/cli/tsconfig.json
- packages/cli/vitest.config.ts
- scripts/build.js
