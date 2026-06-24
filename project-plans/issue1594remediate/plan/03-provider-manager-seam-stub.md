<!-- @plan:PLAN-20260621-COREAPIREMED.P03 @requirement:REQ-005,REQ-001.2 -->
# Phase 03: Providers `providerManager?` Adoption Seam — Stub

## Phase ID

`PLAN-20260621-COREAPIREMED.P03`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 02a completed (PASS)
- Verification: `test -f project-plans/issue1594remediate/.completed/P02a.md`
- Preflight (P00a) MUST be complete; in particular the preflight check that
  `runtimeContextFactory.ts` constructs `new ProviderManager(...)` UNCONDITIONALLY and that
  `IsolatedRuntimeContextOptions` has NO `providerManager?` field today.

## Why this phase exists (CRIT-1 grounding)

The shipped `createIsolatedRuntimeContext`
(`packages/providers/src/runtime/runtimeContextFactory.ts`) builds a brand-new `ProviderManager`
UNCONDITIONALLY:

```
// runtimeContextFactory.ts (verified)
const providerManager = new ProviderManager({
  runtime: initialRuntimeContext,
  settingsService: resolvedSettingsService,
  config,
});
```

There is NO `providerManager?` option on `IsolatedRuntimeContextOptions` (unlike `messageBus?`,
which DOES exist and is adopted via `options.messageBus ?? new MessageBus(...)`). Therefore the
"no second ProviderManager when adopting a caller-built Config" invariant (REQ-001.2 / REQ-005.2)
is **infeasible** without first adding a real adoption seam to the providers package.

This STUB phase opens that seam in a way that keeps RED genuinely RED (CRIT-2): it ONLY DECLARES the
optional `providerManager?` field on `IsolatedRuntimeContextOptions` (mirroring how `messageBus?` is
declared at ~line 199) and threads it for compilation. It does NOT adopt the option — the
construction site stays UNCONDITIONAL (`new ProviderManager({...})`, ~lines 502-506). This compiles
and preserves current behavior, and crucially the adoption behavior is ABSENT, so the P04 identity
test FAILS RED against this stub. The `??` adoption is implemented in P05 (making P04 GREEN).

## Requirements Implemented (Expanded)

### REQ-005.2 / REQ-001.2 (providers-package precondition)

**Full Text (REQ-005.2)**: The provider runtime reachable from an `Agent` built via `fromConfig`
MUST be backed by the SAME `ProviderManager` already associated with the supplied `Config` — no
second manager is constructed.

**Behavior (GIVEN/WHEN/THEN)** for this seam (the EVENTUAL behavior, implemented in P05 — this STUB
only declares the surface so the option compiles, adoption is ABSENT here):
- GIVEN a caller passes `createIsolatedRuntimeContext({ config, providerManager })`
- WHEN the context is built
- THEN the returned `handle.providerManager === providerManager` (the supplied instance is adopted,
  not replaced) AND when `providerManager` is omitted the factory still constructs one (UNCHANGED).

> STUB SCOPE (CRIT-2): in THIS phase, passing `providerManager` has NO observable effect yet — the
> factory still builds a fresh manager unconditionally. The identity behavior above is what P04's
> RED test asserts and P05 makes true.

## Implementation Tasks

### Files to Modify

