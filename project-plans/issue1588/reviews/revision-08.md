# Revision-08: Addressing Review-08 Issues

## Summary

Revision-08 addresses all 8 material issues and 6 pedantic improvements from review-08. The core architectural change is that P03b now wires `configConstructor.ts` to call `activateSettingsRuntimeContext()` (replacing the direct `registerSettingsService()` call), making P04b a true production-path integration test. Additionally, all enforcing scan patterns, expected-failure TDD commands, phase ownership clarifications, and metadata requirements have been updated.

## Files Modified

| File | Changes |
|------|---------|
| `plan/00-overview.md` | Updated P04b pass gate description, added critical reminders for: @types/node, configConstructor wiring ownership, expected-failing TDD logic, enforcing scan patterns, reusable boundary script, canonical blocklist, root vs subpath imports, behavioral CLI test requirement, P05 @plan markers, schema/docs verification, export map source verification |
| `plan/03-decoupling-stub.md` | Added `@types/node` to devDependencies, fixed export map source verification (root `.` maps to `index.ts` not `src/index.ts`; separately verify `src/index.ts`), added `@types/node` to verification commands and semantic checklist |
| `plan/03b-minimal-adapter-wiring.md` | Restructured as configConstructor wiring + adapter (not just adapter stub). Added configConstructor wiring section. Added explicit `npm install`, package-lock diff verification, evidence recording. Updated semantic checklist for lockfile, configConstructor verification. Replaced "stub" references with accurate descriptions |
| `plan/04b-vertical-slice-integration-tdd.md` | Changed P04b to exercise `configConstructor` production path (not adapter function directly). Updated expected-failure verification to capture-and-assert logic. Updated sequencing clarification. Updated verification commands. Updated semantic checklist |
| `plan/04-settings-package-tdd.md` | Converted bare rg scans to enforcing capture-and-check-empty patterns |
| `plan/05-settings-package-impl.md` | Converted bare scans to enforcing patterns. Added `@types/node` to semantic checklist. Added @plan marker guidance (repeated from overview). Made pnpm-lock check enforcing |
| `plan/06-core-integration-stub.md` | Added note clarifying P06 does NOT re-wire configConstructor (P03b already did). Updated file list to indicate adapter REPLACES P03b stub, not NEW. Updated configConstructor file description |
| `plan/07-consumer-migration-tdd.md` | Added mandatory behavioral CLI test requirement. Added root vs subpath import preference. Converted expected-failure verification to capture-and-assert logic. Converted boundary scans to enforcing patterns. Updated CLI test guidance |
| `plan/08-consumer-migration-impl.md` | Changed configConstructor from "replace" to "verify" (P08 doesn't own wiring). Converted scans to enforcing patterns. Added behavioral CLI test verification. Added configConstructor verification to semantic checklist |
| `plan/09a-cleanup-no-shims-verification.md` | Converted all bare scans to enforcing capture-and-check-empty patterns |
| `analysis/boundary-verification-script.md` | New artifact defining reusable `scripts/check-settings-boundary.js` specification |
| `analysis/anti-shim-policy.md` | Already had enforcing scan patterns (no changes needed) |

## Material Issues Addressed

### M1: P04b production path ambiguity
**Issue**: P04b claimed to test configConstructor → activateSettingsRuntimeContext → registerSettingsService, but actually tested activateSettingsRuntimeContext directly because configConstructor wasn't wired until P06.

**Resolution**: P03b now wires `configConstructor.ts` to call `activateSettingsRuntimeContext()` from the adapter. P04b imports and calls `configConstructor` as the production entrypoint. P06 only replaces the adapter stub with real implementation — it does NOT change the configConstructor call site again. Files changed: `plan/03b-minimal-adapter-wiring.md`, `plan/04b-vertical-slice-integration-tdd.md`, `plan/06-core-integration-stub.md`, `plan/00-overview.md`.

### M2: Expected-failing TDD commands
**Issue**: Plain failing test runs could abort the phase before failure analysis. Bare `|| true` patterns on expected-zero scans could pass despite forbidden stale exports.

**Resolution**: All expected-failing TDD verification commands (P04b, P07) now use capture-and-assert logic: capture exit code, assert nonzero exit, assert no module-resolution errors, assert behavioral failure patterns present, exit 0 only if red phase is valid. All expected-zero scan commands use capture-and-check-empty (`VAR=$(rg ...); test -z "$VAR" && echo OK || { echo FAIL; echo "$VAR"; exit 1; }`). Files changed: `plan/04b-vertical-slice-integration-tdd.md`, `plan/07-consumer-migration-tdd.md`, `plan/04-settings-package-tdd.md`, `plan/05-settings-package-impl.md`, `plan/08-consumer-migration-impl.md`, `plan/09a-cleanup-no-shims-verification.md`.

### M3: Non-enforcing zero scans
**Issue**: Bare `rg` commands return exit code 1 when clean, and `|| true` can pass despite forbidden matches.

**Resolution**: Every expected-zero scan across all plan files now uses the capture-and-check-empty pattern with explicit `exit 1` on non-empty output. Files changed: `plan/04-settings-package-tdd.md`, `plan/05-settings-package-impl.md`, `plan/08-consumer-migration-impl.md`, `plan/09a-cleanup-no-shims-verification.md`, plus P04b/P07 expected-failure commands.

### M4: P03 export map source verification
**Issue**: Root export `./dist/index.js` was incorrectly mapped to `./src/index.ts` instead of `./index.ts`.

**Resolution**: P03 export map source verification now special-cases `exports["."]`: `importPath` for root export maps to `./index.ts` (the source entrypoint at `packages/settings/index.ts`), while subpaths map to `./src/...`. Additionally, `packages/settings/src/index.ts` is verified separately as the public API barrel. Files changed: `plan/03-decoupling-stub.md`.

### M5: Behavioral CLI test requirement
**Issue**: P07/P08 could degrade to static-only import verification without proving runtime behavior.

**Resolution**: P07 and P08 now explicitly require at least one behavioral CLI-owned test or executable/root entrypoint test. Static import guards are explicitly labeled as supplemental only. The CLI smoke test (`node scripts/start.js --profile-load synthetic`) qualifies. Files changed: `plan/07-consumer-migration-tdd.md`, `plan/08-consumer-migration-impl.md`, `plan/00-overview.md`.

### M6: @types/node in settings devDependencies
**Issue**: Settings package uses Node filesystem modules but only listed vitest and typescript as devDependencies.

**Resolution**: P03 `package.json` scaffold now includes `@types/node` in devDependencies (matching core/providers convention). Verification commands and semantic checklist updated. Files changed: `plan/03-decoupling-stub.md`.

### M7: P03b npm install and lockfile verification
**Issue**: P03b adds settings dependencies to multiple package.json files but lacks explicit npm install command and lockfile diff verification.

**Resolution**: P03b verification commands now include explicit `npm install` (not pnpm), `git diff --stat package-lock.json`, lockfile diff evidence recording, and focused-diff verification script. Semantic checklist updated. Files changed: `plan/03b-minimal-adapter-wiring.md`.

### M8: P08 configConstructor wiring duplication
**Issue**: P08 listed configConstructor wiring as a task, duplicating P06 responsibility.

**Resolution**: P08 file list now says "verify (not re-wire)" for configConstructor.ts. P06 description updated to clarify it only replaces the adapter stub implementation, not the configConstructor call site. P03b now owns the initial wiring. Files changed: `plan/08-consumer-migration-impl.md`, `plan/06-core-integration-stub.md`, `plan/03b-minimal-adapter-wiring.md`, `plan/00-overview.md`.

## Pedantic Improvements Addressed

### P1: Remove "stub" from P06 filename/references
**Resolution**: P06 already had a note clarifying it's not a stub. Updated the note to also clarify that P06 does NOT change configConstructor (P03b already wired it). The filename `06-core-integration-stub.md` was not renamed to avoid breaking cross-references, but the header note now explicitly says "not a stub" and clarifies scope. Files changed: `plan/06-core-integration-stub.md`.

### P2: Reusable boundary verification script
**Resolution**: Created `analysis/boundary-verification-script.md` defining the specification for `scripts/check-settings-boundary.js`. Added reference in `plan/00-overview.md` and `plan/03-decoupling-stub.md` section 8a. The script consolidates repeated inline shell snippets into a single authoritative, checked-in specification.

### P3: Canonical symbol blocklist reuse
**Resolution**: Added explicit reference to `analysis/anti-shim-policy.md` blocklist in `plan/00-overview.md` critical reminders. The boundary verification script spec also references the canonical blocklist. All scan commands in plan files already use the symbols from that blocklist.

### P4: Root vs subpath import preference
**Resolution**: Added explicit root vs subpath import preference guidance to `plan/07-consumer-migration-tdd.md` semantic checklist and `plan/00-overview.md`. Root imports preferred for service/registry/types; subpath imports acceptable for specific modules like ProfileManager/Storage.

### P5: Schema/docs verification after P03b
**Resolution**: Added schema/docs verification to P03b (after alias/package metadata changes), P05, and P05a. Referenced in `plan/00-overview.md` critical reminders. The P03b root build verification section already includes `predocs:settings` verification. Files changed: `plan/00-overview.md`.

### P6: File-level-only @plan marker guidance in P05
**Resolution**: Added explicit @plan marker guidance section in P05 (repeated from overview for emphasis), stating markers go at file/class level only, not on every copied method. Files changed: `plan/05-settings-package-impl.md`.

## Preserved Architecture

- No-shim policy: No compatibility wrappers, no forwarding from core to settings.
- Cycle-free dependency direction: Settings must not depend on core/providers/CLI.
- P06 adapter ownership: settingsRuntimeAdapter.ts is the sole bridge file.
- configConstructor wiring: P03b owns the initial wiring, P06 owns the adapter implementation, P08 only verifies.