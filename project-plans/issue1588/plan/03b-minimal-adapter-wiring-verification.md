# Phase 03c Verification: Minimal Adapter Wiring

## Phase ID

`PLAN-20260608-ISSUE1588.P03c`

## Prerequisites

- Required: Phase 03b completed.

## Requirements Implemented (Expanded)

### REQ-DEP-001: Cycle-Free Dependency Direction

**Full Text**: Core may depend on settings; settings must not depend on core.

**Behavior**:

- GIVEN P03b adapter stubs and type-only imports
- WHEN reviewer inspects new core files
- THEN no reverse dependency (settings → core) is introduced

**Why This Matters**: Even stub-level wiring can accidentally introduce wrong-direction imports.

## Implementation Tasks

No production implementation. Review P03b stubs.

## Verification Commands

```bash
rg -n "@vybestack/llxprt-code-core|providerRuntimeContext" packages/settings/src --glob '*.ts'
rg -n "activateSettingsRuntimeContext|deactivateSettingsRuntimeContext" packages/core/src/runtime/settingsRuntimeAdapter.ts
# Verify adapter stub is transparent no-op (NOT throwing NotYetImplemented)
rg -n "NotYetImplemented|throw" packages/core/src/runtime/settingsRuntimeAdapter.ts && echo "FAIL: adapter stub should not throw NotYetImplemented" || echo "OK: adapter stub is transparent no-op"
# Verify configConstructor was NOT modified in P03b
rg -n "activateSettingsRuntimeContext" packages/core/src/config/configConstructor.ts && echo "FAIL: configConstructor was modified in P03b but P03b should NOT wire it" || echo "OK: configConstructor not wired in P03b"
npm run typecheck --workspace @vybestack/llxprt-code-core
npm run typecheck --workspace @vybestack/llxprt-code-providers
npm run typecheck --workspace @vybestack/llxprt-code
rg -n "@vybestack/llxprt-code-settings" packages/core/tsconfig.json packages/core/package.json
rg -n "@vybestack/llxprt-code-settings" packages/providers/tsconfig.json packages/providers/package.json packages/providers/vitest.config.ts
rg -n "@vybestack/llxprt-code-settings" packages/cli/tsconfig.json packages/cli/package.json packages/cli/vitest.config.ts
# Verify no pnpm-lock.yaml created
test ! -f pnpm-lock.yaml && echo "no pnpm lockfile"
# Verify core tests still pass (adapter is transparent no-op, nothing calls it in production)
npm run test --workspace @vybestack/llxprt-code-core 2>&1 | tail -5
```

Expected: settings has zero core imports; adapter stub exports both functions as transparent no-ops (not throwing); configConstructor was NOT modified in P03b; core, providers, and CLI compile; path aliases present in all three packages; no pnpm lockfile; core tests pass unchanged; `scripts/check-settings-boundary.js` exists and passes.

## Semantic Verification Checklist

- [ ] Adapter stubs are transparent no-ops (console.warn on invocation, no throw, no behavior change) — NOT throwing NotYetImplemented.
- [ ] configConstructor was NOT modified in P03b (P06 owns the production call-site switch).
- [ ] Type-only imports do not alter existing runtime behavior.
- [ ] Existing core-local import paths NOT removed (temporary duplicate policy).
- [ ] Providers and CLI both have settings path aliases in tsconfig.json.
- [ ] Providers vitest.config.ts has settings workspace source alias.
- [ ] CLI vitest.config.ts has settings workspace source alias.
- [ ] Providers and CLI package.json declare settings dependency.
- [ ] No pnpm-lock.yaml created during npm install.
- [ ] `scripts/check-settings-boundary.js` exists, implements all checks from `analysis/boundary-verification-script.md`, and runs successfully (exits 0).

## Success Criteria

P04b (core vertical-slice) and P07 (provider/CLI vertical-slice) can proceed with real planned import paths available. configConstructor was NOT wired in P03b — that production call-site switch is deferred to P06.

## Failure Recovery

Return to P03b.

## Phase Completion Marker

Create `project-plans/issue1588/.completed/P03c.md`.