- `packages/providers/src/runtime/runtimeContextFactory.ts`
  - Add an OPTIONAL field to `IsolatedRuntimeContextOptions` (the interface near the top of the
    file that already declares `config?`, `settingsService?`, `messageBus?`). Type it as the
    STRUCTURAL core interface `RuntimeProviderManager` (CRIT-1), NOT the concrete providers
    `ProviderManager` class. Add a type-only import of `RuntimeProviderManager` from
    `@vybestack/llxprt-code-core` — this import does NOT exist in `runtimeContextFactory.ts` today
    (verified empty on disk), so it MUST be added here. Match the canonical form used elsewhere,
    e.g. `runtimeLifecycle.ts:29` (`type RuntimeProviderManager` inside the existing
    `from '@vybestack/llxprt-code-core'` import block):
    ```ts
    /**
     * Caller-provided provider manager. When supplied, the runtime ADOPTS this
     * instance instead of constructing a private one, so a Config-adopting caller
     * (e.g. agents `fromConfig`) does not create a second manager.
     *
     * CRIT-1: typed as the STRUCTURAL core interface RuntimeProviderManager (not the
     * concrete providers ProviderManager class) so the agents caller can pass
     * Config.getProviderManager() — which returns RuntimeProviderManager | undefined
     * (configBaseCore.ts:265) — with ZERO assertion. The default `new ProviderManager(...)`
     * structurally satisfies this interface.
     * @plan:PLAN-20260621-COREAPIREMED.P03
     * @requirement:REQ-005.2
     */
    providerManager?: RuntimeProviderManager;
    ```
  - LEAVE the construction site UNCONDITIONAL (CRIT-2). Do NOT add the `??` adoption here — the
    field is declared and accepted but NOT yet adopted, so adoption behavior is ABSENT and P04's
    identity test fails RED. The construction site stays exactly as today:
    ```ts
    // P03 stub: option DECLARED + threaded only. Adoption (the `??`) lands in P05.
    const providerManager = new ProviderManager({
      runtime: initialRuntimeContext,
      settingsService: resolvedSettingsService,
      config,
    });
    ```
    > NOTE (CRIT-2): the `??` adoption is DELIBERATELY withheld from the stub. If the stub wrote
    > `options.providerManager ?? new ProviderManager(...)`, the P04 identity test would be GREEN
    > immediately — a TDD violation. The minimal compiling surface here is ONLY the optional field
    > declaration (mirroring `messageBus?` at ~line 199); the adoption right-hand side and its
    > supporting link/cleanup behavior are P05. The field MUST compile (referenced in a type-only
    > or no-op way is unnecessary — an unused optional interface field compiles cleanly in strict TS).
  - Markers: `@plan:PLAN-20260621-COREAPIREMED.P03`, `@requirement:REQ-005.2`.

### Constraints

- Type the field as the STRUCTURAL core interface `RuntimeProviderManager` (CRIT-1), and add the
  type-only import of `RuntimeProviderManager` from `@vybestack/llxprt-code-core` (this import does
  NOT exist in the file today — add it unconditionally). Do NOT type it as the concrete
  `ProviderManager` class and do NOT introduce a new type alias. (In THIS stub
  the field is declared but UNADOPTED, so the construction local + `handle.providerManager` remain
  the concrete `new ProviderManager(...)` — the internal-type widening of the handle field / activate
  & cleanup closures / prepare & onCleanup contexts / RuntimeActivationBindings happens in P05 when
  the resolved local becomes `RuntimeProviderManager` via the `??` adoption. An unused optional
  interface field of the wider type compiles cleanly in strict TS without touching those internals.)
- Additive only: no existing option removed; default behavior (no `providerManager` passed)
  UNCHANGED.
- No `any`, no assertions, strict TS.
- No `console.*`, no TODO/FIXME left in the shipped code path.

## Verification Commands

