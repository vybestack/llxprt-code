# Phase 05: Settings Package Implementation And Code Moves

## Phase ID

`PLAN-20260608-ISSUE1588.P05`

## Prerequisites

- Required: Phase 04b verified (vertical-slice integration TDD verified).

## Requirements Implemented (Expanded)

### REQ-SET-001: Settings Package Boundary

**Full Text**: All relevant settings service, registry, types, singleton management, profile manager, and storage code must live in `packages/settings`.

**Behavior**:

- GIVEN P04 behavioral tests
- WHEN implementation moves code into settings package
- THEN tests pass through the new package without old core ownership

**Why This Matters**: This is the central extraction implementation.

## Implementation Tasks

### Temporary Duplicate Policy (P05 Only)

During P05, code moves from core into the settings package. Until consumer migration completes in P08, old core files coexist with new settings files. This is an **explicit temporary duplicate**, not a compatibility shim. The policy is:

1. **Move semantics**: Code is **copied** (not symlinked or forwarded) into settings package. Old core files remain until P09 deletes them.
2. **No shims**: Old core files do NOT import from or forward to settings package. They are the original code, not wrappers.
3. **Consumer safety**: Consumers continue importing from old core paths until P08 migrates them. They are not broken by the move.
4. **P09 enforcement**: All old core files for moved APIs are deleted in P09. Any remaining old-path import is a plan violation.
5. **Final shims are forbidden**: After P09, no compatibility wrapper may exist. This is the existing anti-shim policy.

This policy prevents consumers from breaking before their migration phase while ensuring final state has no compatibility layer.

**Plan marker guidance (P05)**: When copying code during P05, add `@plan PLAN-20260608-ISSUE1588.P05` markers only at the file level (e.g., a single comment at the top of the file such as `/** @plan PLAN-20260608-ISSUE1588.P05 */`). Do NOT add `@plan` markers to every method or function within copied files — that would create noisy churn in methods that are identical to the original. Markers belong at the file/class level and in new/modified methods, not in boilerplate copied verbatim from core. This is repeated here from the overview for emphasis — implementers MUST NOT add `@plan` markers to unchanged legacy methods within copied files.

Follow pseudocode:

- `analysis/pseudocode/package-boundary.md` lines 01-24
- `analysis/pseudocode/settings-service.md` lines 01-29
- `analysis/pseudocode/profile-storage.md` lines 01-26

Follow `analysis/call-site-migration-matrix.md` for the settings-package side of the singleton adapter semantics.

### @plan Marker Guidance (P05, repeated from overview for emphasis)

When copying code during P05, add `@plan PLAN-20260608-ISSUE1588.P05` markers only at the file level (e.g., a single comment at the top such as `/** @plan PLAN-20260608-ISSUE1588.P05 */`). Do NOT add `@plan` markers to individual methods or functions within copied files — that would produce noisy diffs in identical-to-original code. Markers belong at the file/class level and in genuinely new or modified methods, not in boilerplate copied verbatim from core.

### Files to Create/Modify

- `packages/settings/**` source, tests, package metadata.
- root `package.json` and `package-lock.json` if npm updates lock metadata.
- Downstream package metadata only where required for compile during this phase.

## Verification Commands

