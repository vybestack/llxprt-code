<!-- @plan:PLAN-20260621-COREAPIREMED.P05 @requirement:REQ-005,REQ-001.2 -->
# Phase 05: Providers `providerManager?` Adoption Seam — Implementation

## Phase ID

`PLAN-20260621-COREAPIREMED.P05`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 04a completed (PASS)
- Verification: `test -f project-plans/issue1594remediate/.completed/P04a.md`
- Pseudocode: `analysis/pseudocode/provider-manager-seam.md` (lines 10–40)

## Requirements Implemented (Expanded)

### REQ-005.2 / REQ-001.2

Make ALL Phase 04 tests pass by completing the adoption seam: when `options.providerManager` is
supplied, the factory ADOPTS it (no second construction), threads it through the activate/cleanup
closures, and avoids a redundant re-link when the adopted manager is already the one associated
with the supplied `Config`.

**Behavior**: see Phase 04 GIVEN/WHEN/THEN.

## Source grounding (verified)

- `runtimeContextFactory.ts`: this phase ADDS the adoption at the construction site (~lines 502-506),
  changing the UNCONDITIONAL `const providerManager = new ProviderManager({...})` to
  `const providerManager = options.providerManager ?? new ProviderManager({...})`. This MIRRORS the
  existing `messageBus?` precedent: `options.messageBus ?? new MessageBus(...)` at ~lines 482-484
  (field declared at ~line 199). The `??` adoption is introduced HERE (not P03) so the P04 identity
  test goes RED→GREEN exactly at this phase (CRIT-2). Per pseudocode `provider-manager-seam.md`
  lines 10-15. The resulting `providerManager` is consumed by `buildActivateClosure(...)` and
  `buildCleanupClosure(...)`, and inside activate by
  `bindings.registerInfrastructure(providerManager, oauthManager, { messageBus })` and
  `bindings.linkProviderManager(config, providerManager)`.
- CRIT-1 type-safety (verified): the option declared in P03 is `providerManager?: RuntimeProviderManager`
  (structural core interface), so the `??` result is `RuntimeProviderManager` (the default
  `new ProviderManager(...)` is assignable to it). To keep the resolved local assignable everywhere it
  flows, this phase WIDENS the factory's INTERNAL manager types from the concrete `ProviderManager`
  to the structural `RuntimeProviderManager`:
    - `IsolatedRuntimeContextHandle.providerManager: RuntimeProviderManager` (was concrete).
    - `buildActivateClosure(... providerManager: RuntimeProviderManager ...)` and
      `buildCleanupClosure(... providerManager: RuntimeProviderManager ...)`.
    - the `prepare`/`onCleanup` callback-context `providerManager: RuntimeProviderManager`.
    - the `RuntimeActivationBindings.registerInfrastructure(manager: RuntimeProviderManager, ...)`
      and `.linkProviderManager(config, manager: RuntimeProviderManager)` params — these ALREADY
      MATCH the CLI implementations, which are typed `RuntimeProviderManager` (verified
      `registerCliProviderInfrastructure(manager: RuntimeProviderManager, ...)` runtimeLifecycle.ts:91-92;
      `configureProviderRuntimeFactories(config, manager: RuntimeProviderManager)`
      providerManagerInstance.ts:173-176).
  This widening is purely a TYPE change — every member used on the manager (`.runtime` via the
  existing `as unknown as {...}` cast, `setConfig`, `listProviders`, `getProviderByName`,
  `registerProvider`, `setActiveProvider`, `getActiveProvider`) is a `RuntimeProviderManager` member
  (RuntimeProviderManager.ts:50-67), so NO concrete-only member is referenced and NO `any`/unsafe
  `as` is added. This is what gives P09 a ZERO-assertion path to pass
  `config.getProviderManager()` (`RuntimeProviderManager | undefined`) straight into the option.
- `bindings.linkProviderManager(config, providerManager)` calls `config.setProviderManager(...)`.
  When the adopted manager is ALREADY the one on the Config (the `fromConfig` case), this re-link is
  a no-op-equivalent (same instance) and MUST remain safe/idempotent — do NOT construct or swap.
- `Config.getProviderManager(): RuntimeProviderManager | undefined` (configBaseCore.ts:265) is how
  agents `fromConfig` will derive the manager to pass (see P08). The providers factory itself does
  NOT call `getProviderManager`; it only adopts what the caller passes.

## Implementation Tasks

### Files to Modify