```bash
set -e
F=packages/providers/src/runtime/runtimeContextFactory.ts
# Field declared on the options interface as the STRUCTURAL interface (CRIT-1) — the ONLY surface
# this stub adds. It MUST be RuntimeProviderManager (NOT the concrete ProviderManager class).
grep -q "providerManager?: RuntimeProviderManager" "$F" || { echo "FAIL: providerManager? option not declared as RuntimeProviderManager (CRIT-1)"; exit 1; }
# CRIT-1: it must NOT be declared as the concrete class on the OPTIONS interface.
if grep -nE "providerManager\?:\s*ProviderManager\b" "$F"; then echo "FAIL: option typed as concrete ProviderManager — must be the structural RuntimeProviderManager (CRIT-1)"; exit 1; fi
# CRIT-1: RuntimeProviderManager must be imported (type-only) from core.
grep -qE "RuntimeProviderManager" "$F" || { echo "FAIL: RuntimeProviderManager not imported"; exit 1; }
# CRIT-1: no unsafe assertion / any introduced on the new field/path by this stub.
if grep -nE "providerManager.*as (any|unknown as ProviderManager|ProviderManager)\b" "$F"; then echo "FAIL: unsafe assertion on providerManager path"; exit 1; fi
# CRIT-2: the adoption `??` seam MUST NOT be present yet (it lands in P05 so P04 is genuinely RED).
# MIN-4: whitespace-normalize so a formatter splitting `??` across lines cannot hide an accidental adoption.
NORM=$(tr -s '[:space:]' ' ' < "$F")
if printf '%s' "$NORM" | grep -qE "options\.providerManager \?\? new ProviderManager\("; then echo "FAIL: adoption '?? new ProviderManager(' present in stub — must be withheld until P05 (checked whitespace-normalized)"; exit 1; fi
# Construction site remains UNCONDITIONAL and unique (current behavior preserved).
COUNT=$(grep -cE "new ProviderManager\(" "$F")
if [ "$COUNT" -ne 1 ]; then echo "FAIL: expected exactly one 'new ProviderManager(', found $COUNT"; exit 1; fi
# Providers package still typechecks/builds
npm run typecheck
echo "Stub field declared; adoption withheld to P05 (so P04 RED is genuine)."
```

### Semantic Verification Checklist

- [ ] `providerManager?: RuntimeProviderManager` (structural interface, CRIT-1) declared on `IsolatedRuntimeContextOptions` — NOT the concrete `ProviderManager` class.
- [ ] `RuntimeProviderManager` imported type-only from `@vybestack/llxprt-code-core`.
- [ ] Construction site stays UNCONDITIONAL (`new ProviderManager({...})`) — the `??` adoption is NOT present yet.
- [ ] No existing option removed; omitting/passing the option both preserve current behavior (adoption absent).
- [ ] No `any`/unsafe-`as` introduced on the providerManager path.
- [ ] Providers package typechecks.

## Success Criteria

- Optional field declared + threaded for compilation; adoption `??` ABSENT (P05 adds it); typecheck clean; no behavior change.

## Failure Recovery

- `git checkout -- packages/providers/src/runtime/runtimeContextFactory.ts`; re-apply ONLY the
  additive optional field declaration (`providerManager?: RuntimeProviderManager`, CRIT-1). The `??`
  adoption is WITHHELD to P05 and MUST NOT be re-introduced here (the construction site stays
  unconditional).

## Deferred Implementation Detection (MANDATORY — scoped)

Scoped to the source file(s) THIS stub creates/modifies (NOT an unscoped `__tests__/` global scan
that would trip on pre-existing #1594 matches). A stub may contain the SINGLE allowed
`NotYetImplemented` throw and nothing else deferred.

```bash
set -e
# scoped target file(s): packages/providers/src/runtime/runtimeContextFactory.ts
for F in "packages/providers/src/runtime/runtimeContextFactory.ts"; do
  test -f "$F" || continue
  # No deferred-impl placeholder language on lines THIS phase added (diff-scoped).
  if git diff HEAD -- "$F" | grep -E "^\\+" | grep -nE "(TODO|FIXME|HACK|XXX|TEMPORARY|WIP|placeholder|for now|in a real|coming soon)"; then
    echo "FAIL: deferred-implementation marker on changed lines in $F"; exit 1
  fi
  # No `return null/undefined/{{}}/[]` stand-in masquerading as behavior beyond the allowed throw.
  # (Stub bodies must throw NotYetImplemented, not silently return fake values.)
  if grep -nE "throw new Error\\('Not implemented'\\)|throw new Error\\(\"Not implemented\"\\)" "$F"; then
    echo "FAIL: generic 'Not implemented' throw — use the canonical NotYetImplemented marker in $F"; exit 1
  fi
done
echo "PASS: no deferred-implementation markers beyond the allowed NotYetImplemented throw."
```

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P03.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P03
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment of what was implemented and whether it satisfies the cited requirements]
```