```bash
npm run build --workspace @vybestack/llxprt-code-settings
# Run ALL settings package tests including nested subdirectories (profiles, storage)
npm run test --workspace @vybestack/llxprt-code-settings -- --run
npm run typecheck --workspace @vybestack/llxprt-code-settings
# Forbidden import scans (enforcing: capture-and-check-empty — exit 1 on non-empty output, exit 0 on clean)
SETTINGS_SRC_IMPORTS=$(rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code['\"]" packages/settings/src --glob '*.ts' --glob '*.tsx' 2>/dev/null || true)
test -z "$SETTINGS_SRC_IMPORTS" && echo "OK: settings src has no forbidden imports" || { echo "FAIL: forbidden imports in settings src:"; echo "$SETTINGS_SRC_IMPORTS"; exit 1; }
# Extended settings package boundary check (enforcing: capture-and-check-empty)
SETTINGS_ALL_IMPORTS=$(rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code['\"]" packages/settings --glob '*.ts' --glob '*.tsx' 2>/dev/null || true)
test -z "$SETTINGS_ALL_IMPORTS" && echo "OK: settings package has no forbidden imports" || { echo "FAIL: forbidden imports in settings package:"; echo "$SETTINGS_ALL_IMPORTS"; exit 1; }
SETTINGS_PKG_IMPORTS=$(rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers" packages/settings/package.json 2>/dev/null || true)
test -z "$SETTINGS_PKG_IMPORTS" && echo "OK: settings package.json has no forbidden refs" || { echo "FAIL: forbidden refs in settings package.json:"; echo "$SETTINGS_PKG_IMPORTS"; exit 1; }
# Verify settings tests do NOT reference core ProviderRuntimeContext (enforcing capture-and-check-empty)
CTX_REFS=$(rg -n "ProviderRuntimeContext|providerRuntimeContext|getActiveProviderRuntimeContext|clearActiveProviderRuntimeContext" packages/settings/src --glob '*.ts' 2>/dev/null || true)
test -z "$CTX_REFS" && echo "OK: settings tests do not reference ProviderRuntimeContext" || { echo "FAIL: settings references ProviderRuntimeContext:"; echo "$CTX_REFS"; exit 1; }
# Package metadata boundary: forbidden dependencies absent from both dependencies and devDependencies
node -e "const p=require('./packages/settings/package.json'); const d={...(p.dependencies||{}),...(p.devDependencies||{})}; for (const n of ['@vybestack/llxprt-code-core','@vybestack/llxprt-code-providers','@vybestack/llxprt-code']) if (d[n]) { console.error('FORBIDDEN:', n, 'in', Object.keys(p.dependencies||{}).includes(n) ? 'dependencies' : 'devDependencies'); process.exit(1); }; console.log('settings deps OK')"
# Schema/docs early check: verify generated schema/docs scripts still work after package moves
npm run schema:settings 2>&1 | tail -3
npm run docs:settings 2>&1 | tail -3
# Verify no pnpm-lock.yaml was created (enforcing: capture-and-check-empty)
test ! -f pnpm-lock.yaml && echo "no pnpm lockfile" || { echo "FAIL: pnpm-lock.yaml exists"; exit 1; }
```

## Semantic Verification Checklist

- [ ] SettingsService behavior is real and tests pass.
- [ ] Registry no longer imports core compression.
- [ ] ProfileManager imports settings-owned profile types.
- [ ] Storage paths unchanged.
- [ ] Singleton management does not import core runtime context.
- [ ] Profile/storage tests use **real temp filesystem directories** and environment overrides (e.g., `os.tmpdir()`, `HOME` override), not mock-only filesystem tests. ProfileManager `save`/`load` tests must write and read actual JSON files.
- [ ] Settings tests verify ONLY settings-owned state (no core ProviderRuntimeContext assertions).
- [ ] Settings package boundary: no forbidden imports in ANY `packages/settings/**/*.ts(x)`, including tests, configs (`vitest.config.ts`), and `tsconfig.json`.
- [ ] Settings `package.json` has no forbidden dependencies in `dependencies` OR `devDependencies`.
- [ ] `@types/node` present in settings `devDependencies`.
- [ ] Schema/docs scripts still work after package moves (early check).
- [ ] No `pnpm-lock.yaml` created; only `package-lock.json` updated.

## Success Criteria

Settings package is implemented and independently testable.

## Failure Recovery

Fix implementation without modifying P04 tests except for legitimate import-path corrections approved by reviewer.

## Phase Completion Marker

Create `project-plans/issue1588/.completed/P05.md`.