- `packages/providers/src/runtime/runtimeContextFactory.ts`
  - ADD the adoption `??` at the construction site (~lines 502-506), mirroring the `messageBus?`
    precedent at ~lines 482-484 (per pseudocode lines 10-15):
    ```ts
    // @plan:PLAN-20260621-COREAPIREMED.P05 @requirement:REQ-005.2 @pseudocode lines 10-15
    const providerManager =
      options.providerManager ?? new ProviderManager({
        runtime: initialRuntimeContext,
        settingsService: resolvedSettingsService,
        config,
      });
    ```
    This is the change that flips P04's identity test (T1) from RED to GREEN.
  - WIDEN the factory's internal manager types from concrete `ProviderManager` to the structural
    `RuntimeProviderManager` (CRIT-1) so the `??` result (typed `RuntimeProviderManager`) flows
    type-safely into the handle, closures, and bindings:
    - `IsolatedRuntimeContextHandle.providerManager: RuntimeProviderManager`.
    - `buildActivateClosure` / `buildCleanupClosure` `providerManager` params → `RuntimeProviderManager`.
    - `prepare` / `onCleanup` callback-context `providerManager` field → `RuntimeProviderManager`.
    - `RuntimeActivationBindings.registerInfrastructure` `manager` param and `.linkProviderManager`
      `manager` param → `RuntimeProviderManager` (matches the CLI impls already typed that way).
    Keep the existing `(providerManager as unknown as { runtime?: ProviderRuntimeContext }).runtime =
    scopedRuntime` cast EXACTLY as today (it targets an ad-hoc internal field, not a contract member,
    and is unrelated to the adoption type-safety). Do NOT add any NEW `as`/`any` on the manager path.
  - In the activate closure, guard the `linkProviderManager` call so that when the adopted manager
    is already `config.getProviderManager()` (same instance), the link remains idempotent (it sets
    the same reference) — confirm no second `ProviderManager` is created anywhere on the adopt path.
  - Cleanup contract (GROUNDED in the shipped closure): the real `buildCleanupClosure`
    (runtimeContextFactory.ts:400-447) resets infrastructure, clears the settings runtime context,
    flushes the auth scope, invokes `options.onCleanup({... providerManager ...})`, and optionally
    `disposeRuntime` — it does NOT dispose/tear down the ProviderManager for EITHER path today (grep
    for a providerManager-disposal call in that closure is EMPTY). Therefore this phase introduces NO
    NEW disposal: do NOT add any force-dispose of the adopted manager, and do NOT add disposal for the
    default path either (default behavior stays byte-for-byte equivalent). The adopted manager flows
    into `onCleanup` as the SAME instance activation used; the caller retains ownership. No
    `providerManagerAdopted` disposal-gating flag is needed because there is no disposal to gate — if
    a future change ever adds manager disposal, it must skip the adopted instance, but that is OUT OF
    SCOPE here. Implement per pseudocode lines 25–40 (which now document the no-new-disposal contract).
  - Markers: `@plan:PLAN-20260621-COREAPIREMED.P05`, `@requirement:REQ-005.2`,
    `@pseudocode lines 10-40`.

### Files to Modify (CROSS-PACKAGE TYPE PROPAGATION — adjudicated 2026-06-22 during execution)

