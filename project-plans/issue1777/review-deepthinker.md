# Deep Review: issue #1777 plan (`project-plans/issue1777/plan.md`)

## Overall verdict

The plan is **strong and directionally correct** on both main objectives:

1. Stabilizing `oauth_add_item` outside `AppContainer` lifecycle via a module-level bridge and buffering.
2. Hardening cross-process refresh behavior by incorporating `refresh_token` into TOCTOU guards.

That said, there are several correctness and completeness gaps that should be addressed before implementation to avoid subtle regressions.

---

## 1) Correctness review

## A. Global OAuth bridge + buffering (Phase 1–3)

### What is correct

- The root diagnosis is correct: current behavior in `useUpdateAndOAuthBridges.ts` installs
  `(global as Record<string, unknown>).__oauth_add_item = addItem` in a React `useEffect`, then deletes it on cleanup. This creates an unmounted window where events are dropped.
- Current `GlobalOAuthUI.callAddItem()` is a pure optional call (`this.addItemCallback?.(...)`) and drops events when callback is absent.
- A stable module-level bridge routing into a singleton (`globalOAuthUI.callAddItem`) is a clean fix for lifecycle mismatch.
- Keeping bridge alive while toggling handler in/out is architecturally right for this problem.

### Important bug in proposed snippet

In Phase 2 the plan says to flush pending items **before storing callback**:

```ts
setAddItem(callback): void {
  const pending = this.pendingItems.splice(0);
  for (const item of pending) {
    callback(item.itemData, item.baseTimestamp);
  }
  this.addItemCallback = callback;
}
```

This ordering is risky:

- If any callback invocation throws, `addItemCallback` never gets installed.
- Then bridge remains effectively detached and future events continue buffering (or dropping depending on code), making failure sticky.

**Recommendation:** set callback first, then flush via a local copy; optionally wrap each delivery to avoid one bad item blocking all subsequent buffered items.

Also, this ordering is **not required** for FIFO. FIFO is guaranteed by array order, not by pre/post assignment.

### Edge case not addressed: unbounded memory growth

If UI is unmounted for extended time (or callback is never attached in some runtime path), pending array can grow indefinitely.

Given this is global singleton state, add bounded retention policy:
- e.g. `MAX_PENDING_ITEMS` cap with drop-oldest strategy + debug log,
- and test coverage for cap behavior.

Without this, a noisy auth loop can create process-level memory pressure.

### Edge case not addressed: duplicate bridge registration across reload-like contexts

For normal Node module caching, one-time module execution is fine. But tests and some runtime loaders can reload modules.

Safer pattern:
- install bridge unconditionally to current wrapper (idempotent overwrite), or
- guard with identity check if needed.

Plan is probably fine in this repo context, but worth making explicit as an invariant.

---

## B. Cross-process refresh safety (Phase 4–5)

### What is correct

- Comparing only `access_token` in `ProactiveRenewalManager.hasTokenBeenRefreshedExternally()` is insufficient for single-use refresh tokens.
- Storing scheduled token identity tuple (access + refresh) is the right direction.
- Re-checking after lock acquisition and skipping refresh when identity changed is correct TOCTOU shape.
- Extending same guard to reactive path (`executeTokenRefresh`) is important and correctly identified.

### Major correctness issue in plan narrative

The plan describes a timing window “Process 2 reads T1 before Process 1 saves T2, then both refresh with R.”

Under the existing locking in `runProactiveRenewal()` and `executeTokenRefresh()`, if both processes respect the same lock key/store, Process 2 should not refresh concurrently while Process 1 holds lock. So the exact race description is not quite accurate.

The real value of the refresh-token guard is broader and still valid:
- protects when lock handoff/recheck sees token changed in ways expiry check misses,
- protects near-expiry/short-lived-token scenarios,
- protects against stale-scheduled token state.

I recommend adjusting plan wording to avoid over-claiming lock bypass race unless there is proven lock partitioning in profile/bucket configuration.

### Subtle semantic risk in `executeTokenRefresh` proposed behavior

Plan proposes:
- if `recheckToken.refresh_token !== token.refresh_token`, return `recheckToken` even if expired.

This prevents replay (good), but can surface an expired token to caller and defer recovery to later paths. That may be acceptable but should be explicitly tested end-to-end for UX impact (extra auth prompts / transient failures).

Consider safer conditional:
- skip refresh only when mismatch indicates “another refresh already happened” and token is viable or newer by expiry/version heuristic.

If keeping current approach, add tests proving no auth dead-end/regression.

---

## 2) Completeness review

## Missing or weak test coverage

### A. Missing tests for `token-refresh-helper.ts`

Plan adds behavior to `executeTokenRefresh` but test targets are mostly proactive manager + new cross-process spec. It should explicitly include/extend `auth/__tests__/token-access-coordinator.spec.ts` coverage for reactive path since that helper is consumed there.

Need concrete tests for:
- recheck token changed refresh token => provider.refreshToken not called,
- recheck token unchanged refresh token + expired => refresh called,
- no refresh token on original token path behavior remains intact.

