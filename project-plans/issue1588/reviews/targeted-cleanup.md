# Targeted Cleanup: P03b/P04b/P06 Sequencing Consistency and Stale References

## Summary

This targeted cleanup resolves six categories of contradictory or stale text across plan, analysis, tracker, and review files. No production source code was modified — only plan artifacts under `project-plans/issue1588/`.

## Cleanup Items Addressed

### 1. P03b/P04b/P06 configConstructor wiring sequencing

**Contradiction**: The plan had contradictory claims about when `configConstructor.ts` is wired to call `activateSettingsRuntimeContext()`. Revision-10 and the P03b plan correctly stated that P03b does NOT wire configConstructor, but the P06 plan, P06a verification, final-architecture, call-site migration matrix, integration contract, pseudocode, and other files still said "P03b already wired this" or claimed P06 only replaces the stub without changing the call site.

**Resolution**: Made consistent everywhere that:
- **P03b** creates a compile-only transparent/no-op adapter module. Does NOT wire configConstructor.
- **P04b** tests exercise the adapter module directly (not through configConstructor). The P04b test is a contract/behavior test for the adapter, not a production-path test through configConstructor.
- **P06** owns the production call-site switch from `registerSettingsService()` to `activateSettingsRuntimeContext()` in configConstructor. P06 also replaces the no-op adapter stub with full behavioral implementation.
- **P06a** is the first pass gate where the P04b core test can pass (because adapter is implemented AND configConstructor is wired).

**Files modified**:
- `plan/06-core-integration-stub.md` — Changed note and file list to clarify P06 wires configConstructor (P03b did not).
- `plan/06a-core-integration-stub-verification.md` — Updated semantic checklist and verification commands to reference P06a as first pass gate for configConstructor/runtime wiring.
- `plan/08-consumer-migration-impl.md` — Updated configConstructor verification text.
- `plan/08a-consumer-migration-impl-verification.md` — Updated configConstructor checklist item.
- `plan/09-cleanup-no-shims.md` — Updated configConstructor verification text.
- `analysis/final-architecture.md` — Added P06 ownership note to configConstructor line.
- `analysis/call-site-migration-matrix.md` — Added P06 ownership note to configConstructor row.
- `analysis/integration-contract.md` — Added P06 ownership note.
- `analysis/pseudocode/settings-service.md` — Added P06 ownership note to line 24.
- `plan/03b-minimal-adapter-wiring.md` — Removed blast-radius gate code block (no longer needed since adapter is transparent no-op, not throwing). Added compile-only verification section. Added configConstructor to "files to NOT modify" list. Clarified that adapter module is for P04b direct testing, not production paths.
- `plan/03b-minimal-adapter-wiring-verification.md` — Added verification that adapter stubs are transparent no-ops (not throwing NotYetImplemented). Added verification that configConstructor was NOT modified. Added check-settings-boundary.js checklist item. Updated expected output and success criteria.
- `plan/04b-vertical-slice-integration-tdd.md` — Added P05a and P06a rows to sequencing timeline. Added P06a row showing it's the first pass gate for production configConstructor/runtime wiring.

### 2. P04b test contract clarification

**Contradiction**: The P04b plan said tests exercise the adapter directly, but other files (execution tracker, P06 semantic checklist) said "P04b core test targets actual production path: configConstructor → adapter → settings" which contradicts the P03b/P06 sequencing.

**Resolution**: Updated execution tracker to clarify that P04b tests the adapter contract/behavior directly, NOT the configConstructor production path. The configConstructor wiring is a P06 task.

**Files modified**:
- `execution-tracker.md` — Changed stale "P04b core test targets actual production path: configConstructor → adapter → settings registerSettingsService" to "P04b core test targets adapter contract/behavior directly (activateSettingsRuntimeContext → adapter → settings), NOT configConstructor production path (P06 wires configConstructor)". Second occurrence updated to remove misleading "not ConfigBaseCore.settingsServiceInstance" qualifier. Added sequencing items for P03b, P04b, P06, P06a.

### 3. P05a/P04b pass gate and stale execution tracker items

**Contradiction**: The execution tracker listed P05a as "includes P04b pass gate" when P05a explicitly defers the P04b pass gate to P06a (because the adapter is still a no-op at P05a). Also, P08a listed "includes P04b pass gate" without distinguishing core vs provider/CLI pass gates.

**Resolution**:
- P05a: Changed to "P04b core pass gate NOT run here — deferred to P06a".
- P08a: Changed to "P04b core pass gate + P07 provider/CLI pass gates" to be explicit about which tests are pass gates.
- P04b integration test pass gates: Updated from "P05a, P06a, P08a" to "P06a and P08a" (P05a explicitly does not run the pass gate).

**Files modified**:
- `execution-tracker.md` — Updated P05a description, P08a description, and pass gate item.

### 4. scripts/check-settings-boundary.js made authoritative

**Contradiction**: The boundary verification spec said phases "should reference" the script, and P03 said later phases "MUST use this script," but P08/P09/P10 plan files still had extensive inline grep snippets that could drift from the script's logic.

**Resolution**: Made the boundary verification script the **authoritative** enforcement mechanism for P08/P09/P10. Inline scans are explicitly documented as **supplemental** and must be consistent with the script. Any discrepancy is resolved in favor of the script.

**Files modified**:
- `analysis/boundary-verification-script.md` — Replaced "Plan Integration" section with explicit authoritative enforcement language for P08/P09/P10. Removed the example command block that was below the Plan Integration heading.
- `plan/03-decoupling-stub.md` — Updated Section 8a header and description to state that the script is authoritative and inline scans are supplemental.

### 5. P07 CLI behavioral test red/green expectation clarification

**Contradiction**: P07 CLI test requirement said "at least one behavioral CLI-owned test" but didn't make the red/green semantics explicit — i.e., what happens in the P07 red phase vs the P08 green phase.

**Resolution**: No change needed to P07 — the requirement already specifies two options (concrete integration test or deterministic smoke command) with static import guards explicitly marked "supplemental only." The overview already clarifies that the smoke command qualifies as a "deterministic behavioral test." No contradictory text found here.

### 6. Contradictory text scan (P03b wires configConstructor vs P06 wires configConstructor)

**Contradiction**: After revision-10, the plan should consistently state that P03b does NOT wire configConstructor and P06 does. Scanned all plan/analysis/tracker files for contradictory references.

**Files with stale text found and fixed**:
- `plan/00-overview.md` — Replaced stale "P03b blast-radius gate" item with "P03b transparent no-op adapter" item that correctly states P03b does NOT wire configConstructor.
- `analysis/phase-verification-matrix.md` — Updated P05a to explicitly state pass gate is NOT run (deferred to P06a). Updated P06a to state it's the first pass gate for production configConstructor/runtime wiring. Updated P06 to add that P06 wires configConstructor (P03b did not).
- `execution-tracker.md` — Replaced stale "P03b blast-radius gate" with four items clarifying P03b/P04b/P06/P06a sequencing. Updated P04b pass gate item to remove P05a.