The CRIT-1 widening of `IsolatedRuntimeContextHandle.providerManager` to `RuntimeProviderManager`
(a SUPERTYPE) propagates into the agents package's existing `createAgent` consumer chain, which is
still typed concrete `ProviderManager`. `npm run typecheck` therefore fails at
`createAgent.ts:191` (passing the widened `handle.providerManager` into `finalizeAgent`) UNLESS the
3 consuming type-sites are widened to the same structural interface. This widening is:
  (a) MANDATED by P09 (this file's lines 60/69-73): `finalizeAgent` must accept the adopted manager
      typed `RuntimeProviderManager` because `config.getProviderManager()` returns
      `RuntimeProviderManager | undefined` — so widening here is a P09 PREREQUISITE surfaced early,
      not new scope;
  (b) MECHANICALLY SAFE — the ONLY member used on the agents-side manager is
      `this.deps.providerManager.listProviders()` (agentImpl.ts:910), a `RuntimeProviderManager`
      member; no concrete-only member is referenced;
  (c) NON-CONFLICTING — P06/P07/P08 specs make NO assertion that these are concrete `ProviderManager`
      (verified empty), and a supertype relaxation keeps all intermediate phases green.

Therefore this phase ALSO widens (type-only — supertype relaxation, NO behavior change):
- `packages/agents/src/api/createAgent.ts`
  - `finalizeAgent(... manager: ProviderManager ...)` param (anchor ~L222) → `RuntimeProviderManager`.
  - `interface AssembleFacadeDeps { readonly manager: ProviderManager }` (anchor ~L301) →
    `RuntimeProviderManager`.
  - Add a TYPE-ONLY import of `RuntimeProviderManager` (the file currently imports only
    `type { ProviderManager } from '@vybestack/llxprt-code-providers'` at L30; keep that value/type
    import — `createProviderManager`/registration still needs the concrete type elsewhere — and ADD
    `import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';` mirroring how the
    providers factory imports it).
- `packages/agents/src/api/agentImpl.ts`
  - `interface AgentDeps { readonly providerManager: ProviderManager }` (anchor L120) →
    `RuntimeProviderManager`. Add the same TYPE-ONLY `RuntimeProviderManager` core import.

Do NOT change any runtime logic, any `new`/`createProviderManager` construction, or any other member
usage in these files — purely the 3 annotations + 2 type-only imports.

### Constraints (RULES.md)

- Do NOT modify Phase 04 tests.
- Follow pseudocode line-by-line; cite line numbers in `@pseudocode` markers.
- Strict TS: no `any`, no assertions, explicit returns.
- No TODO/FIXME/placeholder; no `console.*`.
- UPDATE existing file; no parallel versions.
- Default behavior (no `providerManager` passed) MUST remain byte-for-byte equivalent in effect.
- The agents-side widening is TYPE-ONLY (supertype). NO `any`/`as` may be added in those files either.

## Verification Commands

```bash
set -e
T=packages/providers/src/runtime/__tests__/providerManagerAdoption.behavior.test.ts
F=packages/providers/src/runtime/runtimeContextFactory.ts

npx vitest run "$T"
npm run typecheck

# Pseudocode citation present
grep -q "@pseudocode" "$F" || { echo "FAIL: missing @pseudocode"; exit 1; }

# Exactly one construction site remains (adoption did not add another)
COUNT=$(grep -cE "new ProviderManager\(" "$F")
if [ "$COUNT" -ne 1 ]; then echo "FAIL: expected exactly one 'new ProviderManager(', found $COUNT"; exit 1; fi

# CRIT-1 TYPE-SAFETY GATE (grep-enforced): option + internal types are the STRUCTURAL interface,
# and NO unsafe assertion/any is added on the manager adoption path.
# 1) Option declared as the structural interface (not the concrete class).
grep -q "providerManager?: RuntimeProviderManager" "$F" || { echo "FAIL: option not typed RuntimeProviderManager (CRIT-1)"; exit 1; }
if grep -nE "providerManager\?:\s*ProviderManager\b" "$F"; then echo "FAIL: option typed as concrete ProviderManager (CRIT-1)"; exit 1; fi
# 2) Handle field widened to the structural interface.
grep -qE "providerManager:\s*RuntimeProviderManager" "$F" || { echo "FAIL: handle/context manager field not widened to RuntimeProviderManager (CRIT-1)"; exit 1; }
# 3) The adoption expression is assertion-free (no `as` immediately around the adopted option).
NORM=$(tr -s '[:space:]' ' ' < "$F")
if printf '%s' "$NORM" | grep -qE "options\.providerManager (as |!)"; then echo "FAIL: unsafe assertion/non-null on adopted option (CRIT-1)"; exit 1; fi
# 4) No `as ProviderManager` / `as any` / `as unknown as ProviderManager` introduced on changed lines.
if git diff HEAD -- "$F" | grep -E "^\+" | grep -nE "as (any|ProviderManager)\b|as unknown as ProviderManager"; then echo "FAIL: unsafe cast added on manager path (CRIT-1)"; exit 1; fi
echo "PASS: CRIT-1 type-safety gate (structural option/internal types, zero unsafe assertion)."

# Existing default-path runtime tests still green (non-breaking)
npx vitest run packages/providers/src/runtime/ > /tmp/p05-runtime.log 2>&1; RT=$?
tail -15 /tmp/p05-runtime.log
[ "$RT" -eq 0 ] || { echo "FAIL: providers runtime suite not green"; exit 1; }
```

### Deferred Implementation Detection (MANDATORY — scoped to changed lines)

```bash
set -e
F=packages/providers/src/runtime/runtimeContextFactory.ts
if git diff HEAD -- "$F" | grep -E "^\+" | grep -nE "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP|in a real|in production|ideally|for now|placeholder|not yet|will be)"; then
  echo "FAIL: deferred-implementation marker on changed lines"; exit 1
fi
echo "PASS: no deferred-implementation markers on changed lines."
```

### Semantic Verification Checklist (BLOCKS progression)

- [ ] All Phase 04 tests PASS.
- [ ] Adopted manager is the SAME instance on `handle.providerManager`; default path still fresh.
- [ ] No second `ProviderManager` constructed on the adopt path (exactly one construction site).
- [ ] `linkProviderManager` is idempotent when the adopted manager equals the Config's manager.
- [ ] Cleanup does not force-dispose a caller-adopted manager; default-path teardown unchanged.
- [ ] CRIT-1: option + handle + closures + bindings + prepare/onCleanup contexts typed `RuntimeProviderManager`; NO concrete-only member referenced; NO `any`/unsafe-`as` added on the manager path (grep gate PASS).
- [ ] Default behavior unchanged (runtime suite green).
- [ ] No deferred-implementation patterns on changed lines.

## Success Criteria

- Adoption tests green; providers runtime suite green; typecheck clean; pseudocode cited.

## Failure Recovery

- `git checkout -- packages/providers/src/runtime/runtimeContextFactory.ts`; re-implement strictly
  from pseudocode.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P05.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P05
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment of what was implemented and whether it satisfies the cited requirements]
```