### B. Missing tests for global bridge contract from provider side

Current providers commonly use:

```ts
const addItem = this.addItem || globalOAuthUI.getAddItem();
if (addItem) addItem(historyItem);
```

They do **not** call `global.__oauth_add_item` directly.

So stable global bridge test should validate actual intended consumer path(s):
- either consumers using `globalOAuthUI.callAddItem`,
- or explicitly justify why `global.__oauth_add_item` still matters.

As written, plan includes bridge registration tests but doesn’t show where bridge is used in production paths. This disconnect should be clarified.

### C. Missing remount/reentrancy behavior test in hook-level integration

Need integration test around `useUpdateAndOAuthBridges` lifecycle:
- mount with addItem A,
- unmount,
- remount with addItem B,
- ensure buffered events after unmount route to B, not A,
- ensure no stale closure invocations.

Plan has lifecycle test at `global-oauth-ui` level, but hook integration is where stale closure bugs happen.

### D. Missing failure-path buffering tests

Need tests for:
- handler throwing during flush: does remaining queue persist or continue? deterministic behavior required.
- handler returns IDs during flush: ignored? any downstream reliance?

### E. Missing backward-compat assertions on `__oauth_add_item`

If any tests or runtime code assume deletion on unmount, that’s covered conceptually, but there should be explicit search/update checklist across repo (not just three files listed). At minimum grep for `__oauth_add_item` assertions and update.

---

## 3) Risk review

## Regression risk areas

1. **Memory retention risk** (unbounded pending buffer).
2. **Error propagation risk** in `setAddItem` flush if callback throws.
3. **Behavior change risk** returning expired `recheckToken` in reactive refresh path.
4. **State-shape change risk** from `Map<string, string>` to object map in proactive manager; any tests reaching into internals may break.

Plan’s risk section currently labels Phase 1-3 as “low risk”. I’d bump to **low-medium** because global singleton + bridge behavior changes are broad and process-lifetime scoped.

---

## 4) Architecture review

The architecture is generally clean:
- singleton bridge + local buffering is simpler than entangling React lifecycle with provider construction timing.
- extending existing lock+TOCTOU flow is better than introducing new lock systems.

### Possible simplification

Given providers already consume `globalOAuthUI.getAddItem()`, you could solve the primary drop problem with buffering in `globalOAuthUI.callAddItem` **if all producers route through it**. But providers currently call `getAddItem` directly then invoke callback, bypassing buffering.

So either:
- migrate providers to use `globalOAuthUI.callAddItem(...)` for event emission, or
- keep stable global bridge for external paths and additionally adapt providers for consistent buffering semantics.

Right now plan improves bridge path, but provider path still depends on `getAddItem()` non-buffered call style unless providers are updated.

That is the biggest architectural completeness gap.

---

## 5) Code quality / conventions

Mostly aligned with repo style and TypeScript strictness.

Positive:
- no `any` in proposed snippets,
- explicit return types,
- immutable item payload references at API boundary.

Concerns:
- proposed `clearPendingItems(): void { this.pendingItems = []; }` mutates class state (fine), but if immutability ethos from `dev-docs/RULES.md` is applied strictly, prefer `this.pendingItems.length = 0` vs reassignment? (minor; repo currently uses mutable class state extensively, so current proposal is consistent with local conventions).
- comments in plan snippets are explanatory and okay; implementation should keep comments minimal per project guidelines.

---

## 6) Test quality review (behavioral vs mock theater)

Planned tests are mostly behavioral and scenario-driven, which is good.

Where it risks mock theater:
- tests that only assert internal map shape (`proactiveRenewalTokens stores both`) are implementation-detail-heavy.

Prefer behavior-first equivalents:
- schedule with token X, then recheck token Y where only refresh token differs => refresh skipped.
- avoid direct assertion on private internals unless unavoidable.

The new integration tests should include real timer progression and store/provider doubles with realistic state transitions (as existing proactive manager tests already do).

---

## Concrete recommendations before execution

1. **Fix `setAddItem` ordering**: assign callback before flush; define deterministic behavior if callback throws.
2. **Add bounded queue policy** for pending OAuth UI items + tests.
3. **Clarify producer paths**: migrate provider event emission to `globalOAuthUI.callAddItem(...)` (or justify bridge-only fix if external producers are the real source).
4. **Add targeted reactive-path tests** in `token-access-coordinator`/helper scope for refresh-token mismatch behavior.
5. **Reword race explanation** to align with lock semantics and avoid inaccurate claim.
6. **Add hook-level remount test** for stale closure correctness (`useUpdateAndOAuthBridges`).
7. **Reclassify risk** for Phase 1–3 from low to low-medium due to process-global lifecycle behavior.

---

## Final assessment

- **Plan quality:** good foundation, clear phases, good intent.
- **Ship-readiness:** not yet; needs the above adjustments to be robust.
- **Most important blocker:** provider emission path inconsistency (`getAddItem` direct usage) may leave buffering benefits partial unless addressed.
